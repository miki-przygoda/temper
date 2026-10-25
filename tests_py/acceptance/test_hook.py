"""Acceptance tests for the hook group (docs/v1-behaviour.md, HOOK-01..09).

The hook is driven the way Claude Code drives it: the ``UserPromptSubmit`` command from
``hooks/hooks.json`` is run through ``sh -c`` with ``CLAUDE_PLUGIN_ROOT`` pointing at a copy of
the plugin in a cache-like path, the hook input JSON on stdin, and the output read from stdout and
the exit status. Every run has its own temporary ``CLAUDE_CONFIG_DIR`` and ``HOME``, so the user's
own config is never read or written. Preferences are written from the shipped template, the way
``/temper:setup`` writes them.

A test that fails because of the product is skipped with "acceptance-failing: <id>".
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
HOOKS_JSON = ROOT / 'hooks' / 'hooks.json'
TEMPLATE = (ROOT / 'templates' / 'preferences.md').read_text(encoding='utf-8')


def hook_command():
    """The one UserPromptSubmit command hooks.json declares."""
    config = json.loads(HOOKS_JSON.read_text(encoding='utf-8'))
    groups = config['hooks']['UserPromptSubmit']
    commands = [h['command'] for g in groups for h in g['hooks'] if h.get('type') == 'command']
    assert len(commands) == 1, commands
    return commands[0]


def hook_input(prompt, mode='default', **extra):
    """A UserPromptSubmit input with the keys spike S2 observed."""
    data = {
        'session_id': 'sess-1',
        'transcript_path': '/home/u/.claude/projects/p/sess-1.jsonl',
        'cwd': '/home/u/work/app',
        'permission_mode': mode,
        'hook_event_name': 'UserPromptSubmit',
        'prompt': prompt,
        'prompt_id': 'p-1',
    }
    data.update(extra)
    return data


class HookSandbox(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(os.path.realpath(self._tmp.name))
        self.home = self.tmp / 'home'
        self.home.mkdir()
        self.config = self.tmp / 'config'
        self.config.mkdir()
        self.work = self.tmp / 'work'
        self.work.mkdir()
        # Claude Code runs the plugin from its cache; a space in the path checks the quoting.
        self.plugin = self.tmp / 'plugin cache' / 'temper' / 'temper' / '0.1.0'
        shutil.copytree(str(ROOT), str(self.plugin), ignore=shutil.ignore_patterns(
            '.git', 'node_modules', '__pycache__', 'test', 'tests_py'))

    def tearDown(self):
        for path in self.tmp.rglob('*'):
            try:
                os.chmod(str(path), 0o700)
            except OSError:
                pass
        self._tmp.cleanup()

    def env(self, config=True):
        env = {k: v for k, v in os.environ.items()
               if k not in ('CLAUDE_CONFIG_DIR', 'CLAUDE_PLUGIN_ROOT')}
        env['HOME'] = str(self.home)
        if config is True:
            env['CLAUDE_CONFIG_DIR'] = str(self.config)
        elif config:
            env['CLAUDE_CONFIG_DIR'] = str(config)
        env['CLAUDE_PLUGIN_ROOT'] = str(self.plugin)
        return env

    def write_prefs(self, base, keyword):
        state = Path(base) / 'temper'
        state.mkdir(parents=True, exist_ok=True)
        text = TEMPLATE.replace('keyword_trigger: off', 'keyword_trigger: %s' % keyword)
        self.assertIn('keyword_trigger: %s' % keyword, text)
        (state / 'preferences.md').write_text(text, encoding='utf-8')
        return state / 'preferences.md'

    def run_hook(self, stdin, env=None):
        """Run hooks.json's command as Claude Code does: sh -c, in the project directory."""
        if not isinstance(stdin, (str, bytes)):
            stdin = json.dumps(stdin)
        if isinstance(stdin, str):
            stdin = stdin.encode('utf-8')
        result = subprocess.run(['sh', '-c', hook_command()], input=stdin, capture_output=True,
                                timeout=20, cwd=str(self.work), env=env or self.env())
        return result.returncode, result.stdout.decode('utf-8'), result.stderr.decode('utf-8')

    def context(self, stdout):
        """The additionalContext of the hook's output, or None when it printed nothing."""
        if stdout.strip() == '':
            return None
        out = json.loads(stdout)
        self.assertEqual(set(out), {'hookSpecificOutput'}, out)
        spec = out['hookSpecificOutput']
        self.assertEqual(spec.get('hookEventName'), 'UserPromptSubmit')
        self.assertIsInstance(spec.get('additionalContext'), str)
        return spec['additionalContext']

    def assert_not_blocking(self, code, stdout):
        # Exit 2 blocks the prompt; any other non-zero shows an error. A JSON decision of
        # "block" or continue:false would also stop it.
        self.assertEqual(code, 0)
        if stdout.strip():
            out = json.loads(stdout)
            self.assertNotEqual(out.get('decision'), 'block', out)
            self.assertNotEqual(out.get('continue'), False, out)


