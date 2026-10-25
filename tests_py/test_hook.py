import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / 'hooks' / 'prompt_submit.py'
sys.path.insert(0, str(ROOT / 'scripts'))

from temper_paths import DEFAULT_PREFERENCES  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prompt_submit = _load('prompt_submit', HOOK)
session_mode = _load('session_mode', ROOT / 'scripts' / 'session_mode.py')

prefs_on = dict(DEFAULT_PREFERENCES, keyword_trigger='on')
prefs_off = dict(DEFAULT_PREFERENCES, keyword_trigger='off')


class DecideTest(unittest.TestCase):
    def test_cwd_is_not_searched(self):
        # A3: only the prompt field is matched, never the rest of the input.
        self.assertIsNone(prompt_submit.decide({'prompt': 'fix this', 'cwd': '/x/temper-spikes'}, prefs_on))

    def test_keyword_with_trigger_on(self):
        text = prompt_submit.decide({'prompt': 'temper: plan the auth epic', 'permission_mode': 'auto'}, prefs_on)
        self.assertIsNotNone(text)
        self.assertIn('temper keyword', text)

    def test_keyword_with_trigger_off(self):
        self.assertIsNone(
            prompt_submit.decide({'prompt': 'temper: plan the auth epic', 'permission_mode': 'auto'}, prefs_off))

    def test_slash_command_outside_auto_mode_warns(self):
        text = prompt_submit.decide({'prompt': '/temper:build', 'permission_mode': 'default'}, prefs_off)
        self.assertIsNotNone(text)
        self.assertIn("permission mode is 'default'", text)
        self.assertNotIn('keyword', text)

    def test_slash_command_in_auto_mode_is_silent(self):
        self.assertIsNone(prompt_submit.decide({'prompt': '/temper:build', 'permission_mode': 'auto'}, prefs_off))


