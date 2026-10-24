import importlib.util
import json
import os
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


if __name__ == '__main__':
    unittest.main()
