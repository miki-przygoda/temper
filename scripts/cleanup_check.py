#!/usr/bin/env python3
"""Is a branch (and its worktree) safe to delete? (spec 8)

Safe means the work is on the remote: the branch tip is reachable from the
remote's default branch, or equals `<remote>/<branch>`; and the worktree, when
given, has nothing uncommitted or untracked.

CLI: python3 scripts/cleanup_check.py <repo> <branch> [--worktree P] [--remote R] [--no-fetch]
Prints {"ok": bool, "reasons": [...]} and exits 0 when ok, 1 when not.
"""
import argparse
import json
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


def check(repo: str, branch: str, worktree=None, remote: str = 'origin', fetch: bool = True):
    """Return (ok, reasons). Every failed condition adds one reason."""
    if fetch:
        proc = _git(repo, 'fetch', '--quiet', '--end-of-options', remote)
        if proc.returncode != 0:
            return (False, [f'could not fetch {remote}; not deleting'])

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
        proc = _git(worktree, 'status', '--porcelain', '--untracked-files=all')
        if proc.returncode != 0:
            reasons.append(f'could not read the status of worktree {worktree}')
        else:
            lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
            if lines:
                untracked = sum(1 for ln in lines if ln.startswith('??'))
                changed = len(lines) - untracked
                reasons.append(
                    f'worktree {worktree} has {changed} uncommitted and '
                    f'{untracked} untracked file(s)'
                )

    return (not reasons, reasons)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Is a branch and its worktree safe to delete?')
    parser.add_argument('repo')
    parser.add_argument('branch')
    parser.add_argument('--worktree', default=None)
    parser.add_argument('--remote', default='origin')
    parser.add_argument('--no-fetch', dest='fetch', action='store_false')
    opts = parser.parse_args(argv)
    try:
        ok, reasons = check(opts.repo, opts.branch, worktree=opts.worktree,
                            remote=opts.remote, fetch=opts.fetch)
    except Exception as exc:  # any surprise means "not safe"
        ok, reasons = False, [f'cleanup check failed: {exc}; not deleting']
    print(json.dumps({'ok': ok, 'reasons': reasons}))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
