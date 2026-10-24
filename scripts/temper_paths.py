"""Where temper keeps the user's state, and the user's preferences.

State lives in ``$CLAUDE_CONFIG_DIR/temper/`` when ``CLAUDE_CONFIG_DIR`` is set
and non-empty, else in ``~/.claude/temper/`` (amendment A1). Stdlib only.
"""

import os
from pathlib import Path

DEFAULT_PREFERENCES = {
    'version': '1',
    'question_style': 'open-then-boxes',
    'severe_contact': 'report',
    'overnight_without_plan_review': 'no',
    'may_push': 'ask',
    'overnight_fix_default': 'critical+important',
    'wakeups_approved': 'no',
    'morning_report_time': '07:00',
    'weekly_stop_percent': '90',
    'keyword_trigger': 'off',
}


def _config_base(env):
    configured = env.get('CLAUDE_CONFIG_DIR')
    if configured:
        return Path(configured)
    return Path.home() / '.claude'


def state_dir(env=os.environ):
    """The temper state directory for this Claude Code config."""
    return _config_base(env) / 'temper'


def settings_path(env=os.environ):
    """The Claude Code user settings file for this config."""
    return _config_base(env) / 'settings.json'


def parse_preferences(text):
    """The defaults, updated with the ``key: value`` lines of the front block.

    The front block is the text between the first two ``---`` lines. Blank lines
    and lines starting with ``#`` are ignored. Without a front block, the
    defaults are returned unchanged.
    """
    prefs = dict(DEFAULT_PREFERENCES)
    lines = text.splitlines()
    fences = [i for i, line in enumerate(lines) if line.strip() == '---']
    if len(fences) < 2:
        return prefs
    for line in lines[fences[0] + 1:fences[1]]:
        line = line.strip()
        if not line or line.startswith('#') or ':' not in line:
            continue
        key, value = line.split(':', 1)
        prefs[key.strip()] = value.strip()
    return prefs


def load_preferences(env=os.environ):
    """The preferences in ``<state>/preferences.md``, or the defaults when it's missing."""
    path = state_dir(env) / 'preferences.md'
    try:
        text = path.read_text(encoding='utf-8')
    except FileNotFoundError:
        return dict(DEFAULT_PREFERENCES)
    return parse_preferences(text)
