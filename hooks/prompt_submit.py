"""UserPromptSubmit hook: the temper keyword and a permission-mode warning.

It matches only the ``prompt`` field of the hook input, never the raw JSON
(amendment A3). On every prompt, whatever it says, it also records the
session's permission mode for the overnight pre-flight (``session_mode.py``,
SECOND-TESTS-DOCS-5). It always exits 0 and prints nothing unless it has
context to add. Stdlib only.
"""

import json
import os
import re
import sys
from pathlib import Path

KEYWORD_LINE = ("The user's prompt used the temper keyword: handle it with the temper plugin, "
                "starting from the temper skill.")
MODE_LINE = ("temper: this session's permission mode is '{mode}'. Overnight runs need auto mode; "
             "tell the user before starting one.")


def decide(hook_input, prefs):
    """The context to add for this prompt, or None."""
    prompt = hook_input.get('prompt', '')
    if not isinstance(prompt, str):
        prompt = ''
    slash = prompt.lstrip().startswith('/temper')
    keyword = (prefs.get('keyword_trigger') == 'on'
               and re.search(r'\btemper\b', prompt, re.I) is not None
               and not slash)
    if not slash and not keyword:
        return None
    lines = []
    if keyword:
        lines.append(KEYWORD_LINE)
    mode = hook_input.get('permission_mode')
    if mode != 'auto':
        lines.append(MODE_LINE.format(mode=mode))
    return '\n'.join(lines) if lines else None


def _scripts_on_path():
    root = os.environ.get('CLAUDE_PLUGIN_ROOT') or str(Path(__file__).resolve().parent.parent)
    scripts = str(Path(root) / 'scripts')
    if scripts not in sys.path:
        sys.path.insert(0, scripts)


def _load_preferences():
    _scripts_on_path()
    import temper_paths
    return temper_paths.load_preferences(os.environ)


def _record_mode(hook_input):
    """Record the session's mode; a failure here never stops the prompt or the warning."""
    try:
        _scripts_on_path()
        import session_mode
        session_mode.record(hook_input, os.environ)
    except Exception:
        pass


def main():
    try:
        hook_input = json.loads(sys.stdin.read())
        if not isinstance(hook_input, dict):
            return
        _record_mode(hook_input)
        text = decide(hook_input, _load_preferences())
        if text:
            print(json.dumps({'hookSpecificOutput': {'hookEventName': 'UserPromptSubmit',
                                                     'additionalContext': text}}))
    except Exception:
        pass


if __name__ == '__main__':
    main()
    sys.exit(0)
