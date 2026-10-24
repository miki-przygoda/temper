"""Install, uninstall or report on temper's statusline.

    python3 scripts/install_statusline.py install|uninstall|status

prints a JSON object and exits 0, or exits 1 on a usage error or a failure.

The plugin's cache path changes with every version, so ``install`` copies the
statusline script and ``temper_paths.py`` to ``<state>/bin/`` and points the
user settings there (amendment A4). A statusline the user already had is saved
in ``<state>/wrapped-statusline.json``, run by temper's, and put back by
``uninstall``. Stdlib only.
"""

import json
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from temper_paths import settings_path, state_dir  # noqa: E402

STATUSLINE_NAME = 'temper_statusline.py'
_VERSION_RE = re.compile(r"""^VERSION\s*=\s*['"]([^'"]+)['"]""", re.M)


def _read_version(path):
    """The ``VERSION`` constant in a statusline script, read without running it."""
    try:
        match = _VERSION_RE.search(Path(path).read_text(encoding='utf-8'))
    except OSError:
        return None
    return match.group(1) if match else None


def _read_json(path, default):
    try:
        text = Path(path).read_text(encoding='utf-8')
    except FileNotFoundError:
        return default
    return json.loads(text)


def _write_atomic(path, text):
    # Resolve a symlinked file (settings.json in a dotfiles repo) so the
    # replace lands on its target and the link survives. A target in a
    # directory we cannot write (Nix home-manager links into /nix/store)
    # falls back to replacing the link itself with the new file.
    link = Path(path)
    target = Path(os.path.realpath(str(link)))
    if target == link:
        _replace_file(link, text)
        return
    try:
        _replace_file(target, text)
    except OSError:
        _replace_file(link, text)


def _replace_file(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name + '-', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(text)
        if path.exists():
            shutil.copymode(str(path), tmp)
        os.replace(tmp, str(path))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _write_json(path, data):
    _write_atomic(path, json.dumps(data, indent=2) + '\n')


def _is_temper(status_line):
    return (isinstance(status_line, dict)
            and STATUSLINE_NAME in str(status_line.get('command', '')))


def _load_settings(env):
    settings = _read_json(settings_path(env), {})
    if not isinstance(settings, dict):
        raise ValueError('%s does not hold a JSON object' % settings_path(env))
    return settings


def install(plugin_root, env=os.environ):
    plugin_root = Path(plugin_root)
    state = state_dir(env)
    bin_dir = state / 'bin'
    bin_dir.mkdir(parents=True, exist_ok=True)
    source = plugin_root / 'statusline' / STATUSLINE_NAME
    shutil.copyfile(str(source), str(bin_dir / STATUSLINE_NAME))
    shutil.copyfile(str(plugin_root / 'scripts' / 'temper_paths.py'), str(bin_dir / 'temper_paths.py'))

    settings_file = settings_path(env)
    settings = _load_settings(env)
    wrapped_path = state / 'wrapped-statusline.json'
    current = settings.get('statusLine')
    if current is not None and not _is_temper(current):
        _write_json(wrapped_path, current)

    backup = state / 'settings.backup.json'
    if not backup.exists():
        if settings_file.exists():
            shutil.copyfile(str(settings_file), str(backup))
        else:
            _write_json(backup, {})

    settings['statusLine'] = {
        'type': 'command',
        'command': "python3 '%s'" % (bin_dir / STATUSLINE_NAME),
    }
    _write_json(settings_file, settings)
    return {'installed': True, 'wrapped': wrapped_path.is_file(), 'version': _read_version(source)}


def uninstall(env=os.environ):
    state = state_dir(env)
    wrapped_path = state / 'wrapped-statusline.json'
    settings = _load_settings(env)
    current = settings.get('statusLine')
    # A statusline the user set after installing temper's is theirs: leave it.
    if current is None or _is_temper(current):
        if wrapped_path.is_file():
            settings['statusLine'] = _read_json(wrapped_path, None)
        else:
            settings.pop('statusLine', None)
        if settings_path(env).exists() or 'statusLine' in settings:
            _write_json(settings_path(env), settings)
    try:
        wrapped_path.unlink()
    except FileNotFoundError:
        pass
    return {'installed': False}


def status(env=os.environ):
    state = state_dir(env)
    try:
        installed = _is_temper(_load_settings(env).get('statusLine'))
    except (OSError, ValueError):
        installed = False
    limits_age_s = None
    try:
        seen_at = _read_json(state / 'limits.json', {}).get('seen_at')
        if isinstance(seen_at, (int, float)) and not isinstance(seen_at, bool):
            limits_age_s = int(time.time()) - int(seen_at)
    except (OSError, ValueError, AttributeError):
        pass
    return {
        'installed': installed,
        'copied_version': _read_version(state / 'bin' / STATUSLINE_NAME),
        'limits_age_s': limits_age_s,
    }


def _main(argv):
    actions = ('install', 'uninstall', 'status')
    if len(argv) != 2 or argv[1] not in actions:
        sys.stderr.write('usage: install_statusline.py install|uninstall|status\n')
        return 1
    action = argv[1]
    try:
        if action == 'install':
            result = install(Path(__file__).resolve().parent.parent, os.environ)
        elif action == 'uninstall':
            result = uninstall(os.environ)
        else:
            result = status(os.environ)
    except Exception as exc:
        sys.stderr.write('install_statusline.py %s failed: %s\n' % (action, exc))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(_main(sys.argv))
