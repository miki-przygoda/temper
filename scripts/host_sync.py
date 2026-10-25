#!/usr/bin/env python3
"""Keep the epic branch the same on the user's machine and on the ssh build host's clone.

The head runs this, never an agent. It talks to the host clone only through git over ssh,
at ssh://<host>/<clone>, and never forces a branch: the only forced refs are its own private
copies of the host's, refs/temper/host/, which follow a host branch that was rewritten.

fetch: bring the epic branch and the task branches temper/<epic>/* back from the host clone
(amendment A7). They land first in a private namespace, refs/temper/host/<branch>, never
straight in refs/heads/ (SECOND-CONTROL-FLOW-1). Each local branch then moves only by a fast
forward: with `git merge --ff-only` in the worktree where it is checked out, if it is, so no
worktree is left with its branch moved under it; otherwise with `git update-ref`, which checks
the old value. A local branch that is missing is created. A local branch already ahead of the
host's copy (the head's own commits, which `push` then brings to the host) is left as it is
(A7-REGRESSION). When any branch has commits on both sides, nothing local is changed and it
exits 1.

push: send the local epic branch to the host clone, so the host's agents build on it: on the
first launch it carries the spec and plan the plan skill committed (SECOND-TESTS-DOCS-1). It is
a plain push of refs/heads/<branch>, so git takes it only as a fast-forward of the host's copy
(or as a new branch there); anything else is refused and nothing on the host changes.

CLI: python3 scripts/host_sync.py fetch <repo> <host> <clone> <branch> <epic>
     python3 scripts/host_sync.py push <repo> <host> <clone> <branch>
fetch prints {"ok": true, "updated": [...], "created": [...], "same": [...], "ahead": [...]},
push prints
{"ok": true, "branch": ..., "commit": ...}; each exits 0, or prints `host_sync: <why>` on
stderr and exits 1.
"""
import json
import subprocess
import sys

PRIVATE = 'refs/temper/host/'


class SyncError(Exception):
    pass


def _git(repo, *args):
    return subprocess.run(['git', '-C', repo, *args], check=False, capture_output=True, text=True)


def host_url(host: str, clone: str) -> str:
    """ssh://<host>/<clone> for an absolute or ~/ clone path."""
    if not host or host.startswith('-') or any(c in host for c in '/ \t\n'):
        raise SyncError(f'bad host name {host!r}')
    if clone.startswith('/'):
        return f'ssh://{host}{clone}'
    if clone.startswith('~/'):
        return f'ssh://{host}/{clone}'
    raise SyncError(f'the host clone must be an absolute or ~/ path, not {clone!r}')


def _rev(repo, ref):
    proc = _git(repo, 'rev-parse', '--verify', '--quiet', '--end-of-options', f'{ref}^{{commit}}')
    sha = proc.stdout.strip()
    return sha if proc.returncode == 0 and sha else None


def _is_ancestor(repo, a, b):
    proc = _git(repo, 'merge-base', '--is-ancestor', a, b)
    if proc.returncode not in (0, 1):
        raise SyncError(f'git merge-base failed: {proc.stderr.strip()}')
    return proc.returncode == 0


def checked_out(repo):
    """{refs/heads/<name>: worktree path} for every worktree with a branch checked out."""
    proc = _git(repo, 'worktree', 'list', '--porcelain')
    if proc.returncode != 0:
        raise SyncError(f'git worktree list failed: {proc.stderr.strip()}')
    out = {}
    path = None
    for line in proc.stdout.splitlines():
        if line.startswith('worktree '):
            path = line[len('worktree '):]
        elif line.startswith('branch ') and path is not None:
            out[line[len('branch '):]] = path
    return out


