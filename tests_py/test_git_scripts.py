import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS))

import cleanup_check  # noqa: E402
import done_tasks  # noqa: E402


class GitRepoCase(unittest.TestCase):
    """A bare `origin` and a clone of it with one commit on `main`."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='temper-git-'))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        # Keep the user's git config (signing, hooks, aliases) out of the tests.
        empty_config = self.tmp / 'gitconfig'
        empty_config.write_text('', encoding='utf-8')
        env_patch = mock.patch.dict(os.environ, {
            'GIT_CONFIG_GLOBAL': str(empty_config),
            'GIT_CONFIG_NOSYSTEM': '1',
            'GIT_TERMINAL_PROMPT': '0',
        })
        env_patch.start()
        self.addCleanup(env_patch.stop)

        self.origin = self.tmp / 'origin.git'
        self.repo = self.tmp / 'work'
        self.git(self.tmp, 'init', '--quiet', '--bare', '-b', 'main', str(self.origin))
        self.git(self.tmp, 'clone', '--quiet', str(self.origin), str(self.repo))
        self.git(self.repo, 'checkout', '--quiet', '-B', 'main')
        self.commit('initial')
        self.git(self.repo, 'push', '--quiet', '-u', 'origin', 'main')

    def git(self, cwd, *args):
        proc = subprocess.run(
            ['git', '-c', 'user.name=t', '-c', 'user.email=t@t',
             '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', *args],
            cwd=str(cwd), check=False, capture_output=True, text=True,
        )
        if proc.returncode != 0:
            raise AssertionError(f'git {args} failed: {proc.stderr}')
        return proc.stdout

    def commit(self, subject, *trailers):
        args = ['commit', '--quiet', '--allow-empty', '-m', subject]
        if trailers:
            args += ['-m', '\n'.join(trailers)]
        self.git(self.repo, *args)

    def make_feat(self, *trailer_sets):
        self.git(self.repo, 'checkout', '--quiet', '-b', 'feat')
        for i, trailers in enumerate(trailer_sets or [()]):
            self.commit(f'work {i}', *trailers)


class DoneTasksTest(GitRepoCase):
    def test_ids_from_this_epic_only_sorted_and_unique(self):
        self.make_feat(
            ('Temper-Task: e/2',),
            ('Temper-Task: other/9',),
            ('Temper-Task: e/1',),
            ('Temper-Task: e/2',),
        )
        self.assertEqual(done_tasks.done(str(self.repo), 'feat', 'main', 'e'), ['1', '2'])

    def test_commits_on_base_are_not_counted(self):
        self.git(self.repo, 'checkout', '--quiet', 'main')
        self.commit('on main', 'Temper-Task: e/0')
        self.make_feat(('Temper-Task: e/1',))
        self.assertEqual(done_tasks.done(str(self.repo), 'feat', 'main', 'e'), ['1'])

    def test_phase_ids_with_colons_are_kept(self):
        self.make_feat(('Temper-Task: e/acceptance:g1',), ('Temper-Task: e/checkpoint',))
        self.assertEqual(
            done_tasks.done(str(self.repo), 'feat', 'main', 'e'),
            ['acceptance:g1', 'checkpoint'],
        )

    def test_cli_prints_a_json_array_and_exits_0(self):
        self.make_feat(('Temper-Task: e/1',))
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / 'done_tasks.py'), str(self.repo), 'feat', 'main', 'e'],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout), ['1'])


class CleanupCheckTest(GitRepoCase):
    def test_merged_branch_is_ok(self):
        self.make_feat(('Temper-Task: e/1',))
        self.git(self.repo, 'checkout', '--quiet', 'main')
        self.git(self.repo, 'merge', '--quiet', '--no-ff', '-m', 'merge feat', 'feat')
        self.git(self.repo, 'push', '--quiet', 'origin', 'main')
        self.assertEqual(cleanup_check.check(str(self.repo), 'feat', fetch=True), (True, []))

    def test_unpushed_commit_is_refused(self):
        self.make_feat(('Temper-Task: e/1',))
        ok, reasons = cleanup_check.check(str(self.repo), 'feat', fetch=True)
        self.assertFalse(ok)
        self.assertTrue(any('not on' in r for r in reasons), reasons)

    def test_pushed_but_unmerged_branch_is_ok(self):
        self.make_feat(('Temper-Task: e/1',))
        self.git(self.repo, 'push', '--quiet', 'origin', 'feat')
        self.assertEqual(cleanup_check.check(str(self.repo), 'feat', fetch=True), (True, []))

    def test_pushed_then_new_local_commit_is_refused(self):
        self.make_feat(('Temper-Task: e/1',))
        self.git(self.repo, 'push', '--quiet', 'origin', 'feat')
        self.commit('more', 'Temper-Task: e/2')
        ok, reasons = cleanup_check.check(str(self.repo), 'feat', fetch=True)
        self.assertFalse(ok)
        self.assertTrue(any('not on' in r for r in reasons), reasons)

    def test_worktree_with_only_an_untracked_file_is_refused(self):
        # Review Focus 4: build output that isn't ignored must stop the delete.
        self.make_feat(('Temper-Task: e/1',))
        self.git(self.repo, 'checkout', '--quiet', 'main')
        self.git(self.repo, 'push', '--quiet', 'origin', 'feat')
        wt = self.tmp / 'wt'
        self.git(self.repo, 'worktree', 'add', '--quiet', str(wt), 'feat')
        (wt / 'build-output.bin').write_text('x', encoding='utf-8')
        ok, reasons = cleanup_check.check(str(self.repo), 'feat', worktree=str(wt), fetch=True)
        self.assertFalse(ok)
        self.assertEqual(len(reasons), 1, reasons)
        self.assertTrue(any('untracked' in r or 'uncommitted' in r for r in reasons), reasons)

    def test_clean_worktree_of_a_pushed_branch_is_ok(self):
        self.make_feat(('Temper-Task: e/1',))
        self.git(self.repo, 'checkout', '--quiet', 'main')
        self.git(self.repo, 'push', '--quiet', 'origin', 'feat')
        wt = self.tmp / 'wt'
        self.git(self.repo, 'worktree', 'add', '--quiet', str(wt), 'feat')
        self.assertEqual(
            cleanup_check.check(str(self.repo), 'feat', worktree=str(wt), fetch=True),
            (True, []),
        )

    def test_clean_detached_worktree_with_an_unpushed_commit_is_refused(self):
        # SAFETY-1: the branch is pushed, but its worktree's HEAD holds a commit on no branch
        # (a stopped rebase, an agent's `checkout --detach`). Removing it would lose that commit.
        self.make_feat(('Temper-Task: e/1',))
        self.git(self.repo, 'checkout', '--quiet', 'main')
        self.git(self.repo, 'push', '--quiet', 'origin', 'feat')
        wt = self.tmp / 'wt'
        self.git(self.repo, 'worktree', 'add', '--quiet', str(wt), 'feat')
        self.git(wt, 'checkout', '--quiet', '--detach')
        self.git(wt, 'commit', '--quiet', '--allow-empty', '-m', 'on no branch')
        ok, reasons = cleanup_check.check(str(self.repo), 'feat', worktree=str(wt), fetch=True)
        self.assertFalse(ok)
        self.assertTrue(any('HEAD' in r and 'not on' in r for r in reasons), reasons)

    def test_a_path_that_is_not_a_worktree_of_the_repo_is_refused(self):
        # SAFETY-1: a plain directory inside the repo; git status there reports the clean repo.
        self.make_feat(('Temper-Task: e/1',))
        self.git(self.repo, 'push', '--quiet', 'origin', 'feat')
        (self.repo / '.git' / 'info' / 'exclude').write_text('.temper/\n', encoding='utf-8')
        plain = self.repo / '.temper' / 'worktrees' / 'wt'
        plain.mkdir(parents=True)
        (plain / 'notes.txt').write_text('x', encoding='utf-8')
        ok, reasons = cleanup_check.check(str(self.repo), 'feat', worktree=str(plain), fetch=True)
        self.assertFalse(ok)
        self.assertTrue(any('not a worktree' in r for r in reasons), reasons)

    def test_failed_fetch_refuses(self):
        self.make_feat(('Temper-Task: e/1',))
        self.assertEqual(
            cleanup_check.check(str(self.repo), 'feat', remote='nope', fetch=True),
            (False, ['could not fetch nope; not deleting']),
        )

    def test_missing_branch_is_refused(self):
        ok, reasons = cleanup_check.check(str(self.repo), 'no-such-branch', fetch=False)
        self.assertFalse(ok)
        self.assertTrue(reasons)

    def test_cli_exit_status_and_json(self):
        self.make_feat(('Temper-Task: e/1',))
        script = str(SCRIPTS / 'cleanup_check.py')
        refused = subprocess.run(
            [sys.executable, script, str(self.repo), 'feat', '--no-fetch'],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(refused.returncode, 1, refused.stderr)
        out = json.loads(refused.stdout)
        self.assertFalse(out['ok'])
        self.assertTrue(out['reasons'])

        self.git(self.repo, 'push', '--quiet', 'origin', 'feat')
        accepted = subprocess.run(
            [sys.executable, script, str(self.repo), 'feat', '--remote', 'origin'],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertEqual(json.loads(accepted.stdout), {'ok': True, 'reasons': []})

    def ignored_worktree(self):
        """A clean worktree of a pushed branch that ignores target/ and .env, holding both."""
        self.git(self.repo, 'checkout', '--quiet', '-b', 'feat')
        (self.repo / '.gitignore').write_text('target/\n.env\n', encoding='utf-8')
        self.git(self.repo, 'add', '.gitignore')
        self.commit('ignore build output', 'Temper-Task: e/1')
        self.git(self.repo, 'checkout', '--quiet', 'main')
        self.git(self.repo, 'push', '--quiet', 'origin', 'feat')
        wt = self.tmp / 'wt'
        self.git(self.repo, 'worktree', 'add', '--quiet', str(wt), 'feat')
        (wt / 'target' / 'debug').mkdir(parents=True)
        (wt / 'target' / 'debug' / 'app').write_text('x', encoding='utf-8')
        (wt / '.env').write_text('SECRET=1\n', encoding='utf-8')
        return wt

    def test_ignored_file_not_disposable_is_refused(self):
        # A10: `git worktree remove` deletes ignored files, so an ignored file (a local .env)
        # blocks cleanup unless it matches a disposable pattern from project.md.
        wt = self.ignored_worktree()
        ok, reasons = cleanup_check.check(str(self.repo), 'feat', worktree=str(wt), fetch=True)
        self.assertFalse(ok)
        self.assertTrue(any('ignored' in r and '.env' in r for r in reasons), reasons)

        ok, reasons = cleanup_check.check(str(self.repo), 'feat', worktree=str(wt), fetch=True,
                                          disposable=['target/'])
        self.assertFalse(ok)
        self.assertTrue(any('ignored' in r and '.env' in r for r in reasons), reasons)
        self.assertFalse(any('target/' in r for r in reasons), reasons)

    def test_ignored_files_all_disposable_are_ok(self):
        wt = self.ignored_worktree()
        self.assertEqual(
            cleanup_check.check(str(self.repo), 'feat', worktree=str(wt), fetch=True,
                                disposable=['target/', '.env']),
            (True, []),
        )

    def test_disposable_patterns_match_names_and_directories(self):
        match = cleanup_check._disposable
        self.assertTrue(match('target/debug/app', ['target/']))
        self.assertTrue(match('crates/x/target/debug/app', ['target/']))
        self.assertTrue(match('pkg/__pycache__/m.cpython-312.pyc', ['__pycache__/']))
        self.assertTrue(match('a/b.pyc', ['*.pyc']))
        self.assertFalse(match('target', ['target/']))  # a file named target is not the dir
        self.assertFalse(match('src/.env', ['target/', 'node_modules/']))
        self.assertTrue(match('build/out.o', ['/build/']))
        self.assertFalse(match('sub/build/out.o', ['/build/']))
        self.assertFalse(match('a', []))

    def test_cli_passes_repeated_disposable_patterns(self):
        wt = self.ignored_worktree()
        script = str(SCRIPTS / 'cleanup_check.py')
        refused = subprocess.run(
            [sys.executable, script, str(self.repo), 'feat', '--worktree', str(wt),
             '--disposable', 'target/'],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(refused.returncode, 1, refused.stdout + refused.stderr)
        accepted = subprocess.run(
            [sys.executable, script, str(self.repo), 'feat', '--worktree', str(wt),
             '--disposable', 'target/', '--disposable', '.env'],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
        self.assertEqual(json.loads(accepted.stdout), {'ok': True, 'reasons': []})


if __name__ == '__main__':
    unittest.main()