def is_keyword_context(text):
    return text is not None and 'temper' in text.lower() and 'keyword' in text.lower()


def is_mode_warning(text):
    return text is not None and 'auto mode' in text.lower()


class HookAcceptance(HookSandbox):
    def test_HOOK_01_hooks_json_runs_the_script_through_plugin_root(self):
        config = json.loads(HOOKS_JSON.read_text(encoding='utf-8'))
        self.assertIn('UserPromptSubmit', config['hooks'])
        command = hook_command()
        self.assertIn('${CLAUDE_PLUGIN_ROOT}', command)
        script = command.split('${CLAUDE_PLUGIN_ROOT}/', 1)[1].split('"')[0].split()[0]
        self.assertTrue((ROOT / script).is_file(), script)
        # No manifest override points hooks elsewhere, so Claude Code loads hooks/hooks.json.
        manifest = json.loads((ROOT / '.claude-plugin' / 'plugin.json').read_text(encoding='utf-8'))
        self.assertIn(manifest.get('hooks', './hooks/hooks.json'),
                      ('./hooks/hooks.json', 'hooks/hooks.json'))
        # Run from the cached copy, from a project directory: the script is found and runs.
        code, stdout, stderr = self.run_hook(hook_input('/temper:build', mode='default'))
        self.assertEqual(code, 0, stderr)
        self.assertEqual(stderr, '')
        self.assertTrue(is_mode_warning(self.context(stdout)), stdout)
        # Without CLAUDE_PLUGIN_ROOT the command doesn't reach the script: it really is found
        # through the variable, not through the working directory.
        env = self.env()
        del env['CLAUDE_PLUGIN_ROOT']
        code, stdout, _ = self.run_hook(hook_input('/temper:build', mode='default'), env=env)
        self.assertNotEqual(code, 0)

    def test_HOOK_02_keyword_trigger_off_adds_no_keyword_context(self):
        prompts = ['temper: plan the auth epic', 'please temper this branch', 'Temper it']
        # No preferences.md at all.
        for prompt in prompts:
            for mode in ('auto', 'default'):
                code, stdout, stderr = self.run_hook(hook_input(prompt, mode=mode))
                self.assertEqual(code, 0, stderr)
                self.assertFalse(is_keyword_context(self.context(stdout)), (prompt, mode, stdout))
        # preferences.md as setup writes it, with the default (off).
        self.write_prefs(self.config, 'off')
        for prompt in prompts:
            code, stdout, stderr = self.run_hook(hook_input(prompt, mode='auto'))
            self.assertEqual(code, 0, stderr)
            self.assertEqual(stdout, '', (prompt, stdout))

    def test_HOOK_03_keyword_trigger_on_adds_context_to_use_temper(self):
        self.write_prefs(self.config, 'on')
        for prompt in ['temper: plan the auth epic', 'please temper this branch', 'Temper it.']:
            code, stdout, stderr = self.run_hook(hook_input(prompt, mode='auto'))
            self.assertEqual(code, 0, stderr)
            self.assertNotEqual(stdout.strip(), '', prompt)
            out = json.loads(stdout)
            self.assertEqual(list(out), ['hookSpecificOutput'])
            self.assertEqual(out['hookSpecificOutput']['hookEventName'], 'UserPromptSubmit')
            text = out['hookSpecificOutput']['additionalContext']
            self.assertIsInstance(text, str)
            self.assertIn('temper', text.lower())
            self.assertTrue('plugin' in text.lower() or 'skill' in text.lower(), text)

    def test_HOOK_04_only_the_prompt_field_is_matched(self):
        self.write_prefs(self.config, 'on')
        data = hook_input('fix the failing test', mode='auto',
                          cwd='/home/u/temper-spikes/temper',
                          transcript_path='/home/u/.claude/projects/-temper/temper.jsonl',
                          session_id='temper-session', prompt_id='temper')
        code, stdout, stderr = self.run_hook(data)
        self.assertEqual(code, 0, stderr)
        self.assertEqual(stdout, '')
        # Not auto: still no keyword context from the other fields.
        data['permission_mode'] = 'default'
        code, stdout, stderr = self.run_hook(data)
        self.assertEqual(code, 0, stderr)
        self.assertFalse(is_keyword_context(self.context(stdout)), stdout)

    def test_HOOK_05_mode_warning_outside_auto_mode(self):
        for keyword in ('off', 'on'):
            self.write_prefs(self.config, keyword)
            for command in ('/temper:build', '/temper:run', '/temper:stabilise'):
                for mode in ('default', 'acceptEdits', 'plan'):
                    code, stdout, stderr = self.run_hook(hook_input(command + ' docs/args.json',
                                                                    mode=mode))
                    self.assertEqual(code, 0, stderr)
                    text = self.context(stdout)
                    self.assertIsNotNone(text, (keyword, command, mode))
                    self.assertIn(mode, text)
                    self.assertIn('auto mode', text.lower())
                    self.assertIn('overnight', text.lower())

    def test_HOOK_06_no_mode_warning_in_auto_mode(self):
        for keyword in ('off', 'on'):
            self.write_prefs(self.config, keyword)
            for command in ('/temper:build', '/temper:run', '/temper:stabilise'):
                code, stdout, stderr = self.run_hook(hook_input(command, mode='auto'))
                self.assertEqual(code, 0, stderr)
                self.assertFalse(is_mode_warning(self.context(stdout)), stdout)
        # Keyword on, a keyword prompt in auto mode: the keyword context, no mode warning.
        code, stdout, stderr = self.run_hook(hook_input('temper the epic', mode='auto'))
        self.assertEqual(code, 0, stderr)
        text = self.context(stdout)
        self.assertTrue(is_keyword_context(text), stdout)
        self.assertFalse(is_mode_warning(text), text)
        self.assertNotIn('permission mode', text.lower())

    def test_HOOK_07_nothing_to_add_prints_nothing_and_exits_zero(self):
        cases = [hook_input('fix the failing test', mode='default'),
                 hook_input('fix the failing test', mode='auto'),
                 hook_input('/temper:build', mode='auto'),
                 hook_input('temper the epic', mode='auto')]  # keyword off
        for case in cases:
            code, stdout, stderr = self.run_hook(case)
            self.assertEqual((code, stdout, stderr), (0, '', ''), case['prompt'])
        self.write_prefs(self.config, 'on')
        code, stdout, stderr = self.run_hook(hook_input('fix the failing test', mode='auto'))
        self.assertEqual((code, stdout, stderr), (0, '', ''))

    def test_HOOK_08_preferences_come_from_claude_config_dir(self):
        # On in $CLAUDE_CONFIG_DIR, off (and on) elsewhere: only the config dir's file counts.
        self.write_prefs(self.config, 'on')
        self.write_prefs(self.home / '.claude', 'off')
        code, stdout, stderr = self.run_hook(hook_input('temper the epic', mode='auto'))
        self.assertEqual(code, 0, stderr)
        self.assertTrue(is_keyword_context(self.context(stdout)), stdout)
        # Swap: off in the config dir, on in ~/.claude: no keyword context.
        self.write_prefs(self.config, 'off')
        self.write_prefs(self.home / '.claude', 'on')
        code, stdout, stderr = self.run_hook(hook_input('temper the epic', mode='auto'))
        self.assertEqual((code, stdout), (0, ''), stderr)
        # A second config dir with no preferences: the defaults, not ~/.claude's file.
        other = self.tmp / 'other-config'
        other.mkdir()
        code, stdout, stderr = self.run_hook(hook_input('temper the epic', mode='auto'),
                                             env=self.env(config=other))
        self.assertEqual((code, stdout), (0, ''), stderr)
        # Without CLAUDE_CONFIG_DIR, ~/.claude/temper/preferences.md is read.
        code, stdout, stderr = self.run_hook(hook_input('temper the epic', mode='auto'),
                                             env=self.env(config=False))
        self.assertEqual(code, 0, stderr)
        self.assertTrue(is_keyword_context(self.context(stdout)), stdout)

    def test_HOOK_09_bad_preferences_or_input_never_block(self):
        prompt = hook_input('/temper:build', mode='default')
        keyword = hook_input('temper the epic', mode='auto')
        state = self.config / 'temper'
        prefs = state / 'preferences.md'

        # Missing preferences.md (and missing state dir).
        for data in (prompt, keyword):
            self.assert_not_blocking(*self.run_hook(data)[:2])

        # Unreadable preferences.md.
        self.write_prefs(self.config, 'on')
        os.chmod(str(prefs), 0)
        if not os.access(str(prefs), os.R_OK):
            for data in (prompt, keyword):
                self.assert_not_blocking(*self.run_hook(data)[:2])
        os.chmod(str(prefs), 0o600)

        # Unreadable state directory.
        os.chmod(str(state), 0)
        if not os.access(str(state), os.R_OK | os.X_OK):
            for data in (prompt, keyword):
                self.assert_not_blocking(*self.run_hook(data)[:2])
        os.chmod(str(state), 0o700)

        # preferences.md that isn't UTF-8, has no front block, or is a directory.
        prefs.write_bytes(b'---\nkeyword_trigger: on\n\xff\xfe\x00bad\n---\n')
        for data in (prompt, keyword):
            self.assert_not_blocking(*self.run_hook(data)[:2])
        prefs.write_text('no front block here\nkeyword_trigger on\n', encoding='utf-8')
        for data in (prompt, keyword):
            self.assert_not_blocking(*self.run_hook(data)[:2])
        prefs.unlink()
        prefs.mkdir()
        for data in (prompt, keyword):
            self.assert_not_blocking(*self.run_hook(data)[:2])
        prefs.rmdir()

        # Hook input it can't parse.
        bad_inputs = ['', 'not json {', '{"prompt": "temper', '[]', '"temper"', 'null', '42',
                      json.dumps({'prompt': 42, 'permission_mode': 'default'}),
                      json.dumps({'prompt': None}),
                      json.dumps({'permission_mode': ['auto']}),
                      json.dumps({'prompt': ['/temper:build'], 'permission_mode': {}}),
                      b'\xff\xfe\x00\x01']
        self.write_prefs(self.config, 'on')
        for stdin in bad_inputs:
            code, stdout, stderr = self.run_hook(stdin)
            self.assert_not_blocking(code, stdout)


if __name__ == '__main__':
    unittest.main()