def _fetch_private(repo, url, branch, epic):
    """Fetch the host's branches into refs/temper/host/; return {local ref: host sha}.

    The private refs are a copy of the host's, so they follow a host branch that was
    rewritten or recreated (the '+'); only refs/heads/ is guarded, by fetch() below.
    """
    specs = [
        f'+refs/heads/{branch}:{PRIVATE}{branch}',
        f'+refs/heads/temper/{epic}/*:{PRIVATE}temper/{epic}/*',
    ]
    proc = _git(repo, 'fetch', '--no-tags', '--no-write-fetch-head', url, *specs)
    if proc.returncode != 0:
        raise SyncError(f'fetch from {url} failed (nothing local changed): {proc.stderr.strip()}')
    proc = _git(repo, 'for-each-ref', '--format=%(refname) %(objectname)',
                f'{PRIVATE}{branch}', f'{PRIVATE}temper/{epic}/')
    if proc.returncode != 0:
        raise SyncError(f'git for-each-ref failed: {proc.stderr.strip()}')
    found = {}
    for line in proc.stdout.splitlines():
        ref, sha = line.split(' ', 1)
        name = ref[len(PRIVATE):]
        if name == branch or name.startswith(f'temper/{epic}/'):
            found[f'refs/heads/{name}'] = sha
    if f'refs/heads/{branch}' not in found:
        raise SyncError(f'the host clone has no branch {branch}')
    return found


def fetch(repo: str, host: str, clone: str, branch: str, epic: str) -> dict:
    url = host_url(host, clone)
    host_refs = _fetch_private(repo, url, branch, epic)
    worktrees = checked_out(repo)
    plan = []  # (ref, old, new, worktree)
    same = []
    ahead = []
    problems = []
    for ref, new in sorted(host_refs.items()):
        old = _rev(repo, ref)
        name = ref[len('refs/heads/'):]
        if old == new:
            same.append(name)
        elif old is None:
            plan.append((ref, None, new, None))
        elif _is_ancestor(repo, old, new):
            plan.append((ref, old, new, worktrees.get(ref)))
        elif _is_ancestor(repo, new, old):
            # The head's own commits, not on the host yet: left as they are, for `push` to
            # bring to the host as a fast-forward (A7-REGRESSION).
            ahead.append(name)
        else:
            problems.append(f'{name} has diverged from the host clone (commits on both sides)')
    if problems:
        raise SyncError('not a fast-forward, nothing local changed: ' + '; '.join(problems)
                        + '. Never force it: tell the user.')
    updated, created = [], []
    for ref, old, new, wt in plan:
        name = ref[len('refs/heads/'):]
        if old is None:
            proc = _git(repo, 'update-ref', '-m', 'temper: from the host clone', ref, new, '')
            created.append(name)
        elif wt is not None:
            proc = _git(wt, 'merge', '--ff-only', '--quiet', new)
            updated.append(name)
        else:
            proc = _git(repo, 'update-ref', '-m', 'temper: fast-forward from the host clone', ref, new, old)
            updated.append(name)
        if proc.returncode != 0 or _rev(repo, ref) != new:
            where = f' in the worktree {wt}' if wt else ''
            raise SyncError(f'could not fast-forward {name}{where}: {proc.stderr.strip()}')
    return {'ok': True, 'updated': updated, 'created': created, 'same': same, 'ahead': ahead}


def push(repo: str, host: str, clone: str, branch: str) -> dict:
    url = host_url(host, clone)
    ref = f'refs/heads/{branch}'
    sha = _rev(repo, ref)
    if sha is None:
        raise SyncError(f'there is no local branch {branch} to push')
    proc = _git(repo, 'push', '--quiet', '--no-follow-tags', url, f'{ref}:{ref}')
    if proc.returncode != 0:
        why = proc.stderr.strip()
        hint = ''
        if 'checked out' in why:
            hint = (f' {branch} is checked out in a worktree on the host: it can take the push only'
                    ' once that worktree is detached (git switch --detach).')
        elif 'non-fast-forward' in why or 'fetch first' in why:
            hint = (' The host has commits the local branch lacks: fetch back first; if the two'
                    ' have diverged, the user decides.')
        raise SyncError(f'push of {branch} to {url} refused, nothing on the host changed.{hint}'
                        f' Never force it: tell the user. git said: {why}')
    return {'ok': True, 'branch': branch, 'commit': sha}


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    try:
        if len(argv) == 6 and argv[0] == 'fetch':
            result = fetch(*argv[1:])
        elif len(argv) == 5 and argv[0] == 'push':
            result = push(*argv[1:])
        else:
            print('usage: host_sync.py fetch <repo> <host> <clone> <branch> <epic>\n'
                  '       host_sync.py push <repo> <host> <clone> <branch>', file=sys.stderr)
            return 1
    except Exception as exc:  # report and stop, never guess
        print(f'host_sync: {exc}', file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
