#!/usr/bin/env python3
"""Counts of an epic's blocks and relaunches, read from each log.md.

CLI: python3 scripts/blocks_report.py <specs_dir>

The run skill writes one line per block, `<YYYY-MM-DD> blocked[<cause>] <id>`,
and one per relaunch, `<YYYY-MM-DD> relaunch <stage> attempt <n>` (a leading
`- ` is fine, and a line with no date counts as undated). Any other line is
ignored, so prose that mentions a block isn't counted. Prints tab-separated
rows per epic and ISO week. Exits 1 when specs_dir isn't a directory.
"""
import datetime
import re
import sys
from collections import Counter
from pathlib import Path

_DATE = r'(?:(?P<date>\d{4}-\d{2}-\d{2})\s+)?'
BLOCK_RE = re.compile(r'^(?:-\s+)?' + _DATE + r'blocked\[(?P<cause>[a-z-]+)\]\s+\S+')
RELAUNCH_RE = re.compile(r'^(?:-\s+)?' + _DATE + r'relaunch\s+\S+\s+attempt\s+\d+')


def week_of(date):
    """`2026-W45` for an ISO date, `undated` for none or an impossible one."""
    try:
        year, week, _ = datetime.date.fromisoformat(date or '').isocalendar()
    except ValueError:
        return 'undated'
    return f'{year}-W{week:02d}'


def scan(specs_dir: Path):
    blocks = Counter()
    relaunches = Counter()
    for log in sorted(specs_dir.glob('*/log.md')):
        epic = log.parent.name
        for line in log.read_text(encoding='utf-8', errors='replace').splitlines():
            block = BLOCK_RE.match(line)
            if block:
                blocks[(epic, week_of(block['date']), block['cause'])] += 1
                continue
            relaunch = RELAUNCH_RE.match(line)
            if relaunch:
                relaunches[(epic, week_of(relaunch['date']))] += 1
    return blocks, relaunches


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print('usage: blocks_report.py <specs_dir>', file=sys.stderr)
        return 1
    specs_dir = Path(argv[0])
    if not specs_dir.is_dir():
        print(f'blocks_report: not a directory: {specs_dir}', file=sys.stderr)
        return 1
    blocks, relaunches = scan(specs_dir)
    print('epic\tweek\tcause\tcount')
    for (epic, week, cause), count in sorted(blocks.items()):
        print(f'{epic}\t{week}\t{cause}\t{count}')
    print()
    print('epic\tweek\trelaunches')
    for (epic, week), count in sorted(relaunches.items()):
        print(f'{epic}\t{week}\t{count}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
