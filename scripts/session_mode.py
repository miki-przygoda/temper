#!/usr/bin/env python3
"""Each session's latest permission mode, for the overnight pre-flight (spec 9).

Skills can't read the permission mode, so temper's UserPromptSubmit hook calls
``record`` on every prompt, whatever the prompt says, and the run skill's
pre-flight runs this script for its own session (SECOND-TESTS-DOCS-5):

    python3 scripts/session_mode.py <session_id>

prints ``{"auto": bool, "mode": ..., "age_s": ..., "reason": ...}`` and exits 0
only when this session's latest record is ``auto`` and under ``MAX_AGE_S``
seconds old. A missing, stale or unreadable record, another mode, or a usage
error all mean "not in auto mode" and exit 1.

The records live in ``<state>/session-mode.json``, a 0600 file. Stdlib only.
"""

import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from temper_paths import state_dir  # noqa: E402

FILE_NAME = 'session-mode.json'
MAX_AGE_S = 600       # the pre-flight runs in the turn of the prompt that asked for it
KEEP_S = 24 * 3600    # records older than this are dropped on the next write
MAX_SESSIONS = 32     # and only the newest this many are kept
_MAX_TEXT = 200


def _path(env):
    return state_dir(env) / FILE_NAME


def _text(value):
    return value if isinstance(value, str) and 0 < len(value) <= _MAX_TEXT else None


def _entries(env):
    """The saved records, each a dict with session_id, permission_mode and recorded_at."""
    try:
        data = json.loads(_path(env).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    sessions = data.get('sessions') if isinstance(data, dict) else None
    if not isinstance(sessions, list):
        return []
    entries = []
    for entry in sessions:
        if (isinstance(entry, dict) and _text(entry.get('session_id'))
                and isinstance(entry.get('recorded_at'), (int, float))
                and not isinstance(entry.get('recorded_at'), bool)):
            entries.append(entry)
    return entries


def record(hook_input, env=os.environ, now=None):
    """Save this prompt's session_id and permission_mode, replacing the session's older record."""
    session = _text(hook_input.get('session_id'))
    if session is None:
        return
    now = int(time.time()) if now is None else int(now)
    mode = hook_input.get('permission_mode')
    entries = [e for e in _entries(env)
               if e['session_id'] != session and now - e['recorded_at'] <= KEEP_S]
    entries.append({'session_id': session,
                    'permission_mode': mode if _text(mode) else None,
                    'recorded_at': now})
    entries.sort(key=lambda e: e['recorded_at'])
    entries = entries[-MAX_SESSIONS:]

    path = _path(env)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # mkstemp creates the file 0600, so the record is never readable by others.
    fd, tmp = tempfile.mkstemp(prefix='.' + FILE_NAME + '-', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(json.dumps({'sessions': entries}) + '\n')
        os.replace(tmp, str(path))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def check(session_id, env=os.environ, now=None):
    """Is this session in auto mode, by its latest record?"""
    now = int(time.time()) if now is None else int(now)
    session = _text(session_id)
    found = [e for e in _entries(env) if session is not None and e['session_id'] == session]
    if not found:
        return {'auto': False, 'mode': None, 'age_s': None,
                'reason': 'missing: no permission mode recorded for this session'}
    latest = max(found, key=lambda e: e['recorded_at'])
    mode = latest.get('permission_mode')
    age = now - int(latest['recorded_at'])
    if age > MAX_AGE_S or age < 0:
        return {'auto': False, 'mode': mode, 'age_s': age,
                'reason': 'stale: the latest record is %d seconds old' % age}
    if mode != 'auto':
        return {'auto': False, 'mode': mode, 'age_s': age,
                'reason': 'not auto: the permission mode is %r' % (mode,)}
    return {'auto': True, 'mode': mode, 'age_s': age, 'reason': 'auto mode'}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        result = {'auto': False, 'mode': None, 'age_s': None,
                  'reason': 'usage: session_mode.py <session_id>'}
    else:
        try:
            result = check(argv[0], os.environ)
        except Exception as exc:  # any surprise means "not in auto mode"
            result = {'auto': False, 'mode': None, 'age_s': None,
                      'reason': 'session_mode check failed: %s' % exc}
    print(json.dumps(result))
    return 0 if result['auto'] else 1


if __name__ == '__main__':
    sys.exit(main())
