import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))

import temper_paths  # noqa: E402
from temper_paths import DEFAULT_PREFERENCES, parse_preferences, state_dir  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


statusline = _load('temper_statusline', ROOT / 'statusline' / 'temper_statusline.py')
installer = _load('install_statusline', ROOT / 'scripts' / 'install_statusline.py')

RATE_LIMITS = {
    'five_hour': {'used_percentage': 15, 'resets_at': 1792868400},
    'seven_day': {'used_percentage': 47, 'resets_at': 1793232000},
}


class TempConfig(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.config = Path(self._tmp.name)
        self.env = {'CLAUDE_CONFIG_DIR': str(self.config)}
        self.state = self.config / 'temper'
        self.settings = self.config / 'settings.json'

    def tearDown(self):
        self._tmp.cleanup()

    def write_settings(self, data):
        self.settings.write_text(json.dumps(data), encoding='utf-8')

    def read_settings(self):
        return json.loads(self.settings.read_text(encoding='utf-8'))

    def wrap(self, command):
        self.state.mkdir(parents=True, exist_ok=True)
        (self.state / 'wrapped-statusline.json').write_text(
            json.dumps({'type': 'command', 'command': command}), encoding='utf-8')


class PathsTest(TempConfig):
    def test_state_dir_uses_claude_config_dir(self):
        self.assertEqual(state_dir({'CLAUDE_CONFIG_DIR': '/x'}), Path('/x/temper'))

    def test_state_dir_defaults_to_home_claude(self):
        self.assertTrue(str(state_dir({})).endswith(os.path.join('.claude', 'temper')))

    def test_state_dir_ignores_empty_config_dir(self):
        self.assertEqual(state_dir({'CLAUDE_CONFIG_DIR': ''}), Path.home() / '.claude' / 'temper')

    def test_settings_path_uses_the_same_base(self):
        self.assertEqual(temper_paths.settings_path({'CLAUDE_CONFIG_DIR': '/x'}), Path('/x/settings.json'))
        self.assertEqual(temper_paths.settings_path({}), Path.home() / '.claude' / 'settings.json')


class PreferencesTest(TempConfig):
    def test_front_block_overrides_defaults(self):
        prefs = parse_preferences('---\nkeyword_trigger: on\n# c\n---\nfree text')
        self.assertEqual(prefs['keyword_trigger'], 'on')
        for key, value in DEFAULT_PREFERENCES.items():
            if key != 'keyword_trigger':
                self.assertEqual(prefs[key], value)

    def test_no_front_block_gives_defaults(self):
        self.assertEqual(parse_preferences('no front block'), DEFAULT_PREFERENCES)

    def test_defaults(self):
        self.assertEqual(DEFAULT_PREFERENCES, {
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
        })

    def test_load_preferences_missing_file_gives_defaults(self):
        self.assertEqual(temper_paths.load_preferences(self.env), DEFAULT_PREFERENCES)

    def test_load_preferences_reads_state_file(self):
        self.state.mkdir(parents=True)
        (self.state / 'preferences.md').write_text(
            '---\nmay_push: yes\nmorning_report_time: 06:30\n---\n', encoding='utf-8')
        prefs = temper_paths.load_preferences(self.env)
        self.assertEqual(prefs['may_push'], 'yes')
        self.assertEqual(prefs['morning_report_time'], '06:30')
        self.assertEqual(prefs['keyword_trigger'], 'off')

    def test_load_preferences_does_not_share_the_defaults_dict(self):
        temper_paths.load_preferences(self.env)['may_push'] = 'yes'
        self.assertEqual(DEFAULT_PREFERENCES['may_push'], 'ask')


class StatuslineTest(TempConfig):
    def limits(self):
        return json.loads((self.state / 'limits.json').read_text(encoding='utf-8'))

    def test_version_constant(self):
        self.assertEqual(statusline.VERSION, '0.1.0')

    def test_rate_limits_are_written(self):
        before = int(time.time())
        out = statusline.main(json.dumps({'rate_limits': RATE_LIMITS}), self.env)
        self.assertEqual(out, '')
        limits = self.limits()
        self.assertEqual(limits['version'], 1)
        self.assertEqual(limits['five_hour']['resets_at'], 1792868400)
        self.assertEqual(limits['seven_day'], RATE_LIMITS['seven_day'])
        self.assertGreaterEqual(limits['seen_at'], before)
        self.assertEqual(sorted(p.name for p in self.state.iterdir()), ['limits.json'])

    def test_missing_rate_limits_keep_the_earlier_file(self):
        statusline.main(json.dumps({'rate_limits': RATE_LIMITS}), self.env)
        before = (self.state / 'limits.json').read_bytes()
        statusline.main(json.dumps({'model': {'id': 'x'}}), self.env)
        statusline.main(json.dumps({'rate_limits': {}}), self.env)
        statusline.main('not json', self.env)
        self.assertEqual((self.state / 'limits.json').read_bytes(), before)

    def test_wrapped_command_output_is_returned(self):
        self.wrap('printf hi')
        self.assertEqual(statusline.main(json.dumps({'rate_limits': RATE_LIMITS}), self.env), 'hi')

    def test_wrapped_command_gets_the_statusline_input(self):
        self.wrap('cat')
        text = json.dumps({'cwd': '/x'})
        self.assertEqual(statusline.main(text, self.env), text)

    def test_slow_wrapped_command_gives_up_and_limits_are_written(self):
        self.wrap('sleep 5')
        start = time.monotonic()
        out = statusline.main(json.dumps({'rate_limits': RATE_LIMITS}), self.env)
        self.assertLess(time.monotonic() - start, 3)
        self.assertEqual(out, '')
        self.assertEqual(self.limits()['five_hour']['resets_at'], 1792868400)

    def test_slow_wrapped_child_holding_the_pipe_gives_up(self):
        self.wrap('sleep 5; echo late')
        start = time.monotonic()
        out = statusline.main('{}', self.env)
        self.assertLess(time.monotonic() - start, 3)
        self.assertEqual(out, '')

    def test_wrapped_command_nonzero_exit_still_returns_its_output(self):
        self.wrap('printf partial; exit 3')
        self.assertEqual(statusline.main('{}', self.env), 'partial')

    def test_script_prints_empty_on_bad_input(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / 'statusline' / 'temper_statusline.py')],
            input='not json', capture_output=True, text=True, timeout=10,
            env={**os.environ, **self.env})
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')


