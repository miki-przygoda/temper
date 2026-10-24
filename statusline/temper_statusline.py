"""temper's statusline: records the usage limits, then shows the user's own statusline.

Claude Code runs this with the statusline JSON on stdin. When the input holds
``rate_limits``, they are written to ``<state>/limits.json``; otherwise the
earlier file is left alone. If the user had a statusline before temper, its
command (saved in ``<state>/wrapped-statusline.json``) gets the same input and
its output is printed. It is given up on after 2 seconds. Nothing here ever
fails loudly: on any error the script prints nothing and exits 0.
"""

import json
import os
import subprocess
import sys
import tempfile
import time

VERSION = '0.1.0'

WRAPPED_TIMEOUT_S = 2

_here = os.path.dirname(os.path.abspath(__file__))
# In <state>/bin/ the copy of temper_paths sits next to this file; in the plugin
# checkout it is in ../scripts/.
for _path in (os.path.join(os.path.dirname(_here), 'scripts'), _here):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import temper_paths  # noqa: E402


def _write_limits(state, rate_limits):
    state.mkdir(parents=True, exist_ok=True)
    data = {
        'version': 1,
        'seen_at': int(time.time()),
        'five_hour': rate_limits.get('five_hour'),
        'seven_day': rate_limits.get('seven_day'),
    }
    fd, tmp = tempfile.mkstemp(prefix='.limits-', suffix='.tmp', dir=str(state))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(data, handle)
        os.replace(tmp, str(state / 'limits.json'))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _record_limits(stdin_text, state):
    try:
        payload = json.loads(stdin_text)
        rate_limits = payload.get('rate_limits') if isinstance(payload, dict) else None
        if isinstance(rate_limits, dict) and (
                rate_limits.get('five_hour') is not None
                or rate_limits.get('seven_day') is not None):
            _write_limits(state, rate_limits)
    except Exception:
        pass


def _run_wrapped(command, stdin_text):
    try:
        result = subprocess.run(command, shell=True, input=stdin_text, capture_output=True,
                                text=True, timeout=WRAPPED_TIMEOUT_S)
    except (subprocess.TimeoutExpired, OSError, ValueError):
        return ''
    return result.stdout or ''


def main(stdin_text, env):
    """The text to print for this statusline input."""
    try:
        state = temper_paths.state_dir(env)
    except Exception:
        return ''
    _record_limits(stdin_text, state)
    try:
        wrapped_path = state / 'wrapped-statusline.json'
        if not wrapped_path.is_file():
            return ''
        wrapped = json.loads(wrapped_path.read_text(encoding='utf-8'))
        command = wrapped.get('command') if isinstance(wrapped, dict) else None
        if not isinstance(command, str) or not command:
            return ''
        return _run_wrapped(command, stdin_text)
    except Exception:
        return ''


if __name__ == '__main__':
    try:
        out = main(sys.stdin.read(), os.environ)
    except Exception:
        out = ''
    try:
        sys.stdout.write(out)
        sys.stdout.flush()
    except Exception:
        pass
    sys.exit(0)
