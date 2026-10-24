"""Acceptance tests for the state group (docs/v1-behaviour.md, STATE-01..16).

The Python scripts are driven through their CLIs with subprocess, the way setup, the run skill
and Claude Code run them: ``install_statusline.py install|uninstall|status``, the statusline
command written into the settings (run through ``sh -c`` as Claude Code does), and the prompt
hook. Every run has its own temporary ``CLAUDE_CONFIG_DIR`` and ``HOME``, so the user's own
config is never read or written. What the head does (setup, preference changes, the run skill's
re-copy and pre-flight) is read from the skills, then the product is checked against it.

A test that fails because of the product is skipped with "acceptance-failing: <id>".
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SETUP_SKILL = (ROOT / 'skills' / 'setup' / 'SKILL.md').read_text(encoding='utf-8')
RUN_SKILL = (ROOT / 'skills' / 'run' / 'SKILL.md').read_text(encoding='utf-8')

RATE_LIMITS = {
    'five_hour': {'used_percentage': 23.5, 'resets_at': 1792868400},
    'seven_day': {'used_percentage': 61, 'resets_at': 1793232000},
}
STATUS_INPUT = {
    'session_id': 's-1',
    'model': {'id': 'claude-x', 'display_name': 'X'},
    'workspace': {'current_dir': '/w'},
    'rate_limits': RATE_LIMITS,
}

INTERVIEW_KEYS = ['question_style', 'severe_contact', 'overnight_without_plan_review', 'may_push',
                  'overnight_fix_default', 'wakeups_approved', 'morning_report_time',
                  'keyword_trigger']


def front_block(text):
    """The key: value lines between the first two --- lines, comments skipped."""
    lines = text.splitlines()
    fences = [i for i, line in enumerate(lines) if line.strip() == '---']
    out = {}
    for line in lines[fences[0] + 1:fences[1]]:
        line = line.strip()
        if line and not line.startswith('#') and ':' in line:
            key, value = line.split(':', 1)
            out[key.strip()] = value.strip()
    return out


class Sandbox(unittest.TestCase):
    """A throwaway HOME and CLAUDE_CONFIG_DIR, and a copy of the plugin in a fake cache path."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(os.path.realpath(self._tmp.name))
        self.home = self.tmp / 'home'
        self.home.mkdir()
        self.config = self.tmp / 'config'
        self.config.mkdir()
        self.state = self.config / 'temper'
        self.settings = self.config / 'settings.json'

    def tearDown(self):
        self._tmp.cleanup()

    def env(self, config=None, **extra):
        env = {k: v for k, v in os.environ.items() if k != 'CLAUDE_CONFIG_DIR'}
        env['HOME'] = str(self.home)
        env['CLAUDE_CONFIG_DIR'] = str(self.config) if config is None else config
        if config is False:
            del env['CLAUDE_CONFIG_DIR']
        env.update(extra)
        return env

    def plugin_copy(self, version='0.1.0'):
        """The plugin as Claude Code caches it: a versioned directory that the next update replaces."""
        dest = self.tmp / 'plugins' / 'cache' / 'temper' / 'temper' / version
        if not dest.exists():
            shutil.copytree(str(ROOT), str(dest), ignore=shutil.ignore_patterns(
                '.git', 'node_modules', '__pycache__', 'test', 'tests_py'))
            if version != '0.1.0':
                script = dest / 'statusline' / 'temper_statusline.py'
                text = script.read_text(encoding='utf-8')
                self.assertIn("VERSION = '0.1.0'", text)
                script.write_text(text.replace("VERSION = '0.1.0'", "VERSION = '%s'" % version),
                                  encoding='utf-8')
        return dest

    def installer(self, action, plugin=None, env=None):
        plugin = plugin or self.plugin_copy()
        result = subprocess.run(
            [sys.executable, str(plugin / 'scripts' / 'install_statusline.py'), action],
            capture_output=True, text=True, timeout=30, env=env or self.env())
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def write_settings(self, data):
        self.settings.write_text(json.dumps(data, indent=2), encoding='utf-8')

    def read_settings(self):
        return json.loads(self.settings.read_text(encoding='utf-8'))

    def run_statusline_setting(self, payload, timeout=20):
        """Run the statusLine command from the settings the way Claude Code does."""
        command = self.read_settings()['statusLine']['command']
        start = time.monotonic()
        result = subprocess.run(['sh', '-c', command], input=json.dumps(payload),
                                capture_output=True, text=True, timeout=timeout, env=self.env())
        return result, time.monotonic() - start

    def run_statusline_script(self, payload, env):
        return subprocess.run(
            [sys.executable, str(ROOT / 'statusline' / 'temper_statusline.py')],
            input=json.dumps(payload), capture_output=True, text=True, timeout=20, env=env)

    def run_hook(self, prompt, env):
        result = subprocess.run(
            [sys.executable, str(ROOT / 'hooks' / 'prompt_submit.py')],
            input=json.dumps({'prompt': prompt, 'permission_mode': 'auto',
                              'hook_event_name': 'UserPromptSubmit'}),
            capture_output=True, text=True, timeout=20, env={**env, 'CLAUDE_PLUGIN_ROOT': str(ROOT)})
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def load_preferences(self, env):
        """temper's own preference loader, run in a child with the given environment."""
        code = ('import json, sys; sys.path.insert(0, %r); import temper_paths; '
                'print(json.dumps(temper_paths.load_preferences()))' % str(ROOT / 'scripts'))
        result = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True,
                                timeout=20, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def setup_preferences(self, state, answers):
        """Setup step 4: copy the template to <state>/preferences.md and fill in the answers."""
        state.mkdir(parents=True, exist_ok=True)
        lines = (ROOT / 'templates' / 'preferences.md').read_text(encoding='utf-8').splitlines()
        fences = [i for i, line in enumerate(lines) if line.strip() == '---']
        for i in range(fences[0] + 1, fences[1]):
            key = lines[i].split(':', 1)[0].strip()
            if not lines[i].lstrip().startswith('#') and key in answers:
                lines[i] = '%s: %s' % (key, answers[key])
        (state / 'preferences.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
        return state / 'preferences.md'


class StateAcceptance(Sandbox):

    def test_STATE_01_config_dir_set_uses_its_temper_dir(self):
        env = self.env()
        # Writes: the statusline's limits.json, and the install's copy and settings.
        result = self.run_statusline_script(STATUS_INPUT, env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.state / 'limits.json').is_file())
        self.installer('install', env=env)
        self.assertTrue((self.state / 'bin' / 'temper_statusline.py').is_file())
        self.assertIn(str(self.state / 'bin'), self.read_settings()['statusLine']['command'])
        # Reads: the hook takes its preferences from $CLAUDE_CONFIG_DIR/temper/preferences.md.
        self.setup_preferences(self.state, {'keyword_trigger': 'on'})
        self.assertIn('temper keyword', self.run_hook('please temper this branch', env))
        self.assertEqual(self.installer('status', env=env)['copied_version'], '0.1.0')
        # Nothing went to ~/.claude.
        self.assertFalse((self.home / '.claude').exists())

    def test_STATE_02_config_dir_unset_or_empty_uses_home_claude_temper(self):
        default_state = self.home / '.claude' / 'temper'
        for name, env in (('unset', self.env(config=False)), ('empty', self.env(config=''))):
            with self.subTest(name):
                shutil.rmtree(str(self.home / '.claude'), ignore_errors=True)
                result = self.run_statusline_script(STATUS_INPUT, env)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue((default_state / 'limits.json').is_file(), name)
                self.installer('install', env=env)
                self.assertTrue((default_state / 'bin' / 'temper_statusline.py').is_file(), name)
                settings = json.loads((self.home / '.claude' / 'settings.json').read_text(encoding='utf-8'))
                self.assertIn(str(default_state / 'bin'), settings['statusLine']['command'])
                self.setup_preferences(default_state, {'keyword_trigger': 'on'})
                self.assertIn('temper keyword', self.run_hook('please temper this', env))
                self.assertEqual(sorted(p.name for p in self.config.iterdir()), [], name)
        self.assertIn('else `~/.claude/temper/`', SETUP_SKILL)

    def test_STATE_03_after_setup_the_state_dir_holds_preferences_with_answers_and_version(self):
        # The setup skill writes the answers to <state>/preferences.md from the template.
        self.assertIn('Copy `${CLAUDE_PLUGIN_ROOT}/templates/preferences.md` to `<state>/preferences.md`',
                      SETUP_SKILL)
        template = front_block((ROOT / 'templates' / 'preferences.md').read_text(encoding='utf-8'))
        self.assertIn('version', template)
        for key in INTERVIEW_KEYS:
            self.assertIn(key, template, key)
            self.assertIn('`%s`' % key, SETUP_SKILL, key)
        answers = {
            'question_style': 'boxes', 'severe_contact': 'push', 'overnight_without_plan_review': 'yes',
            'may_push': 'yes', 'overnight_fix_default': 'critical', 'wakeups_approved': 'yes',
            'morning_report_time': '06:00', 'keyword_trigger': 'on',
        }
        self.setup_preferences(self.state, answers)
        self.assertIn('preferences.md', [p.name for p in self.state.iterdir()])
        on_disk = front_block((self.state / 'preferences.md').read_text(encoding='utf-8'))
        self.assertEqual(on_disk['version'], '1')
        prefs = self.load_preferences(self.env())
        for key, value in answers.items():
            self.assertEqual(prefs[key], value, key)
        self.assertEqual(prefs['version'], '1')

    def test_STATE_04_no_preferences_gives_the_defaults(self):
        env = self.env()
        self.assertFalse((self.state / 'preferences.md').exists())
        prefs = self.load_preferences(env)
        self.assertEqual(prefs['keyword_trigger'], 'off')
        self.assertEqual(prefs['morning_report_time'], '07:00')
        self.assertEqual(set(prefs['overnight_fix_default'].split('+')), {'critical', 'important'})
        self.assertEqual(prefs['weekly_stop_percent'], '90')
        # The keyword trigger is off: the word alone adds no context.
        self.assertEqual(self.run_hook('can you temper the steel', env), '')
        # The template the setup starts from has the same defaults.
        template = front_block((ROOT / 'templates' / 'preferences.md').read_text(encoding='utf-8'))
        self.assertEqual(template['keyword_trigger'], 'off')
        self.assertEqual(template['morning_report_time'], '07:00')
        self.assertEqual(template['overnight_fix_default'], 'critical+important')
        self.assertEqual(template['weekly_stop_percent'], '90')

    def test_STATE_05_a_plugin_update_leaves_preferences_unchanged(self):
        old = self.plugin_copy('0.1.0')
        new = self.plugin_copy('0.2.0')
        env = self.env()
        prefs = self.setup_preferences(self.state, {'may_push': 'yes', 'keyword_trigger': 'on'})
        prefs.write_text(prefs.read_text(encoding='utf-8') + '\nMy own note.\n', encoding='utf-8')
        before = prefs.read_bytes()
        # The state dir is outside both plugin directories.
        for plugin in (old, new):
            self.assertNotIn(str(plugin), str(prefs))
            self.assertFalse(str(prefs.resolve()).startswith(str(plugin.resolve()) + os.sep))
        self.installer('install', plugin=old, env=env)
        # The update: the old cache dir goes, the new one comes, /temper:run re-copies the script.
        shutil.rmtree(str(old))
        self.installer('install', plugin=new, env=env)
        self.assertEqual(prefs.read_bytes(), before)
        self.assertEqual(self.load_preferences(env)['may_push'], 'yes')

    def test_STATE_06_a_preference_change_is_written_to_the_state_preferences(self):
        # The head is told to make the change in <state>/preferences.md.
        self.assertRegex(SETUP_SKILL, r'change, undo or specialise any choice')
        self.assertIn('edit that key in `<state>/preferences.md`', SETUP_SKILL)
        env = self.env()
        prefs = self.setup_preferences(self.state, {})
        self.assertEqual(self.run_hook('temper the epic', env), '')
        # "Turn on the temper keyword": the head edits that key in place.
        text = prefs.read_text(encoding='utf-8')
        self.assertIn('keyword_trigger: off', text)
        prefs.write_text(text.replace('keyword_trigger: off', 'keyword_trigger: on'), encoding='utf-8')
        self.assertIn('temper keyword', self.run_hook('temper the epic', env))
        self.assertEqual(self.load_preferences(env)['keyword_trigger'], 'on')
        # "Undo that": back to off, and temper reads the change.
        prefs.write_text(text, encoding='utf-8')
        self.assertEqual(self.run_hook('temper the epic', env), '')

    def test_STATE_08_statusline_writes_limits_json_as_received(self):
        before = int(time.time())
        result = self.run_statusline_script(STATUS_INPUT, self.env())
        after = int(time.time())
        self.assertEqual(result.returncode, 0, result.stderr)
        limits = json.loads((self.state / 'limits.json').read_text(encoding='utf-8'))
        self.assertEqual(limits['five_hour'], RATE_LIMITS['five_hour'])
        self.assertEqual(limits['seven_day'], RATE_LIMITS['seven_day'])
        self.assertIsInstance(limits['seen_at'], (int, float))
        self.assertTrue(before - 1 <= limits['seen_at'] <= after + 1, limits['seen_at'])

    def user_statusline(self):
        """A statusline the user had before temper: it records its input and prints a line."""
        script = self.tmp / 'my_statusline.sh'
        script.write_text('#!/bin/sh\ncat > "%s"\nprintf "MY-STATUS-LINE"\n' % (self.tmp / 'seen.json'),
                          encoding='utf-8')
        script.chmod(0o755)
        return {'type': 'command', 'command': "sh '%s'" % script, 'padding': 1}

    def test_STATE_09_the_users_statusline_runs_with_the_same_input_and_its_output_shows(self):
        self.write_settings({'statusLine': self.user_statusline()})
        self.installer('install')
        result, _ = self.run_statusline_setting(STATUS_INPUT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'MY-STATUS-LINE')
        self.assertEqual(json.loads((self.tmp / 'seen.json').read_text(encoding='utf-8')), STATUS_INPUT)
        self.assertTrue((self.state / 'limits.json').is_file())

    def test_STATE_10_a_failing_or_hanging_wrapped_statusline_still_writes_limits_and_returns(self):
        cases = {
            'fails': 'echo boom >&2; exit 7',
            'hangs': 'sleep 8; echo late',
            'missing': '/nonexistent/statusline-command',
        }
        for name, command in cases.items():
            with self.subTest(name):
                shutil.rmtree(str(self.config))
                self.config.mkdir()
                self.write_settings({'statusLine': {'type': 'command', 'command': command}})
                self.installer('install')
                result, elapsed = self.run_statusline_setting(STATUS_INPUT, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertLess(elapsed, 6, name)
                limits = json.loads((self.state / 'limits.json').read_text(encoding='utf-8'))
                self.assertEqual(limits['five_hour'], RATE_LIMITS['five_hour'])
                self.assertEqual(limits['seven_day'], RATE_LIMITS['seven_day'])

    def test_STATE_11_install_copies_into_state_bin_and_points_the_setting_at_the_copy(self):
        self.assertIn('install_statusline.py" install', SETUP_SKILL)
        plugin = self.plugin_copy()
        out = self.installer('install', plugin=plugin)
        self.assertTrue(out['installed'])
        copy = self.state / 'bin' / 'temper_statusline.py'
        self.assertTrue(copy.is_file())
        self.assertEqual(copy.read_bytes(), (plugin / 'statusline' / 'temper_statusline.py').read_bytes())
        command = self.read_settings()['statusLine']['command']
        self.assertIn(str(copy), command)
        self.assertNotIn(str(plugin), command)
        self.assertNotIn('plugins/cache', command)
        # The copy keeps working once the plugin's cache dir is gone (the next update).
        shutil.rmtree(str(plugin))
        result, _ = self.run_statusline_setting(STATUS_INPUT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.state / 'limits.json').is_file())

    def test_STATE_12_an_existing_statusline_is_kept_for_wrapping_and_other_settings_are_untouched(self):
        mine = self.user_statusline()
        original = {
            'theme': 'dark',
            'model': 'opus',
            'permissions': {'allow': ['Bash(ls:*)'], 'deny': ['Bash(sudo:*)'], 'defaultMode': 'auto'},
            'env': {'FOO': 'bar'},
            'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': 'echo done'}]}]},
            'autoContinueAtUsageLimit': True,
            'statusLine': mine,
            'enabledPlugins': {'temper@temper': True},
        }
        self.write_settings(original)
        out = self.installer('install')
        self.assertTrue(out['wrapped'])
        wrapped = json.loads((self.state / 'wrapped-statusline.json').read_text(encoding='utf-8'))
        self.assertEqual(wrapped['command'], mine['command'])
        after = self.read_settings()
        self.assertNotEqual(after['statusLine'], mine)
        self.assertEqual({k: v for k, v in after.items() if k != 'statusLine'},
                         {k: v for k, v in original.items() if k != 'statusLine'})
        result, _ = self.run_statusline_setting(STATUS_INPUT)
        self.assertEqual(result.stdout, 'MY-STATUS-LINE')

    def test_STATE_13_installing_again_never_wraps_temper_itself(self):
        mine = self.user_statusline()
        self.write_settings({'theme': 'dark', 'statusLine': mine})
        self.installer('install', plugin=self.plugin_copy('0.1.0'))
        self.installer('install', plugin=self.plugin_copy('0.1.0'))
        self.installer('install', plugin=self.plugin_copy('0.2.0'))
        wrapped = json.loads((self.state / 'wrapped-statusline.json').read_text(encoding='utf-8'))
        self.assertEqual(wrapped['command'], mine['command'])
        self.assertNotIn('temper_statusline', wrapped['command'])
        result, elapsed = self.run_statusline_setting(STATUS_INPUT)
        self.assertEqual(result.stdout, 'MY-STATUS-LINE')
        self.assertLess(elapsed, 6)
        # With no statusline of their own, a second install still wraps nothing.
        shutil.rmtree(str(self.config))
        self.config.mkdir()
        self.write_settings({'theme': 'dark'})
        self.installer('install')
        out = self.installer('install')
        self.assertFalse(out['wrapped'])
        self.assertFalse((self.state / 'wrapped-statusline.json').exists())

    def test_STATE_14_uninstall_puts_back_the_users_statusline_or_removes_the_key(self):
        mine = self.user_statusline()
        original = {'theme': 'dark', 'statusLine': mine}
        self.write_settings(original)
        self.installer('install')
        self.installer('install')
        self.assertFalse(self.installer('uninstall')['installed'])
        self.assertEqual(self.read_settings(), original)
        # They had none: the key goes.
        shutil.rmtree(str(self.config))
        self.config.mkdir()
        self.write_settings({'theme': 'dark'})
        self.installer('install')
        self.installer('uninstall')
        self.assertEqual(self.read_settings(), {'theme': 'dark'})
        # They had no settings file at all.
        shutil.rmtree(str(self.config))
        self.config.mkdir()
        self.installer('install')
        self.installer('uninstall')
        if self.settings.exists():
            self.assertNotIn('statusLine', self.read_settings())

    def test_STATE_15_run_recopies_a_copy_from_another_plugin_version(self):
        # The run skill: before every launch or resume, compare the copy's version and re-install.
        before = RUN_SKILL[RUN_SKILL.index('## Before every launch or resume'):RUN_SKILL.index('## Launching')]
        self.assertIn('install_statusline.py" status', before)
        self.assertIn('copied_version', before)
        self.assertIn('install_statusline.py" install', before)
        old, new = self.plugin_copy('0.1.0'), self.plugin_copy('0.2.0')
        self.write_settings({'statusLine': self.user_statusline()})
        self.installer('install', plugin=old)
        # The plugin updates to 0.2.0; /temper:run starts and follows the skill.
        status = self.installer('status', plugin=new)
        self.assertTrue(status['installed'])
        self.assertEqual(status['copied_version'], '0.1.0')
        self.assertNotEqual(status['copied_version'], '0.2.0')
        self.installer('install', plugin=new)
        copy = self.state / 'bin' / 'temper_statusline.py'
        self.assertEqual(copy.read_bytes(), (new / 'statusline' / 'temper_statusline.py').read_bytes())
        self.assertEqual(self.installer('status', plugin=new)['copied_version'], '0.2.0')
        self.assertIn(str(copy), self.read_settings()['statusLine']['command'])
        result, _ = self.run_statusline_setting(STATUS_INPUT)
        self.assertEqual(result.stdout, 'MY-STATUS-LINE')

    def test_STATE_16_limits_older_than_about_ten_minutes_are_not_fresh(self):
        preflight = RUN_SKILL[RUN_SKILL.index('### Pre-flight'):RUN_SKILL.index('### Wakeups')]
        self.assertIn('limits_age_s', preflight)
        self.assertRegex(preflight, r'under about 600')
        self.write_settings({})
        self.installer('install')
        for age, fresh in ((60, True), (11 * 60, False), (3600, False)):
            with self.subTest(age=age):
                (self.state / 'limits.json').write_text(json.dumps({
                    'version': 1, 'seen_at': int(time.time()) - age,
                    'five_hour': RATE_LIMITS['five_hour'], 'seven_day': RATE_LIMITS['seven_day'],
                }), encoding='utf-8')
                status = self.installer('status')
                self.assertTrue(status['installed'])
                self.assertIsInstance(status['limits_age_s'], int)
                self.assertEqual(status['limits_age_s'] < 600, fresh, status)
        # A statusline that just ran makes it fresh again.
        self.run_statusline_setting(STATUS_INPUT)
        self.assertLess(self.installer('status')['limits_age_s'], 600)


if __name__ == '__main__':
    unittest.main()
