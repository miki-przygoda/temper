#!/usr/bin/env python3
"""Is a branch (and its worktree), or a detached worktree, safe to delete? (spec 8)

Branch mode: safe means the work is on the remote: the branch tip is reachable from the
remote's default branch, or equals `<remote>/<branch>`; and the worktree, when given, is a
worktree of the repo whose HEAD is on the remote too and has nothing uncommitted or untracked,
and no ignored file except those matching a disposable pattern (amendment A10: `git worktree
remove` deletes ignored files without asking).

Detached mode (`--detached --worktree P`, for the throwaway worktrees under
`.temper/worktrees/<epic>/tmp/`): the worktree is a worktree of the repo, its HEAD is detached
and reachable from the remote's default branch or any other `<remote>/*` branch, and its status
is clean as above.

The check deletes nothing. A usage error is exit 1 with a reason, never argparse's exit 2.

CLI: python3 scripts/cleanup_check.py <repo> [<branch>] [--detached] [--worktree P]
                                      [--remote R] [--no-fetch] [--disposable PATTERN]...
Prints {"ok": bool, "reasons": [...]} and exits 0 when ok, 1 when not.
"""
import argparse
import fnmatch
import json
import os
import subprocess
import sys


def _git(repo, *args):
    return subprocess.run(
        ['git', '-C', repo, *args],
        check=False, capture_output=True, text=True,
    )


def _rev(repo, ref):
    """The commit a ref points to, or None when it doesn't exist."""
    proc = _git(repo, 'rev-parse', '--verify', '--quiet', '--end-of-options', f'{ref}^{{commit}}')
    sha = proc.stdout.strip()
    return sha if proc.returncode == 0 and sha else None


def _default_branch(repo, remote):
    """`<remote>/<default>` from the remote's HEAD, else <remote>/main, else <remote>/master."""
    proc = _git(repo, 'symbolic-ref', '--quiet', '--short', f'refs/remotes/{remote}/HEAD')
    name = proc.stdout.strip()
    if proc.returncode == 0 and name and _rev(repo, f'refs/remotes/{name}'):
        return name
    for candidate in ('main', 'master'):
        if _rev(repo, f'refs/remotes/{remote}/{candidate}'):
            return f'{remote}/{candidate}'
    return None


def _match_segments(pat, segs):
    """Does the list of pattern segments match the list of path segments exactly?

    Each segment is matched on its own, so `*`, `?` and `[...]` never match `/`. A `**`
    segment matches zero or more whole segments; a trailing `**` matches one or more
    (gitignore: `out/**` is what is inside out, not out itself).
    """
    if not pat:
        return not segs
    head, rest = pat[0], pat[1:]
    if head == '**':
        if not rest:
            return len(segs) >= 1
        return any(_match_segments(rest, segs[i:]) for i in range(len(segs) + 1))
    return bool(segs) and fnmatch.fnmatchcase(segs[0], head) and _match_segments(rest, segs[1:])


def _disposable(path, patterns):
    """Does an ignored path match one of the `disposable:` patterns from project.md?

    gitignore-style, simplified: a trailing `/` matches a directory only; a pattern with a
    leading or inner `/` is anchored at the worktree root and matched segment by segment, so
    `*` never matches `/` and only `**` spans directories; any other pattern matches one path
    component at any depth. `*`, `?` and `[...]` are fnmatch wildcards.
    """
    parts = path.rstrip('/').split('/')
    for pat in patterns:
        name = pat.strip('/')
        if not name:
            continue
        dir_only = pat.endswith('/')
        # A directory pattern matches the parents of a file, never the file's own name.
        last = len(parts) - 1 if dir_only and not path.endswith('/') else len(parts)
        if pat.startswith('/') or '/' in name:
            segs = name.split('/')
            if any(_match_segments(segs, parts[:i]) for i in range(1, last + 1)):
                return True
        elif any(fnmatch.fnmatchcase(part, name) for part in parts[:last]):
            return True
    return False


