"""Acceptance tests for the skills-packaging group (docs/v1-behaviour.md), the ids that drive the
Python scripts: SKILLS-PACKAGING-16 (done_tasks.py) and SKILLS-PACKAGING-28 (cleanup_check.py).
The other ids are in test/acceptance/skills-packaging.test.mjs.

The head follows skills/run/SKILL.md and skills/cleanup/SKILL.md; these tests do the same steps
with the real scripts through their CLIs, in throwaway git repos with a bare ``origin``. HOME,
CLAUDE_CONFIG_DIR and the git global config are temporary, so the user's own config is never read
or written. The only remote anything touches is the temporary bare repo.

A test that fails because of the product is skipped with "acceptance-failing: <id>".
"""

import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DONE = ROOT / 'scripts' / 'done_tasks.py'
CLEANUP = ROOT / 'scripts' / 'cleanup_check.py'
RUN_SKILL = (ROOT / 'skills' / 'run' / 'SKILL.md').read_text(encoding='utf-8')
CLEANUP_SKILL = (ROOT / 'skills' / 'cleanup' / 'SKILL.md').read_text(encoding='utf-8')


def flat(text):
    return ' '.join(text.split())


def epic_dir_command(skill, epic_dir):
    """The command the cleanup skill runs over ssh to remove the per-epic build directory, with
    <root>/<epic> filled in, as an argv run locally (no shell)."""
    # The command ends at <root>/<epic>: the `rmdir <root>/<epic>/tmp` before it is not this one.
    m = re.search(r"ssh <host> '([^']*<root>/<epic>)'", skill)
    if not m:
        raise AssertionError('the cleanup skill names no ssh command for <root>/<epic>')
    return shlex.split(m.group(1).replace('<root>/<epic>', str(epic_dir)))


class Sandbox(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name).resolve()
        home = self.tmp / 'home'
        home.mkdir()
        (home / '.gitconfig').write_text('', encoding='utf-8')
        (self.tmp / 'claude').mkdir()
        self.env = {
            'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
            'HOME': str(home),
            'CLAUDE_CONFIG_DIR': str(self.tmp / 'claude'),
            'GIT_CONFIG_NOSYSTEM': '1',
            'GIT_CONFIG_GLOBAL': str(home / '.gitconfig'),
            'GIT_TERMINAL_PROMPT': '0',
            'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@example.invalid',
            'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@example.invalid',
            'LC_ALL': 'C',
        }
        self.n = 0

    def tearDown(self):
        self._tmp.cleanup()

    def git(self, cwd, *args, check=True):
        proc = subprocess.run(['git', '-C', str(cwd), *args], env=self.env,
                              capture_output=True, text=True, check=False)
        if check and proc.returncode != 0:
            raise AssertionError(f'git {args} failed: {proc.stderr}')
        return proc.stdout.strip() if check else proc

    def commit(self, repo, message):
        self.n += 1
        name = f'f{self.n}.txt'
        (Path(repo) / name).write_text(f'{self.n}\n', encoding='utf-8')
        self.git(repo, 'add', name)
        self.git(repo, 'commit', '-q', '--no-gpg-sign', '-m', message)
        return self.git(repo, 'rev-parse', 'HEAD')

    def remote(self):
        origin = self.tmp / 'origin.git'
        seed = self.tmp / 'seed'
        self.git(self.tmp, 'init', '-q', '--bare', '-b', 'main', str(origin))
        self.git(self.tmp, 'init', '-q', '-b', 'main', str(seed))
        self.commit(seed, 'init')
        self.git(seed, 'remote', 'add', 'origin', str(origin))
        self.git(seed, 'push', '-q', 'origin', 'main')
        repo = self.tmp / 'repo'
        self.git(self.tmp, 'clone', '-q', str(origin), str(repo))
        return repo, origin

    def script(self, path, *args):
        return subprocess.run([sys.executable, str(path), *map(str, args)], cwd=str(self.tmp),
                              env=self.env, capture_output=True, text=True, check=False,
                              timeout=60)


