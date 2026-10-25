#!/usr/bin/env python3
"""Finished task and phase ids of an epic, read from commit trailers.

Every task or phase commit carries `Temper-Task: <epic>/<id>` (spec 3.5, A6).
The ids found on `base..branch` are what the head passes as `args.done`.

`docs` and `evidence` (stage 5) count only while every commit after theirs is
a docs or evidence commit too: a later commit, such as the head's fix for a
failed full gate, changes the code they describe, so a publish relaunch writes
them again (SECOND-CONTROL-FLOW-9).

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
PUBLISH_IDS = ('docs', 'evidence')


def _git(repo, *args):
    return subprocess.run(
        ['git', '-C', repo, *args],
        check=False, capture_output=True, text=True,
    )


def done(repo: str, branch: str, base: str, epic: str) -> list:
    """Sorted unique ids from `Temper-Task: <epic>/<id>` trailers in base..branch.

    A docs or evidence id counts only when every commit after its commit on the
    branch is a docs or evidence commit itself.
    """
    proc = _git(
        repo, 'log',
        f'--format=%x00%H%n%(trailers:key={TRAILER_KEY},valueonly)',
        '--end-of-options', f'{base}..{branch}', '--',
    )
    if proc.returncode != 0:
        raise RuntimeError(f'git log {base}..{branch} failed: {proc.stderr.strip()}')
    ids = set()
    publish = {}  # commit sha -> the docs/evidence ids it carries
    prefix = f'{epic}/'
    for chunk in proc.stdout.split('\0'):
        lines = chunk.splitlines()
        if not lines:
            continue
        sha = lines[0].strip()
        for line in lines[1:]:
            value = line.strip()
            if not value.startswith(prefix):
                continue
            task_id = value[len(prefix):]
            if not ID_RE.match(task_id):
                continue
            if task_id in PUBLISH_IDS:
                publish.setdefault(sha, set()).add(task_id)
            else:
                ids.add(task_id)
    for sha, found in publish.items():
        later = _git(repo, 'rev-list', '--end-of-options', f'{sha}..{branch}', '--')
        if later.returncode != 0:
            raise RuntimeError(f'git rev-list {sha}..{branch} failed: {later.stderr.strip()}')
        if all(c in publish for c in later.stdout.split()):
            ids |= found
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