def _worktree_of(repo, worktree):
    """Is the path a worktree of <repo> itself?

    Inside a plain directory, git status reports the enclosing repo, and a worktree of another
    repo says nothing about <repo>'s work.
    """
    top = _git(worktree, 'rev-parse', '--show-toplevel')
    common = _git(worktree, 'rev-parse', '--git-common-dir')
    repo_common = _git(repo, 'rev-parse', '--git-common-dir')
    return not (any(p.returncode != 0 for p in (top, common, repo_common))
                or os.path.realpath(top.stdout.strip()) != os.path.realpath(worktree)
                or os.path.realpath(os.path.join(worktree, common.stdout.strip()))
                != os.path.realpath(os.path.join(repo, repo_common.stdout.strip())))


def _status_reasons(worktree, disposable):
    """Reasons from the worktree's status: uncommitted, untracked or non-disposable ignored."""
    proc = _git(worktree, 'status', '--porcelain', '-z', '--ignored', '--untracked-files=all')
    if proc.returncode != 0:
        return [f'could not read the status of worktree {worktree}']
    reasons = []
    changed = untracked = 0
    ignored = []
    entries = iter(proc.stdout.split('\0'))
    for entry in entries:
        if not entry.strip():
            continue
        code, path = entry[:2], entry[3:]
        if code == '??':
            untracked += 1
        elif code == '!!':
            if not _disposable(path, disposable):
                ignored.append(path)
        else:
            changed += 1
            if code[0] in 'RC':
                next(entries, None)  # a rename's or copy's source path
    if changed or untracked:
        reasons.append(
            f'worktree {worktree} has {changed} uncommitted and '
            f'{untracked} untracked file(s)'
        )
    if ignored:
        shown = ', '.join(ignored[:5]) + (', ...' if len(ignored) > 5 else '')
        reasons.append(
            f'worktree {worktree} has {len(ignored)} ignored file(s) that match no '
            f'disposable pattern: {shown}'
        )
    return reasons


def _remote_branches(repo, remote):
    """Every `refs/remotes/<remote>/*` ref except `<remote>/HEAD`."""
    proc = _git(repo, 'for-each-ref', '--format=%(refname)', f'refs/remotes/{remote}/')
    if proc.returncode != 0:
        return []
    return [ref for ref in proc.stdout.splitlines()
            if ref and ref != f'refs/remotes/{remote}/HEAD']


def _check_branch(repo, branch, worktree, remote, disposable):
    reasons = []

    tip = _rev(repo, f'refs/heads/{branch}')
    if tip is None:
        reasons.append(f'branch {branch} not found in {repo}')
    else:
        default = _default_branch(repo, remote)
        merged = False
        if default is not None:
            anc = _git(repo, 'merge-base', '--is-ancestor', tip, f'refs/remotes/{default}')
            merged = anc.returncode == 0
        pushed = _rev(repo, f'refs/remotes/{remote}/{branch}') == tip
        if not (merged or pushed):
            where = default if default is not None else f'{remote} (no default branch found)'
            reasons.append(
                f'branch {branch} is not on {remote}: its tip {tip[:12]} is not reachable '
                f'from {where} and does not equal {remote}/{branch}'
            )

    if worktree is not None:
        if not _worktree_of(repo, worktree):
            reasons.append(f'{worktree} is not a worktree of {repo}; not deleting')
        else:
            # The worktree's HEAD must be on the remote too: a detached HEAD (a stopped rebase,
            # a `checkout --detach`) can hold commits that are on no branch.
            head = _rev(worktree, 'HEAD')
            default = _default_branch(repo, remote)
            refs = [f'refs/remotes/{default}'] if default is not None else []
            if _rev(repo, f'refs/remotes/{remote}/{branch}'):
                refs.append(f'refs/remotes/{remote}/{branch}')
            if head is None or not any(
                    _git(repo, 'merge-base', '--is-ancestor', head, ref).returncode == 0
                    for ref in refs):
                shown = head[:12] if head else '(none)'
                reasons.append(
                    f'worktree {worktree} HEAD {shown} is not on {remote}: it is not reachable '
                    f'from {default or "its default branch"} or {remote}/{branch}'
                )
            reasons += _status_reasons(worktree, disposable)

    return reasons