class MainTest(unittest.TestCase):
    def test_invalid_json_exits_zero_and_prints_nothing(self):
        with tempfile.TemporaryDirectory() as config:
            env = dict(os.environ, CLAUDE_CONFIG_DIR=config, CLAUDE_PLUGIN_ROOT=str(ROOT))
            result = subprocess.run([sys.executable, str(HOOK)], input='not json {', capture_output=True,
                                    text=True, env=env, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')


class HooksJsonTest(unittest.TestCase):
    def test_hooks_json_parses_and_names_the_hook(self):
        config = json.loads((ROOT / 'hooks' / 'hooks.json').read_text(encoding='utf-8'))
        command = config['hooks']['UserPromptSubmit'][0]['hooks'][0]['command']
        self.assertIn('${CLAUDE_PLUGIN_ROOT}/hooks/prompt_submit.py', command)


class SessionModeTest(unittest.TestCase):
    """SECOND-TESTS-DOCS-5: the hook records each session's mode; the pre-flight reads it."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.env = {'CLAUDE_CONFIG_DIR': self._tmp.name}
        self.path = Path(self._tmp.name) / 'temper' / 'session-mode.json'

    def test_record_then_check(self):
        session_mode.record({'session_id': 's1', 'permission_mode': 'auto'}, self.env, now=1000)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertEqual(session_mode.check('s1', self.env, now=1010),
                         {'auto': True, 'mode': 'auto', 'age_s': 10, 'reason': 'auto mode'})

    def test_missing_other_session_stale_and_non_auto_are_not_auto(self):
        self.assertFalse(session_mode.check('s1', self.env, now=1000)['auto'])
        session_mode.record({'session_id': 's2', 'permission_mode': 'auto'}, self.env, now=1000)
        self.assertFalse(session_mode.check('s1', self.env, now=1000)['auto'])
        session_mode.record({'session_id': 's1', 'permission_mode': 'auto'}, self.env, now=1000)
        stale = session_mode.check('s1', self.env, now=1000 + session_mode.MAX_AGE_S + 1)
        self.assertFalse(stale['auto'])
        self.assertIn('stale', stale['reason'])
        for mode in ('default', 'acceptEdits', 'plan', 'bypassPermissions', None, 7):
            session_mode.record({'session_id': 's1', 'permission_mode': mode}, self.env, now=1000)
            self.assertFalse(session_mode.check('s1', self.env, now=1001)['auto'], mode)
        self.assertFalse(session_mode.check('', self.env, now=1001)['auto'])

    def test_latest_record_wins_and_other_sessions_are_kept(self):
        session_mode.record({'session_id': 's1', 'permission_mode': 'auto'}, self.env, now=1000)
        session_mode.record({'session_id': 's2', 'permission_mode': 'default'}, self.env, now=1001)
        session_mode.record({'session_id': 's1', 'permission_mode': 'default'}, self.env, now=1002)
        self.assertEqual(session_mode.check('s1', self.env, now=1003)['mode'], 'default')
        self.assertEqual(session_mode.check('s2', self.env, now=1003)['mode'], 'default')
        data = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertEqual(sorted(e['session_id'] for e in data['sessions']), ['s1', 's2'])

    def test_old_sessions_are_pruned_and_the_file_stays_small(self):
        for i in range(session_mode.MAX_SESSIONS + 10):
            session_mode.record({'session_id': 's%d' % i, 'permission_mode': 'auto'},
                                self.env, now=1000 + i)
        data = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertEqual(len(data['sessions']), session_mode.MAX_SESSIONS)
        self.assertTrue(session_mode.check('s%d' % (session_mode.MAX_SESSIONS + 9), self.env,
                                           now=1100)['auto'])
        session_mode.record({'session_id': 'new', 'permission_mode': 'auto'}, self.env,
                            now=1000 + session_mode.KEEP_S + 100)
        data = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertEqual([e['session_id'] for e in data['sessions']], ['new'])

    def test_a_bad_record_file_reads_as_not_auto_and_is_rewritten(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text('not json', encoding='utf-8')
        self.assertFalse(session_mode.check('s1', self.env, now=1000)['auto'])
        session_mode.record({'session_id': 's1', 'permission_mode': 'auto'}, self.env, now=1000)
        self.assertTrue(session_mode.check('s1', self.env, now=1000)['auto'])

    def test_hook_records_every_prompt_whatever_it_says(self):
        with tempfile.TemporaryDirectory() as config:
            env = dict(os.environ, CLAUDE_CONFIG_DIR=config, CLAUDE_PLUGIN_ROOT=str(ROOT))
            for prompt in ('start the overnight run', '/temper:run', 'hello'):
                data = {'session_id': 'sx', 'permission_mode': 'default', 'prompt': prompt}
                result = subprocess.run([sys.executable, str(HOOK)], input=json.dumps(data),
                                        capture_output=True, text=True, env=env, timeout=10)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stderr, '')
                out = session_mode.check('sx', {'CLAUDE_CONFIG_DIR': config})
                self.assertEqual((out['auto'], out['mode']), (False, 'default'), prompt)
                (Path(config) / 'temper' / 'session-mode.json').unlink()

    def test_cli_exit_status(self):
        script = str(ROOT / 'scripts' / 'session_mode.py')
        env = dict(os.environ, CLAUDE_CONFIG_DIR=self._tmp.name)
        session_mode.record({'session_id': 's1', 'permission_mode': 'auto'}, self.env)
        ok = subprocess.run([sys.executable, script, 's1'], capture_output=True, text=True,
                            env=env, timeout=10)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertTrue(json.loads(ok.stdout)['auto'])
        no = subprocess.run([sys.executable, script, 's2'], capture_output=True, text=True,
                            env=env, timeout=10)
        self.assertEqual(no.returncode, 1)
        self.assertFalse(json.loads(no.stdout)['auto'])
        usage = subprocess.run([sys.executable, script], capture_output=True, text=True,
                               env=env, timeout=10)
        self.assertEqual(usage.returncode, 1)
        self.assertFalse(json.loads(usage.stdout)['auto'])

if __name__ == '__main__':
    unittest.main()