class InstallTest(TempConfig):
    def install(self):
        return installer.install(ROOT, self.env)

    def test_install_wraps_the_existing_statusline(self):
        self.write_settings({'theme': 'dark', 'statusLine': {'type': 'command', 'command': 'mine.sh'}})
        result = self.install()
        self.assertEqual(result, {'installed': True, 'wrapped': True, 'version': '0.1.0'})
        settings = self.read_settings()
        self.assertIn('temper_statusline.py', settings['statusLine']['command'])
        self.assertEqual(settings['statusLine']['type'], 'command')
        self.assertEqual(settings['theme'], 'dark')
        wrapped = json.loads((self.state / 'wrapped-statusline.json').read_text(encoding='utf-8'))
        self.assertEqual(wrapped['command'], 'mine.sh')
        self.assertTrue((self.state / 'bin' / 'temper_statusline.py').is_file())
        self.assertTrue((self.state / 'bin' / 'temper_paths.py').is_file())
        backup = json.loads((self.state / 'settings.backup.json').read_text(encoding='utf-8'))
        self.assertEqual(backup['statusLine']['command'], 'mine.sh')

    def test_command_points_at_the_copy_in_the_state_dir(self):
        self.write_settings({})
        self.install()
        expected = "python3 '%s'" % (self.state / 'bin' / 'temper_statusline.py')
        self.assertEqual(self.read_settings()['statusLine'],
                         {'type': 'command', 'command': expected})

    def test_second_install_keeps_the_wrapped_command(self):
        self.write_settings({'theme': 'dark', 'statusLine': {'type': 'command', 'command': 'mine.sh'}})
        self.install()
        settings_once = self.read_settings()
        backup_once = (self.state / 'settings.backup.json').read_bytes()
        result = self.install()
        self.assertTrue(result['wrapped'])
        wrapped = json.loads((self.state / 'wrapped-statusline.json').read_text(encoding='utf-8'))
        self.assertEqual(wrapped['command'], 'mine.sh')
        self.assertEqual(self.read_settings(), settings_once)
        self.assertEqual((self.state / 'settings.backup.json').read_bytes(), backup_once)

    def test_uninstall_puts_back_the_wrapped_statusline(self):
        self.write_settings({'theme': 'dark', 'statusLine': {'type': 'command', 'command': 'mine.sh'}})
        self.install()
        self.assertEqual(installer.uninstall(self.env), {'installed': False})
        settings = self.read_settings()
        self.assertEqual(settings['statusLine'], {'type': 'command', 'command': 'mine.sh'})
        self.assertEqual(settings['theme'], 'dark')
        self.assertFalse((self.state / 'wrapped-statusline.json').exists())

    def test_install_without_statusline_then_uninstall_removes_the_key(self):
        self.write_settings({'theme': 'dark'})
        result = self.install()
        self.assertFalse(result['wrapped'])
        self.assertFalse((self.state / 'wrapped-statusline.json').exists())
        installer.uninstall(self.env)
        self.assertEqual(self.read_settings(), {'theme': 'dark'})

    def test_symlinked_settings_stay_a_link_through_install_and_uninstall(self):
        dotfiles = self.config / 'dotfiles'
        dotfiles.mkdir()
        target = dotfiles / 'settings.json'
        target.write_text(json.dumps(
            {'theme': 'dark', 'statusLine': {'command': 'echo mine'}}), encoding='utf-8')
        self.settings.symlink_to(target)
        self.install()
        self.assertTrue(self.settings.is_symlink())
        self.assertIn('temper_statusline.py',
                      json.loads(target.read_text(encoding='utf-8'))['statusLine']['command'])
        installer.uninstall(self.env)
        self.assertTrue(self.settings.is_symlink())
        self.assertEqual(json.loads(target.read_text(encoding='utf-8')),
                         {'theme': 'dark', 'statusLine': {'command': 'echo mine'}})

    def test_install_without_settings_file(self):
        self.install()
        self.assertIn('temper_statusline.py', self.read_settings()['statusLine']['command'])

    def test_install_refreshes_a_stale_copy(self):
        self.write_settings({})
        self.install()
        copy = self.state / 'bin' / 'temper_statusline.py'
        copy.write_text(copy.read_text(encoding='utf-8').replace(
            "VERSION = '0.1.0'", "VERSION = '0.0.9'"), encoding='utf-8')
        self.assertEqual(installer.status(self.env)['copied_version'], '0.0.9')
        self.install()
        self.assertIn("VERSION = '0.1.0'", copy.read_text(encoding='utf-8'))
        self.assertEqual(installer.status(self.env)['copied_version'], '0.1.0')

    def test_status(self):
        self.assertEqual(installer.status(self.env),
                         {'installed': False, 'copied_version': None, 'limits_age_s': None})
        self.write_settings({})
        self.install()
        statusline.main(json.dumps({'rate_limits': RATE_LIMITS}), self.env)
        status = installer.status(self.env)
        self.assertTrue(status['installed'])
        self.assertEqual(status['copied_version'], '0.1.0')
        self.assertIsInstance(status['limits_age_s'], int)
        self.assertLess(status['limits_age_s'], 60)

    def test_installed_copy_runs(self):
        self.write_settings({})
        self.install()
        self.wrap('printf wrapped')
        result = subprocess.run(
            [sys.executable, str(self.state / 'bin' / 'temper_statusline.py')],
            input=json.dumps({'rate_limits': RATE_LIMITS}), capture_output=True, text=True,
            timeout=10, env={**os.environ, **self.env})
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, 'wrapped')
        self.assertTrue((self.state / 'limits.json').is_file())

    def test_cli_prints_json(self):
        env = {**os.environ, **self.env}
        script = str(ROOT / 'scripts' / 'install_statusline.py')
        for action, installed in (('install', True), ('status', True), ('uninstall', False)):
            result = subprocess.run([sys.executable, script, action], capture_output=True,
                                    text=True, timeout=10, env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['installed'], installed)
        bad = subprocess.run([sys.executable, script, 'nope'], capture_output=True,
                             text=True, timeout=10, env=env)
        self.assertEqual(bad.returncode, 1)


if __name__ == '__main__':
    unittest.main()