def _check_detached(repo, worktree, remote, disposable):
    if not _worktree_of(repo, worktree):
        return [f'{worktree} is not a worktree of {repo}; not deleting']
    reasons = []
    sym = _git(worktree, 'symbolic-ref', '-q', 'HEAD')
    if sym.returncode == 0:
        ref = sym.stdout.strip()
        reasons.append(f'worktree {worktree} is not detached: it has {ref} checked out')
    head = _rev(worktree, 'HEAD')
    default = _default_branch(repo, remote)
    refs = [f'refs/remotes/{default}'] if default is not None else []
    refs += [ref for ref in _remote_branches(repo, remote) if ref not in refs]
    if head is None or not any(
            _git(repo, 'merge-base', '--is-ancestor', head, ref).returncode == 0
            for ref in refs):
        shown = head[:12] if head else '(none)'
        reasons.append(
            f'worktree {worktree} HEAD {shown} is not on {remote}: it is not reachable '
            f'from any {remote} branch'
        )
    return reasons + _status_reasons(worktree, disposable)


def _usage_error(branch, worktree, detached):
    """The usage reason, or None when the arguments are a valid combination."""
    if detached and branch is not None:
        return 'give either a branch or --detached, not both'
    if not detached and branch is None:
        return 'give either a branch or --detached'
    if detached and worktree is None:
        return '--detached needs --worktree'
    return None


def check(repo: str, branch=None, worktree=None, remote: str = 'origin', fetch: bool = True,
          disposable=(), detached: bool = False):
    """Return (ok, reasons). Every failed condition adds one reason. Deletes nothing."""
    usage = _usage_error(branch, worktree, detached)
    if usage is not None:
        return (False, [usage])

    if fetch:
        # --prune: a remote branch deleted unmerged must not leave a stale tracking ref
        # that still equals the local tip (spec 8: never delete work not on the remote).
        proc = _git(repo, 'fetch', '--quiet', '--prune', '--end-of-options', remote)
        if proc.returncode != 0:
            return (False, [f'could not fetch {remote}; not deleting'])

    if detached:
        reasons = _check_detached(repo, worktree, remote, disposable)
    else:
        reasons = _check_branch(repo, branch, worktree, remote, disposable)
    return (not reasons, reasons)


class _UsageError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise _UsageError(message)


def main(argv=None) -> int:
    parser = _Parser(description='Is a branch and its worktree, or a detached worktree, '
                                 'safe to delete?')
    parser.add_argument('repo')
    parser.add_argument('branch', nargs='?', default=None)
    parser.add_argument('--detached', action='store_true',
                        help='check the detached worktree given by --worktree; no branch')
    parser.add_argument('--worktree', default=None)
    parser.add_argument('--remote', default='origin')
    parser.add_argument('--no-fetch', dest='fetch', action='store_false')
    parser.add_argument('--disposable', action='append', default=[], metavar='PATTERN',
                        help='an ignored-file pattern safe to delete with the worktree '
                             '(repeatable; from the disposable line of .temper/project.md)')
    try:
        opts = parser.parse_args(argv)
    except _UsageError as exc:
        print(json.dumps({'ok': False, 'reasons': [f'usage: {exc}']}))
        return 1
    try:
        ok, reasons = check(opts.repo, opts.branch, worktree=opts.worktree,
                            remote=opts.remote, fetch=opts.fetch,
                            disposable=opts.disposable, detached=opts.detached)
    except Exception as exc:  # any surprise means "not safe"
        ok, reasons = False, [f'cleanup check failed: {exc}; not deleting']
    print(json.dumps({'ok': ok, 'reasons': reasons}))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