class TestSkillsPackaging(Sandbox):

    def test_SKILLS_PACKAGING_16_the_head_reads_the_trailers_and_passes_them_as_args_done(self):
        # The run skill: before every launch or resume, done_tasks.py, and args.done is exactly its output.
        before = RUN_SKILL[RUN_SKILL.index('## Before every launch or resume'):
                           RUN_SKILL.index('## Launching and resuming')]
        self.assertIn('done_tasks.py" <repo> <branch> <base> <epic>', before)
        self.assertIn('Set `args.done` to exactly that array and save `args.json`', flat(before))
        self.assertIn('On exit 1, stop: never launch with a guessed or empty `done`', flat(before))
        self.assertIn('always refresh it first', flat(RUN_SKILL))
        self.assertLess(RUN_SKILL.index('## Before every launch or resume'),
                        RUN_SKILL.index('## Stage 3'))

        # An epic branch with finished tasks and phases, another epic's work and a trailer on base.
        repo, _origin = self.remote()
        self.commit(repo, 'chore: on base\n\nTemper-Task: e/base-only')
        self.git(repo, 'checkout', '-q', '-b', 'temper/e')
        self.commit(repo, 'feat: greet\n\nTemper-Task: e/greet')
        self.commit(repo, 'feat: cli\n\nTemper-Task: e/cli')
        self.commit(repo, 'test: checkpoint\n\nTemper-Task: e/checkpoint')
        self.commit(repo, 'feat: other epic\n\nTemper-Task: f/greet')
        self.commit(repo, 'wip: no trailer')
        self.git(repo, 'checkout', '-q', 'main')

        args_path = self.tmp / 'args.json'
        args = {'epic': 'e', 'repo': str(repo), 'branch': 'temper/e', 'base': 'main',
                'done': ['stale-guess'], 'answers': {}}
        args_path.write_text(json.dumps(args), encoding='utf-8')

        # The head's step, as the skill writes it.
        a = json.loads(args_path.read_text(encoding='utf-8'))
        proc = self.script(DONE, a['repo'], a['branch'], a['base'], a['epic'])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        a['done'] = json.loads(proc.stdout)
        args_path.write_text(json.dumps(a), encoding='utf-8')

        saved = json.loads(args_path.read_text(encoding='utf-8'))
        self.assertEqual(sorted(saved['done']), ['checkpoint', 'cli', 'greet'])

        # A resume after more work refreshes it again.
        self.git(repo, 'checkout', '-q', 'temper/e')
        self.commit(repo, 'test: acceptance\n\nTemper-Task: e/acceptance:g1')
        self.git(repo, 'checkout', '-q', 'main')
        proc = self.script(DONE, repo, 'temper/e', 'main', 'e')
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(sorted(json.loads(proc.stdout)),
                         ['acceptance:g1', 'checkpoint', 'cli', 'greet'])

        # A branch git can't read is exit 1, never an empty list to launch with.
        proc = self.script(DONE, repo, 'temper/no-such', 'main', 'e')
        self.assertEqual(proc.returncode, 1)
        self.assertEqual(proc.stdout.strip(), '')

    def test_SKILLS_PACKAGING_16_a_new_epic_gets_its_branch_from_base_before_the_first_launch(self):
        # Straight from the plan skill: args.json names epic/e, done is [], and epic/e doesn't
        # exist yet. The run skill's steps before a launch must get done_tasks.py to exit 0.
        before = RUN_SKILL[RUN_SKILL.index('## Before every launch or resume'):
                           RUN_SKILL.index('## Launching and resuming')]
        blocks = [b.strip() for b in before.split('```')[1::2]]
        check = next((b for b in blocks if 'rev-parse' in b), None)
        create = next((b for b in blocks if b.startswith('git -C <repo> branch ')), None)
        self.assertIsNotNone(check, 'the run skill never checks that the epic branch exists')
        self.assertIsNotNone(create, 'the run skill never creates the epic branch from base')
        self.assertLess(before.index(create), before.index('done_tasks.py'))
        # Only a first launch creates it; a missing branch later is a typo or lost work.
        self.assertIn('`planned`', before[:before.index('done_tasks.py')])

        repo, _origin = self.remote()
        a = {'epic': 'e', 'repo': str(repo), 'branch': 'epic/e', 'base': 'main',
             'done': [], 'answers': {}}

        def run(block):
            cmd = (block.replace('<repo>', a['repo']).replace('<branch>', a['branch'])
                   .replace('<base>', a['base']))
            return subprocess.run(cmd.split(), env=self.env, capture_output=True, text=True,
                                  check=False)

        self.assertNotEqual(run(check).returncode, 0)  # missing, so the first launch creates it
        self.assertEqual(run(create).returncode, 0)
        self.assertEqual(run(check).returncode, 0)
        self.assertEqual(self.git(repo, 'rev-parse', 'epic/e'), self.git(repo, 'rev-parse', 'main'))

        proc = self.script(DONE, a['repo'], a['branch'], a['base'], a['epic'])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout), [])

    def test_SKILLS_PACKAGING_28_cleanup_removes_only_what_the_check_passes(self):
        skill = flat(CLEANUP_SKILL)
        self.assertIn('cleanup_check.py" <repo> <branch> --worktree <path>', CLEANUP_SKILL)
        self.assertIn('You only act on its exit status', skill)
        self.assertIn('**exit 1:** not safe. Nothing is deleted for that branch or its worktree. '
                      'Show the user the `reasons` as they are', skill)
        self.assertIn('git worktree remove <path>', skill)
        self.assertIn('git branch -d <branch>', skill)
        self.assertIn('When every worktree under the host\'s `<root>/<epic>/` has passed and been '
                      'removed, delete that per-epic build directory', skill)
        self.assertIn('If any worktree under it failed its check, nothing is deleted there', skill)
        self.assertIn('Tell the user, per branch: deleted (with the worktree and directory removed), '
                      'or kept with the check\'s reasons', skill)

        repo, origin = self.remote()
        build = self.tmp / 'build' / 'e'          # the per-epic build directory
        build.mkdir(parents=True)

        def branch_with_work(name):
            self.git(repo, 'checkout', '-q', '-b', name, 'main')
            self.commit(repo, f'feat: {name}')
            self.git(repo, 'checkout', '-q', 'main')

        # merged: the epic branch, merged into the remote's default branch. It's named `epic/e`
        # here, not the plan skill's default `temper/e`: git can't hold a branch `temper/e` next to
        # the task branches `temper/e/<id>` (taskBranch in src/lib.js), so the two defaults clash.
        branch_with_work('epic/e')
        self.git(repo, 'merge', '-q', '--ff-only', 'epic/e')
        self.git(repo, 'push', '-q', 'origin', 'main')
        # pushed: a task branch whose tip matches its remote ref.
        branch_with_work('temper/e/a')
        self.git(repo, 'push', '-q', '-u', 'origin', 'temper/e/a')
        # unpushed: a task branch only on this machine.
        branch_with_work('temper/e/b')
        # dirty: pushed, but its worktree has an untracked file.
        branch_with_work('temper/e/c')
        self.git(repo, 'push', '-q', '-u', 'origin', 'temper/e/c')

        worktrees = {}
        for b in ('epic/e', 'temper/e/a', 'temper/e/b', 'temper/e/c'):
            path = build / b.replace('/', '-')
            self.git(repo, 'worktree', 'add', '-q', str(path), b)
            worktrees[b] = path
        (worktrees['temper/e/c'] / 'notes.txt').write_text('not committed\n', encoding='utf-8')

        # The skill's procedure: one check per branch, delete only on exit 0, report each.
        report = {}
        for b, wt in worktrees.items():
            proc = self.script(CLEANUP, repo, b, '--worktree', wt)
            try:
                out = json.loads(proc.stdout)
            except ValueError:
                out = None
            if proc.returncode == 0 and isinstance(out, dict) and out.get('ok') is True:
                self.git(repo, 'worktree', 'remove', str(wt))
                self.git(repo, 'branch', '-d', b)
                report[b] = ('deleted', [])
            else:
                report[b] = ('kept', (out or {}).get('reasons', []))
        if all(state == 'deleted' for state, _ in report.values()):
            subprocess.run(epic_dir_command(CLEANUP_SKILL, build), check=True)

        self.assertEqual(report['epic/e'][0], 'deleted')
        self.assertEqual(report['temper/e/a'][0], 'deleted')
        self.assertEqual(report['temper/e/b'][0], 'kept')
        self.assertEqual(report['temper/e/c'][0], 'kept')
        for b in ('temper/e/b', 'temper/e/c'):
            reasons = report[b][1]
            self.assertTrue(reasons and all(isinstance(r, str) and r.strip() for r in reasons),
                            f'{b} is kept with a reason: {reasons}')

        branches = self.git(repo, 'branch', '--list', '--format=%(refname:short)').split('\n')
        self.assertNotIn('epic/e', branches)
        self.assertNotIn('temper/e/a', branches)
        self.assertIn('temper/e/b', branches)
        self.assertIn('temper/e/c', branches)
        self.assertFalse(worktrees['epic/e'].exists())
        self.assertFalse(worktrees['temper/e/a'].exists())
        self.assertTrue(worktrees['temper/e/b'].exists())
        self.assertTrue((worktrees['temper/e/c'] / 'notes.txt').exists())
        # A worktree under the build directory failed, so the directory stays.
        self.assertTrue(build.exists())
        # Nothing on the remote was deleted.
        remote = self.git(origin, 'branch', '--list', '--format=%(refname:short)').split('\n')
        self.assertIn('temper/e/a', remote)
        self.assertIn('temper/e/c', remote)


    def test_A8_cleanup_removes_the_epic_directory_only_with_rmdir(self):
        # Amendment A8: cleanup never runs `rm -r` on <root>/<epic>/. Once every worktree in it
        # passed the check and was removed, it runs `rmdir`, which fails unless the directory is
        # empty, so anything left in it (not a passed worktree) survives.
        self.assertNotIn("'rm -r", CLEANUP_SKILL)
        argv = epic_dir_command(CLEANUP_SKILL, self.tmp / 'x')
        self.assertEqual(argv[0], 'rmdir', argv)

        left = self.tmp / 'build-left' / 'e'
        (left / 'target').mkdir(parents=True)
        (left / 'target' / 'out.bin').write_text('left behind\n', encoding='utf-8')
        proc = subprocess.run(epic_dir_command(CLEANUP_SKILL, left), capture_output=True,
                              text=True, check=False)
        self.assertNotEqual(proc.returncode, 0, 'a non-empty epic directory is refused')
        self.assertTrue((left / 'target' / 'out.bin').exists())

        empty = self.tmp / 'build-empty' / 'e'
        empty.mkdir(parents=True)
        proc = subprocess.run(epic_dir_command(CLEANUP_SKILL, empty), capture_output=True,
                              text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(empty.exists())

if __name__ == '__main__':
    unittest.main()
