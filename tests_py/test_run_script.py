import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'scripts' / 'run_script.py'
sys.path.insert(0, str(ROOT / 'scripts'))

import run_script  # noqa: E402


class RunScriptCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='temper-run-script-'))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.args = self.tmp / 'args.json'
        self.out = self.tmp / 'nested' / 'out.js'

    def run_cli(self, *argv):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *argv],
            check=False, capture_output=True, text=True,
        )

    def write_args(self, text):
        self.args.write_text(text, encoding='utf-8')

    def generate(self, stage='build', args_text='{"epic": "e"}'):
        self.write_args(args_text)
        return self.run_cli(stage, str(self.args), str(self.out))

    def test_meta_stays_first_and_the_body_is_wrapped_with_args_inlined(self):
        proc = self.generate()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        text = self.out.read_text(encoding='utf-8')
        bundle = (ROOT / 'workflows' / 'build.js').read_text(encoding='utf-8')
        meta, _, body = bundle.partition(run_script.NOTICE + '\n')
        self.assertTrue(text.startswith(meta))
        self.assertIn('return await (async (args) => {\n' + body, text)
        self.assertTrue(text.rstrip().endswith(
            '})(JSON.parse(' + json.dumps('{"epic":"e"}') + '));'))

    def test_every_stage_keeps_its_meta(self):
        for stage in ('build', 'stabilise', 'publish'):
            proc = self.generate(stage)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn(f"name: '{stage}'", self.out.read_text(encoding='utf-8').split('\n\n')[0])

    def test_the_inlined_args_survive_quotes_newlines_and_unicode(self):
        value = {'text': 'a "b" \\ \n `c` ${d}   zółw </script>'}
        proc = self.generate(args_text=json.dumps(value))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        last = self.out.read_text(encoding='utf-8').rstrip().rsplit('\n', 1)[-1]
        literal = last[len('})(JSON.parse('):-len('));')]
        self.assertEqual(json.loads(json.loads(literal)), value)

    def test_refusals_write_nothing(self):
        for stage, text, needle in (
            ('nope', '{}', 'stage'),
            ('build', '{not json', 'args'),
            ('build', '[1]', 'object'),
            ('build', '{"a": NaN}', 'args'),
        ):
            proc = self.generate(stage, text)
            self.assertEqual(proc.returncode, 1, (stage, text))
            self.assertIn(needle, proc.stderr)
            self.assertFalse(self.out.exists())

    def test_missing_args_file_and_bad_usage(self):
        self.assertEqual(self.run_cli('build', str(self.tmp / 'none.json'), str(self.out)).returncode, 1)
        self.assertEqual(self.run_cli('build').returncode, 1)
        self.assertFalse(self.out.exists())

    def test_a_bundle_without_the_notice_is_refused(self):
        with self.assertRaises(ValueError):
            run_script.split_bundle('export const meta = {};\nno notice here\n')
        with self.assertRaises(ValueError):
            run_script.split_bundle(run_script.NOTICE + '\nno meta first\n')


class BlocksReportCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='temper-blocks-'))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def epic(self, name, log):
        d = self.tmp / name
        d.mkdir()
        (d / 'log.md').write_text(log, encoding='utf-8')

    def report(self, *extra):
        return subprocess.run(
            [sys.executable, str(ROOT / 'scripts' / 'blocks_report.py'), str(self.tmp), *extra],
            check=False, capture_output=True, text=True,
        )

    def test_counts_per_epic_week_and_cause_plus_relaunches(self):
        self.epic('one', '\n'.join([
            '# log',
            '2026-11-02 blocked[base-red] baseline',
            '- 2026-11-03 blocked[base-red] baseline',
            '2026-11-09 blocked[merge-conflict] merge:wave2',
            '2026-11-09 relaunch build attempt 1',
            '2026-11-09 relaunch build attempt 2',
            'a line that says blocked[fake] in prose',
            '',
        ]))
        self.epic('two', 'blocked[owns] t1\n')
        (self.tmp / 'no-log').mkdir()
        (self.tmp / 'epics.md').write_text('blocked[x] y\n', encoding='utf-8')
        proc = self.report()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.splitlines(), [
            'epic\tweek\tcause\tcount',
            'one\t2026-W45\tbase-red\t2',
            'one\t2026-W46\tmerge-conflict\t1',
            'two\tundated\towns\t1',
            '',
            'epic\tweek\trelaunches',
            'one\t2026-W46\t2',
        ])

    def test_an_impossible_date_counts_as_undated(self):
        self.epic('one', '2026-13-45 blocked[owns] t1\n')
        self.assertIn('one\tundated\towns\t1', self.report().stdout)

    def test_missing_specs_dir_exits_1(self):
        proc = subprocess.run(
            [sys.executable, str(ROOT / 'scripts' / 'blocks_report.py'), str(self.tmp / 'none')],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 1)
        self.assertIn('none', proc.stderr)


if __name__ == '__main__':
    unittest.main()
