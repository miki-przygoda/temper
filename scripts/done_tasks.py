#!/usr/bin/env python3
"""Finished task and phase ids of an epic, read from commit trailers.

Every task or phase commit carries `Temper-Task: <epic>/<id>` (spec 3.5, A6).
The ids found on `base..branch` are what the head passes as `args.done`.

CLI: python3 scripts/done_tasks.py <repo> <branch> <base> <epic>
Prints a JSON array of ids and exits 0. Exits 1 (message on stderr) when git
can't read the range, so a typo never looks like "nothing is done yet".
"""
import json
import re
import subprocess
import sys

ID_RE = re.compile(r'^[a-z0-9][a-z0-9:-]*$')
TRAILER_KEY = 'Temper-Task'


def _git(repo, *args):
    return subprocess.run(
        ['git', '-C', repo, *args],
        check=False, capture_output=True, text=True,
    )


def done(repo: str, branch: str, base: str, epic: str) -> list:
    """Sorted unique ids from `Temper-Task: <epic>/<id>` trailers in base..branch."""
    proc = _git(
        repo, 'log',
        f'--format=%(trailers:key={TRAILER_KEY},valueonly)',
        '--end-of-options', f'{base}..{branch}', '--',
    )
    if proc.returncode != 0:
        raise RuntimeError(f'git log {base}..{branch} failed: {proc.stderr.strip()}')
    ids = set()
    prefix = f'{epic}/'
    for line in proc.stdout.splitlines():
        value = line.strip()
        if not value.startswith(prefix):
            continue
        task_id = value[len(prefix):]
        if ID_RE.match(task_id):
            ids.add(task_id)
    return sorted(ids)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 4:
        print('usage: done_tasks.py <repo> <branch> <base> <epic>', file=sys.stderr)
        return 1
    repo, branch, base, epic = argv
    try:
        ids = done(repo, branch, base, epic)
    except Exception as exc:  # report, never guess an empty list
        print(f'done_tasks: {exc}', file=sys.stderr)
        return 1
    print(json.dumps(ids))
    return 0


if __name__ == '__main__':
    sys.exit(main())
