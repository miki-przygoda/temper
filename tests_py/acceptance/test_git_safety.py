"""Acceptance tests for the git-safety group (docs/v1-behaviour.md, GIT-SAFETY-04..11, 14).

The scripts are driven through their CLIs with subprocess, the way the run and cleanup skills run
them: ``done_tasks.py <repo> <branch> <base> <epic>`` and
``cleanup_check.py <repo> <branch> [--worktree P]``. Every test builds throwaway git repos: a
bare ``origin`` with a default branch, a clone of it as the user's repo, and a second clone that
plays "someone else, on the remote". HOME, CLAUDE_CONFIG_DIR and the git global config are
temporary, so the user's own config is never read or written. The only remote anything touches is
the temporary bare repo. GIT-SAFETY-01..03, 12 and 13 are in test/acceptance/git-safety.test.mjs.
The ssh host of amendment A7 is a local clone reached through a stub ssh on PATH.

A test that fails because of the product is skipped with "acceptance-failing: <id>".
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CLEANUP = ROOT / 'scripts' / 'cleanup_check.py'
DONE = ROOT / 'scripts' / 'done_tasks.py'
CLEANUP_SKILL = (ROOT / 'skills' / 'cleanup' / 'SKILL.md').read_text(encoding='utf-8')
RUN_SKILL = (ROOT / 'skills' / 'run' / 'SKILL.md').read_text(encoding='utf-8')


class GitSandbox(unittest.TestCase):
    """Temporary HOME, CLAUDE_CONFIG_DIR and git config, with helpers to build repos."""

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

    # ---- git helpers ----

    def git(self, cwd, *args, check=True):
        proc = subprocess.run(['git', '-C', str(cwd), *args], env=self.env,
                              capture_output=True, text=True, check=False)
        if check and proc.returncode != 0:
            raise AssertionError(f'git {args} failed: {proc.stderr}')
        return proc.stdout.strip()

    def commit(self, repo, message, name=None):
        self.n += 1
        name = name or f'f{self.n}.txt'
        path = Path(repo) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f'{self.n}\n', encoding='utf-8')
        self.git(repo, 'add', name)
        self.git(repo, 'commit', '-q', '--no-gpg-sign', '-m', message)
        return self.git(repo, 'rev-parse', 'HEAD')

    def remote(self, default='main'):
        """A bare origin whose default branch is `default`, and the user's clone of it."""
        origin = self.tmp / 'origin.git'
        seed = self.tmp / 'seed'
        self.git(self.tmp, 'init', '-q', '--bare', '-b', default, str(origin))
        self.git(self.tmp, 'init', '-q', '-b', default, str(seed))
        self.commit(seed, 'init')
        self.git(seed, 'remote', 'add', 'origin', str(origin))
        self.git(seed, 'push', '-q', 'origin', default)
        repo = self.tmp / 'repo'
        self.git(self.tmp, 'clone', '-q', str(origin), str(repo))
        return repo, origin

    def other_clone(self, origin, name='other'):
        path = self.tmp / name
        self.git(self.tmp, 'clone', '-q', str(origin), str(path))
        return path

    # ---- the scripts, through their CLIs ----

    def cleanup(self, repo, branch, *extra):
        proc = subprocess.run([sys.executable, str(CLEANUP), str(repo), branch, *extra],
                              cwd=str(self.tmp), env=self.env, capture_output=True, text=True,
                              check=False, timeout=60)
        try:
            out = json.loads(proc.stdout)
        except ValueError:
            self.fail(f'cleanup_check printed no JSON: {proc.stdout!r} {proc.stderr!r}')
        return proc.returncode, out, proc.stdout

    def assert_ok(self, repo, branch, *extra):
        code, out, raw = self.cleanup(repo, branch, *extra)
        self.assertEqual(code, 0, raw)
        self.assertIs(out['ok'], True, raw)
        self.assertEqual(out.get('reasons'), [], raw)

    def assert_not_ok(self, repo, branch, *extra):
        code, out, raw = self.cleanup(repo, branch, *extra)
        self.assertEqual(code, 1, raw)
        self.assertIs(out['ok'], False, raw)
        self.assertIsInstance(out['reasons'], list, raw)
        self.assertTrue(out['reasons'], f'not ok comes with a reason: {raw}')
        self.assertTrue(all(isinstance(r, str) and r.strip() for r in out['reasons']), raw)
        return out['reasons']

    def feature(self, repo, branch='temper/e/a', commits=1):
        self.git(repo, 'checkout', '-q', '-b', branch)
        for i in range(commits):
            self.commit(repo, f'feat: {branch} {i}')
        self.git(repo, 'checkout', '-q', '-')
        return self.git(repo, 'rev-parse', branch)

    def worktree(self, repo, branch, name='wt'):
        path = self.tmp / name
        self.git(repo, 'worktree', 'add', '-q', str(path), branch)
        return path


class TestGitSafety(GitSandbox):

    def test_GIT_SAFETY_04_work_not_on_the_remote_is_never_deleted(self):
        repo, origin = self.remote()

        # The deciding check refuses every way work can be off the remote.
        self.feature(repo, 'temper/e/unpushed')
        self.assert_not_ok(repo, 'temper/e/unpushed')

        self.feature(repo, 'temper/e/ahead')
        self.git(repo, 'push', '-q', 'origin', 'temper/e/ahead')
        self.git(repo, 'checkout', '-q', 'temper/e/ahead')
        self.commit(repo, 'feat: more, not pushed')
        self.git(repo, 'checkout', '-q', 'main')
        self.assert_not_ok(repo, 'temper/e/ahead')

        self.feature(repo, 'temper/e/dirty')
        self.git(repo, 'push', '-q', 'origin', 'temper/e/dirty')
        wt = self.worktree(repo, 'temper/e/dirty')
        (wt / 'scratch.txt').write_text('work in progress\n', encoding='utf-8')
        self.assert_not_ok(repo, 'temper/e/dirty', '--worktree', str(wt))
        self.assertTrue((wt / 'scratch.txt').exists(), 'the check removes nothing')

        self.assert_not_ok(repo, 'temper/e/no-such-branch')

        # A remote that can't be reached: nothing can be shown to be on it.
        self.feature(repo, 'temper/e/offline')
        self.git(repo, 'push', '-q', 'origin', 'temper/e/offline')
        self.git(repo, 'remote', 'set-url', 'origin', str(self.tmp / 'missing.git'))
        self.assert_not_ok(repo, 'temper/e/offline')

        # Running the check deleted nothing.
        for b in ('temper/e/unpushed', 'temper/e/ahead', 'temper/e/dirty', 'temper/e/offline'):
            self.assertTrue(self.git(repo, 'branch', '--list', b), f'{b} still exists')
        self.assertIn(str(wt), self.git(repo, 'worktree', 'list'))

        # Cleanup deletes only on the check's exit 0, and never forces.
        self.assertIn('cleanup_check.py', CLEANUP_SKILL)
        self.assertIn('Deleting, only on exit 0', CLEANUP_SKILL)
        self.assertIn('Any other exit status, a crash, or output you can\'t parse counts as exit 1',
                      CLEANUP_SKILL)
        self.assertIn('Never pass `--force`', CLEANUP_SKILL)
        self.assertIn('Never `-D`', CLEANUP_SKILL)
        self.assertIn('Never delete a remote branch', CLEANUP_SKILL)
        self.assertIn('If any worktree under it failed its check, nothing is deleted there',
                      CLEANUP_SKILL)
        self.assertNotIn('git push origin --delete', CLEANUP_SKILL)

        # The branch was pushed, then its remote branch was deleted without being merged (a PR
        # closed and its branch removed). The local tracking ref is stale; the work is on the
        # user's machine only.
        tip = self.feature(repo, 'temper/e/gone')
        self.git(repo, 'remote', 'set-url', 'origin', str(origin))
        self.git(repo, 'push', '-q', '-u', 'origin', 'temper/e/gone')
        self.git(origin, 'branch', '-q', '-D', 'temper/e/gone')
        self.assertEqual(self.git(origin, 'branch', '--list', 'temper/e/gone'), '')
        self.assertNotEqual(
            self.git(origin, 'merge-base', '--is-ancestor', tip, 'main', check=False), 0)
        self.assert_not_ok(repo, 'temper/e/gone')
        self.assertTrue(self.git(repo, 'branch', '--list', 'temper/e/gone'))

    def test_GIT_SAFETY_05_done_ids_are_exactly_this_epics_trailers_on_the_branch(self):
        repo, _origin = self.remote()
        self.commit(repo, 'chore: base work\n\nTemper-Task: f/base-task')
        self.git(repo, 'checkout', '-q', '-b', 'temper/e')
        self.commit(repo, 'feat: a\n\nTemper-Task: e/a')
        self.commit(repo, 'feat: b\n\nTemper-Task: e/b')
        self.commit(repo, 'feat: b again\n\nTemper-Task: e/b')
        self.commit(repo, 'test: checkpoint\n\nTemper-Task: e/checkpoint')
        self.commit(repo, 'test: acceptance\n\nTemper-Task: e/acceptance:g1')
        self.commit(repo, 'fix: one\n\nTemper-Task: e/fix:security-01')
        self.commit(repo, 'feat: other epic\n\nTemper-Task: f/zz')
        self.commit(repo, 'feat: prefix lookalike\n\nTemper-Task: ee/q')
        self.commit(repo, 'feat: two trailers\n\nTemper-Task: f/y\nTemper-Task: e/c')
        self.commit(repo, 'chore: no trailer')
        # A task branch merged into the epic branch with a merge commit, as the merge agent does.
        # (Named outside temper/e/: git can't hold refs temper/e and temper/e/<id> at once.)
        self.git(repo, 'checkout', '-q', '-b', 'task-m')
        self.commit(repo, 'feat: m\n\nTemper-Task: e/m')
        self.git(repo, 'checkout', '-q', 'temper/e')
        self.git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'task-m')
        # A commit on another branch, not on the epic branch.
        self.git(repo, 'checkout', '-q', '-b', 'task-unmerged')
        self.commit(repo, 'feat: not merged\n\nTemper-Task: e/unmerged')
        self.git(repo, 'checkout', '-q', 'main')

        proc = subprocess.run([sys.executable, str(DONE), str(repo), 'temper/e', 'main', 'e'],
                              cwd=str(self.tmp), env=self.env, capture_output=True, text=True,
                              check=False, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        ids = json.loads(proc.stdout)
        self.assertIsInstance(ids, list)
        self.assertEqual(sorted(ids), sorted(set(ids)), 'each id once')
        self.assertEqual(set(ids), {'a', 'b', 'c', 'checkpoint', 'acceptance:g1',
                                    'fix:security-01', 'm'})

        # The other epic sees only its own trailers on its own range.
        proc = subprocess.run([sys.executable, str(DONE), str(repo), 'temper/e', 'main', 'f'],
                              cwd=str(self.tmp), env=self.env, capture_output=True, text=True,
                              check=False, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(set(json.loads(proc.stdout)), {'zz', 'y'})

        # The run skill sets args.done to exactly that output.
        self.assertIn('done_tasks.py" <repo> <branch> <base> <epic>', RUN_SKILL)
        self.assertIn('Set `args.done` to exactly that array', RUN_SKILL)

    def test_GIT_SAFETY_06_branch_reachable_from_the_default_branch_is_ok(self):
        # The remote's default branch is `trunk`, so "main"/"master" guesses can't pass this.
        repo, _origin = self.remote(default='trunk')
        tip = self.feature(repo, 'temper/e', commits=2)
        before = self.git(repo, 'rev-parse', 'origin/trunk')
        # The PR is merged on the remote by someone else; the user's repo hasn't fetched it yet.
        self.git(repo, 'checkout', '-q', 'trunk')
        self.git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'temper/e')
        self.git(repo, 'push', '-q', 'origin', 'trunk')
        self.git(repo, 'reset', '-q', '--hard', before)
        self.git(repo, 'update-ref', 'refs/remotes/origin/trunk', before)
        self.assertEqual(self.git(repo, 'branch', '-r', '--list', 'origin/temper/e'), '',
                         'the branch itself has no remote ref')
        self.assertNotEqual(
            self.git(repo, 'merge-base', '--is-ancestor', tip, 'refs/remotes/origin/trunk',
                     check=False), 0)
        self.assert_ok(repo, 'temper/e')

    def test_GIT_SAFETY_07_unmerged_branch_equal_to_its_remote_ref_is_ok(self):
        repo, _origin = self.remote()
        tip = self.feature(repo, 'temper/e', commits=2)
        self.git(repo, 'push', '-q', 'origin', 'temper/e')
        self.assertEqual(self.git(repo, 'rev-parse', 'origin/temper/e'), tip)
        self.assertNotEqual(
            self.git(repo, 'merge-base', '--is-ancestor', tip, 'origin/main', check=False), 0)
        self.assert_ok(repo, 'temper/e')

    def test_GIT_SAFETY_08_commits_on_neither_the_default_branch_nor_the_remote_ref(self):
        repo, origin = self.remote()

        # Ahead of its remote ref.
        self.feature(repo, 'temper/e')
        self.git(repo, 'push', '-q', 'origin', 'temper/e')
        self.git(repo, 'checkout', '-q', 'temper/e')
        self.commit(repo, 'feat: one more, not pushed')
        self.git(repo, 'checkout', '-q', 'main')
        self.assert_not_ok(repo, 'temper/e')

        # Its earlier commits were merged into the default branch, a later one is unpushed.
        self.git(repo, 'checkout', '-q', '-b', 'temper/f')
        self.commit(repo, 'feat: merged part')
        self.git(repo, 'checkout', '-q', 'main')
        self.git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'temper/f')
        self.git(repo, 'push', '-q', 'origin', 'main')
        self.git(repo, 'checkout', '-q', 'temper/f')
        self.commit(repo, 'feat: unpushed part')
        self.git(repo, 'checkout', '-q', 'main')
        self.assert_not_ok(repo, 'temper/f')

        # Unpushed entirely.
        self.feature(repo, 'temper/g')
        self.assert_not_ok(repo, 'temper/g')

    def test_GIT_SAFETY_09_no_remote_ref_and_not_on_the_default_branch(self):
        repo, origin = self.remote()
        self.feature(repo, 'temper/e', commits=3)
        self.assertEqual(self.git(repo, 'branch', '-r', '--list', 'origin/temper/e'), '')
        # Another branch with the same name pattern exists on the remote; it doesn't count.
        self.feature(repo, 'temper/e2')
        self.git(repo, 'push', '-q', 'origin', 'temper/e2')
        self.assert_not_ok(repo, 'temper/e')

    def test_GIT_SAFETY_10_worktree_with_uncommitted_changes_is_not_ok(self):
        repo, _origin = self.remote()
        self.feature(repo, 'temper/e')
        self.git(repo, 'push', '-q', 'origin', 'temper/e')
        wt = self.worktree(repo, 'temper/e')
        self.assert_ok(repo, 'temper/e', '--worktree', str(wt))  # clean: ok

        tracked = sorted(p.name for p in wt.iterdir() if p.suffix == '.txt')[0]
        (wt / tracked).write_text('edited, not committed\n', encoding='utf-8')
        self.assert_not_ok(repo, 'temper/e', '--worktree', str(wt))

        # A staged-only change is uncommitted too.
        self.git(wt, 'add', tracked)
        self.assert_not_ok(repo, 'temper/e', '--worktree', str(wt))

        # A deleted tracked file is an uncommitted change.
        self.git(wt, 'reset', '-q', '--hard')
        (wt / tracked).unlink()
        self.assert_not_ok(repo, 'temper/e', '--worktree', str(wt))

    def test_GIT_SAFETY_11_worktree_with_untracked_files_is_not_ok(self):
        repo, _origin = self.remote()
        self.feature(repo, 'temper/e')
        self.git(repo, 'push', '-q', 'origin', 'temper/e')
        wt = self.worktree(repo, 'temper/e')
        (wt / 'new').mkdir()
        (wt / 'new' / 'deep').mkdir()
        (wt / 'new' / 'deep' / 'notes.md').write_text('unsaved notes\n', encoding='utf-8')
        self.assert_not_ok(repo, 'temper/e', '--worktree', str(wt))

    def _status(self, cwd):
        # The ahead/behind line follows the remote-tracking refs, which a fetch may move.
        out = self.git(cwd, 'status', '--porcelain=v2', '--branch', '--untracked-files=all',
                       '--ignored')
        return [ln for ln in out.splitlines() if not ln.startswith('# branch.ab')]

    def _snapshot(self, repo, worktrees, origin):
        def tree(path):
            h = hashlib.sha256()
            for p in sorted(Path(path).rglob('*')):
                if '.git' in p.relative_to(path).parts:
                    continue
                h.update(str(p.relative_to(path)).encode())
                if p.is_file():
                    h.update(p.read_bytes())
            return h.hexdigest()

        refs = [r for r in self.git(repo, 'for-each-ref', '--format=%(refname) %(objectname)')
                .splitlines() if not r.startswith('refs/remotes/')]
        snap = {
            'refs': refs,
            'head': self.git(repo, 'symbolic-ref', '-q', 'HEAD', check=False),
            'head_sha': self.git(repo, 'rev-parse', 'HEAD'),
            'config': (Path(repo) / '.git' / 'config').read_text(encoding='utf-8'),
            'stash': self.git(repo, 'stash', 'list'),
            'worktrees': self.git(repo, 'worktree', 'list', '--porcelain'),
            'origin_refs': self.git(origin, 'for-each-ref', '--format=%(refname) %(objectname)'),
            'tree': tree(repo),
        }
        for i, wt in enumerate(worktrees):
            snap[f'wt{i}_status'] = self._status(wt)
            snap[f'wt{i}_index'] = self.git(wt, 'ls-files', '--stage')
            snap[f'wt{i}_tree'] = tree(wt)
        snap['repo_status'] = self._status(repo)
        snap['repo_index'] = self.git(repo, 'ls-files', '--stage')
        return snap

    def test_GIT_SAFETY_14_repeated_checks_agree_and_change_nothing_but_remote_refs(self):
        repo, origin = self.remote()
        # An ok case: pushed, clean worktree.
        self.feature(repo, 'temper/ok')
        self.git(repo, 'push', '-q', 'origin', 'temper/ok')
        wt_ok = self.worktree(repo, 'temper/ok', 'wt-ok')
        # A not-ok case: unpushed, with uncommitted and untracked files in its worktree.
        self.feature(repo, 'temper/bad')
        wt_bad = self.worktree(repo, 'temper/bad', 'wt-bad')
        tracked = sorted(p.name for p in wt_bad.iterdir() if p.suffix == '.txt')[0]
        (wt_bad / tracked).write_text('changed\n', encoding='utf-8')
        (wt_bad / 'untracked.txt').write_text('new\n', encoding='utf-8')
        # The remote moved on since the last fetch, so the first check's fetch has something to do.
        other = self.other_clone(origin)
        self.commit(other, 'feat: someone else')
        self.git(other, 'push', '-q', 'origin', 'main')

        before = self._snapshot(repo, [wt_ok, wt_bad], origin)
        cases = [('temper/ok', wt_ok, 0), ('temper/bad', wt_bad, 1), ('temper/bad', None, 1)]
        for branch, wt, want in cases:
            extra = ('--worktree', str(wt)) if wt else ()
            results = [self.cleanup(repo, branch, *extra) for _ in range(3)]
            codes = {r[0] for r in results}
            outputs = {r[2] for r in results}
            self.assertEqual(codes, {want}, results)
            self.assertEqual(len(outputs), 1, f'the same answer every time: {outputs}')
        after = self._snapshot(repo, [wt_ok, wt_bad], origin)
        self.assertEqual(after, before)

    # ---- A7: the ssh host's commits come back before done_tasks.py and before a push ----

    def _stub_ssh(self):
        """A stand-in for ssh on PATH: it records the host and runs the command locally."""
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        log = self.tmp / 'ssh.log'
        stub = bin_dir / 'ssh'
        stub.write_text(
            '#!/bin/sh\n'
            'while [ $# -gt 1 ]; do\n'
            '  case "$1" in\n'
            '    -G) exit 0 ;;\n'
            '    -o|-p|-l|-i) shift 2 ;;\n'
            '    -*) shift ;;\n'
            '    *) break ;;\n'
            '  esac\n'
            'done\n'
            f'echo "$1" >> \'{log}\'\n'
            'shift\n'
            'exec sh -c "$*"\n',
            encoding='utf-8')
        stub.chmod(0o755)
        env = dict(self.env, PATH=f'{bin_dir}:{self.env["PATH"]}')
        return env, log

    def _done(self, repo, branch):
        proc = subprocess.run([sys.executable, str(DONE), str(repo), branch, 'main', 'e'],
                              cwd=str(self.tmp), env=self.env, capture_output=True, text=True,
                              check=False, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def test_A7_ssh_host_branches_are_fetched_back_before_done_tasks_and_before_a_push(self):
        before = RUN_SKILL[RUN_SKILL.index('## Before every launch or resume'):
                           RUN_SKILL.index('## Launching and resuming')]
        cmd = self._fetch_back_cmd()
        self.assertLess(before.index(cmd), before.index('scripts/done_tasks.py'),
                        'the fetch comes before done_tasks.py')
        self.assertNotIn('+refs', cmd, 'the fetch never forces a ref')
        self.assertNotIn('--force', cmd)
        sync = (ROOT / 'scripts' / 'host_sync.py').read_text(encoding='utf-8')
        # A forced refspec may only fill temper's private copy of the host's refs, never a
        # branch: refs/heads/ moves only by a fast-forward (SECOND-CONTROL-FLOW-1).
        forced = re.findall(r"""f?['"]\+(refs/[^'"]*)['"]""", sync)
        self.assertTrue(forced, 'the private refs are fetched with + so they follow a rewrite')
        for spec in forced:
            self.assertRegex(spec, r':\{PRIVATE\}', f'only the private refs are forced: {spec}')
            self.assertNotIn(':refs/heads/', spec)
        self.assertNotIn('--force', sync)
        stage5 = RUN_SKILL[RUN_SKILL.index('## Stage 5'):]
        self.assertRegex(stage5, r'ssh host[^\n]*fetch[\s\S]*git push -u origin <branch>',
                         'the fetch comes before the push')

        repo, origin = self.remote()
        self.git(repo, 'branch', '--no-track', 'epic/e', 'main')
        # The host's clone, where the agents commit: one task merged, one still on its branch.
        # The epic branch gets there the way the run skill puts it there, never by hand.
        host_clone = self.tmp / 'host' / 'repo'
        self.git(self.tmp, 'clone', '-q', str(origin), str(host_clone))
        env, log = self._stub_ssh()
        push, _ = self._push_cmd('## Before every launch or resume', '## Launching and resuming')
        proc = self._run_skill_cmd(push, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.git(host_clone, 'checkout', '-q', 'epic/e')
        self.git(host_clone, 'checkout', '-q', '-b', 'temper/e/a')
        self.commit(host_clone, 'feat: a\n\nTemper-Task: e/a')
        self.git(host_clone, 'checkout', '-q', 'epic/e')
        self.git(host_clone, 'merge', '-q', '--no-ff', '--no-edit', 'temper/e/a')
        self.git(host_clone, 'checkout', '-q', '-b', 'temper/e/b')
        self.commit(host_clone, 'feat: b, not merged yet\n\nTemper-Task: e/b')
        self.git(host_clone, 'checkout', '-q', 'main')

        # Without the fetch the user's repo knows nothing of the host's work.
        self.assertEqual(self._done(repo, 'epic/e'), [])

        log.write_text('', encoding='utf-8')
        run = lambda: self._run_skill_cmd(cmd, env, repo, host_clone)
        proc = run()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(log.read_text(encoding='utf-8').split(), ['buildhost'])
        self.assertEqual(self._done(repo, 'epic/e'), ['a'])
        for ref in ('epic/e', 'temper/e/a', 'temper/e/b'):
            self.assertEqual(self.git(repo, 'rev-parse', ref), self.git(host_clone, 'rev-parse', ref), ref)

        # A local commit the host lacks is never overwritten: the fetch fails and the head stops.
        local = self.git(repo, 'rev-parse', 'epic/e')
        self.git(repo, 'checkout', '-q', 'epic/e')
        mine = self.commit(repo, 'fix: local only')
        self.git(repo, 'checkout', '-q', 'main')
        self.git(host_clone, 'checkout', '-q', 'epic/e')
        self.commit(host_clone, 'feat: more on the host')
        self.git(host_clone, 'checkout', '-q', 'main')
        self.assertNotEqual(run().returncode, 0)
        self.assertEqual(self.git(repo, 'rev-parse', 'epic/e'), mine)
        self.assertNotEqual(mine, local)
        self.assertIn('On a non-zero exit, stop', before)


    # ---- SECOND-CONTROL-FLOW-1: the fetch-back never moves a checked-out branch under its worktree ----

    def _fetch_back_cmd(self):
        before = RUN_SKILL[RUN_SKILL.index('## Before every launch or resume'):
                           RUN_SKILL.index('## Launching and resuming')]
        cmds = [l.strip() for l in before.splitlines()
                if '<host_clone>' in l and ' fetch ' in l and l.strip().startswith(('git ', 'python3 '))]
        self.assertEqual(len(cmds), 1, f'the run skill gives one fetch-back command: {cmds}')
        return cmds[0]

    def _run_skill_cmd(self, cmd, env, repo, host_clone):
        line = (cmd.replace('<repo>', str(repo)).replace('<host>', 'buildhost')
                .replace('<host_clone>', str(host_clone)).replace('<branch>', 'epic/e')
                .replace('<epic>', 'e'))
        return subprocess.run(['sh', '-c', line], cwd=str(self.tmp),
                              env=dict(env, CLAUDE_PLUGIN_ROOT=str(ROOT)), capture_output=True,
                              text=True, check=False, timeout=60)

    def test_SECOND_CONTROL_FLOW_1_fetch_back_with_the_epic_branch_checked_out(self):
        cmd = self._fetch_back_cmd()
        repo, origin = self.remote()
        self.git(repo, 'branch', '--no-track', 'epic/e', 'main')
        host_clone = self.tmp / 'host' / 'repo'
        self.git(self.tmp, 'clone', '-q', str(origin), str(host_clone))
        self.git(host_clone, 'branch', '--no-track', 'epic/e', 'origin/main')
        # The epic branch is checked out in a worktree of the user's repo.
        wt = self.tmp / 'wt'
        self.git(repo, 'worktree', 'add', '-q', str(wt), 'epic/e')
        env, _log = self._stub_ssh()

        # Nothing new on the host: the fetch changes nothing, and still succeeds.
        proc = self._run_skill_cmd(cmd, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)

        # The host's agents merged a task: the worktree moves with its branch, and stays clean.
        self.git(host_clone, 'checkout', '-q', 'epic/e')
        tip = self.commit(host_clone, 'feat: a\n\nTemper-Task: e/a')
        self.git(host_clone, 'checkout', '-q', '--detach')
        proc = self._run_skill_cmd(cmd, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'epic/e'), tip)
        self.assertEqual(self.git(wt, 'rev-parse', 'HEAD'), tip)
        self.assertEqual(self.git(wt, 'status', '--porcelain'), '', 'the worktree matches its branch')
        self.assertEqual(self._done(repo, 'epic/e'), ['a'])
        # The host's refs land in a private namespace first, never straight in refs/heads/.
        self.assertEqual(self.git(repo, 'rev-parse', 'refs/temper/host/epic/e'), tip)

        # The same with the branch checked out in the user's own repo, not a linked worktree.
        self.git(repo, 'worktree', 'remove', str(wt))
        self.git(repo, 'checkout', '-q', 'epic/e')
        self.git(host_clone, 'checkout', '-q', 'epic/e')
        tip = self.commit(host_clone, 'feat: b\n\nTemper-Task: e/b')
        self.git(host_clone, 'checkout', '-q', '--detach')
        proc = self._run_skill_cmd(cmd, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'HEAD'), tip)
        self.assertEqual(self.git(repo, 'status', '--porcelain'), '')

        # A fast-forward the worktree can't take (a local edit in the way) moves nothing.
        self.git(host_clone, 'checkout', '-q', 'epic/e')
        self.commit(host_clone, 'feat: c', name='clash.txt')
        self.git(host_clone, 'checkout', '-q', '--detach')
        (repo / 'clash.txt').write_text('mine\n', encoding='utf-8')
        proc = self._run_skill_cmd(cmd, env, repo, host_clone)
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.git(repo, 'rev-parse', 'HEAD'), tip)
        self.assertEqual(self.git(repo, 'rev-parse', 'epic/e'), tip)
        self.assertEqual((repo / 'clash.txt').read_text(encoding='utf-8'), 'mine\n')

    def test_SECOND_CONTROL_FLOW_1_a_rewritten_host_branch_does_not_wedge_the_private_refs(self):
        cmd = self._fetch_back_cmd()
        repo, origin = self.remote()
        self.git(repo, 'branch', '--no-track', 'epic/e', 'main')
        host_clone = self.tmp / 'host' / 'repo'
        self.git(self.tmp, 'clone', '-q', str(origin), str(host_clone))
        self.git(host_clone, 'branch', '--no-track', 'epic/e', 'origin/main')
        env, _log = self._stub_ssh()
        # A task branch on the host, fetched back once.
        self.git(host_clone, 'checkout', '-q', '-b', 'temper/e/a', 'epic/e')
        first = self.commit(host_clone, 'feat: a\n\nTemper-Task: e/a')
        self.git(host_clone, 'checkout', '-q', '--detach')
        proc = self._run_skill_cmd(cmd, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'refs/temper/host/temper/e/a'), first)
        # The host rewrites it (an agent rebased its branch).
        self.git(host_clone, 'checkout', '-q', 'temper/e/a')
        self.git(host_clone, 'commit', '-q', '--amend', '-m', 'feat: a, rebased\n\nTemper-Task: e/a')
        rewritten = self.git(host_clone, 'rev-parse', 'HEAD')
        self.git(host_clone, 'checkout', '-q', '--detach')
        # A local copy holding the old commit is a real divergence: refused, nothing local moves.
        proc = self._run_skill_cmd(cmd, env, repo, host_clone)
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.git(repo, 'rev-parse', 'temper/e/a'), first)
        # Once the head drops its stale copy, the fetch-back goes on: the private ref follows the
        # host's rewrite instead of refusing it forever.
        self.git(repo, 'branch', '-D', 'temper/e/a')
        proc = self._run_skill_cmd(cmd, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'refs/temper/host/temper/e/a'), rewritten)
        self.assertEqual(self.git(repo, 'rev-parse', 'temper/e/a'), rewritten)

    # ---- SECOND-TESTS-DOCS-1: the epic branch, with the spec and plan, reaches the host clone ----

    def _push_cmd(self, section_start, section_end):
        text = RUN_SKILL[RUN_SKILL.index(section_start):RUN_SKILL.index(section_end)]
        cmds = [l.strip() for l in text.splitlines()
                if '<host_clone>' in l and ' push ' in l and l.strip().startswith(('git ', 'python3 '))]
        self.assertEqual(len(cmds), 1, f'one push-to-the-host command in {section_start}: {cmds}')
        return cmds[0], text

    def test_SECOND_TESTS_DOCS_1_the_first_launch_puts_the_epic_branch_on_the_host(self):
        push, before = self._push_cmd('## Before every launch or resume', '## Launching and resuming')
        self.assertLess(before.index('git -C <repo> branch --no-track <branch> <base>'), before.index(push),
                        'the branch is pushed to the host once step 2 has created it')
        repo, origin = self.remote()
        # The host clone was made from origin, which lacks what the plan skill committed locally.
        host_clone = self.tmp / 'host' / 'repo'
        self.git(self.tmp, 'clone', '-q', str(origin), str(host_clone))
        spec = self.commit(repo, 'docs(temper): e spec and plan', name='docs/temper/e/spec.md')
        self.git(repo, 'branch', '--no-track', 'epic/e', 'main')
        self.assertEqual(self.git(host_clone, 'branch', '--list', 'epic/e'), '')
        env, _log = self._stub_ssh()
        proc = self._run_skill_cmd(push, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(host_clone, 'rev-parse', 'epic/e'), spec)
        self.git(host_clone, 'cat-file', '-e', 'epic/e:docs/temper/e/spec.md')
        # An implementer on the host can branch from it, and the fetch-back then works.
        wt = self.tmp / 'host' / 'e' / 'a'
        self.git(host_clone, 'worktree', 'add', '-q', '-b', 'temper/e/a', str(wt), 'epic/e')
        self.commit(wt, 'feat: a\n\nTemper-Task: e/a')
        proc = self._run_skill_cmd(self._fetch_back_cmd(), env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'temper/e/a'), self.git(wt, 'rev-parse', 'HEAD'))
        # A host branch of the same name that isn't an ancestor is never overwritten.
        self.git(host_clone, 'branch', '-f', 'epic/e', 'temper/e/a')
        self.git(repo, 'checkout', '-q', 'epic/e')
        self.commit(repo, 'docs: a local change')
        proc = self._run_skill_cmd(push, env, repo, host_clone)
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.git(host_clone, 'rev-parse', 'epic/e'), self.git(wt, 'rev-parse', 'HEAD'))

    # ---- A7-REGRESSION: the head's own commits on the epic branch don't stop the fetch-back ----

    def test_A7_REGRESSION_a_head_commit_on_the_epic_branch_reaches_the_host_and_the_fetch_back_goes_on(self):
        section = "### Ids that aren't tasks"
        push, text = self._push_cmd(section, '## Stage 4')
        self.assertRegex(text, r'With an ssh host, fetch back first[^\n]*before you commit',
                         'the head fetches back before it commits')
        self.assertLess(text.index('Right after each commit you make on the epic branch'), text.index(push),
                        'and puts its commit on the host right after')
        fetch = self._fetch_back_cmd()

        repo, origin = self.remote()
        host_clone = self.tmp / 'host' / 'repo'
        self.git(self.tmp, 'clone', '-q', str(origin), str(host_clone))
        self.git(repo, 'branch', '--no-track', 'epic/e', 'main')
        env, _log = self._stub_ssh()
        first_push, _ = self._push_cmd('## Before every launch or resume', '## Launching and resuming')
        self.assertEqual(self._run_skill_cmd(first_push, env, repo, host_clone).returncode, 0)
        # Wave 0 on the host: task a merged, task b's merge stopped (merge:wave0 is blocked).
        hwt = self.tmp / 'host' / 'e' / 'merge'
        self.git(host_clone, 'worktree', 'add', '-q', str(hwt), 'epic/e')
        self.commit(hwt, 'feat: a\n\nTemper-Task: e/a')
        self.git(hwt, 'switch', '-q', '--detach')
        # The head resolves merge:wave0 on its own epic branch, checked out in the user's repo.
        proc = self._run_skill_cmd(fetch, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.git(repo, 'checkout', '-q', 'epic/e')
        mine = self.commit(repo, 'fix: resolve the wave 0 merge\n\nTemper-Task: e/b')
        # Before the push, a fetch-back (before every push) leaves the head's commit alone.
        proc = self._run_skill_cmd(fetch, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'epic/e'), mine)
        proc = self._run_skill_cmd(push, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(host_clone, 'rev-parse', 'epic/e'), mine)
        # The resume: the fetch-back before done_tasks.py works, and the host builds on the fix.
        proc = self._run_skill_cmd(fetch, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self._done(repo, 'epic/e'), ['a', 'b'])
        self.git(hwt, 'switch', '-q', 'epic/e')
        later = self.commit(hwt, 'test: checkpoint\n\nTemper-Task: e/checkpoint')
        self.git(hwt, 'switch', '-q', '--detach')
        proc = self._run_skill_cmd(fetch, env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'HEAD'), later)
        self.assertEqual(self.git(repo, 'status', '--porcelain'), '')
        # Commits on both sides are never resolved by the fetch: it stops and changes nothing.
        self.git(hwt, 'switch', '-q', 'epic/e')
        theirs = self.commit(hwt, 'feat: on the host')
        self.git(hwt, 'switch', '-q', '--detach')
        self.commit(repo, 'fix: local, not pushed')
        local = self.git(repo, 'rev-parse', 'epic/e')
        proc = self._run_skill_cmd(fetch, env, repo, host_clone)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('diverged', proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'epic/e'), local)
        proc = self._run_skill_cmd(push, env, repo, host_clone)
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.git(host_clone, 'rev-parse', 'epic/e'), theirs)

    # ---- SECOND-CONTROL-FLOW-2: the head's copy of the epic branch reaches the host before every launch ----

    def test_SECOND_CONTROL_FLOW_2_every_launch_brings_the_heads_commits_to_the_host(self):
        push, before = self._push_cmd('## Before every launch or resume', '## Launching and resuming')
        fetch = self._fetch_back_cmd()
        self.assertLess(before.index(fetch), before.index('scripts/done_tasks.py'))
        self.assertLess(before.index('scripts/done_tasks.py'), before.index(push),
                        'the push is a step of every launch, after the fetch-back and done_tasks.py')
        self.assertRegex(before, r'before every launch or resume, the first one too')
        stage5 = RUN_SKILL[RUN_SKILL.index('## Stage 5'):]
        self.assertRegex(stage5, r'`ahead`[^\n]*[\s\S]*git push -u origin <branch>',
                         'nothing the host never had goes to origin')

        repo, origin = self.remote()
        host_clone = self.tmp / 'host' / 'repo'
        self.git(self.tmp, 'clone', '-q', str(origin), str(host_clone))
        self.git(repo, 'branch', '--no-track', 'epic/e', 'main')
        env, _log = self._stub_ssh()
        self.assertEqual(self._run_skill_cmd(push, env, repo, host_clone).returncode, 0)
        # A commit of the head's that never reached the host (its push was refused, say).
        self.git(repo, 'checkout', '-q', 'epic/e')
        mine = self.commit(repo, 'fix: the checkpoint\n\nTemper-Task: e/checkpoint')
        # An agent left the epic branch checked out on the host: the push is refused, nothing moves.
        hwt = self.tmp / 'host' / 'e' / 'x'
        self.git(host_clone, 'worktree', 'add', '-q', str(hwt), 'epic/e')
        old = self.git(host_clone, 'rev-parse', 'epic/e')
        for cmd in (fetch, push):
            proc = self._run_skill_cmd(cmd, env, repo, host_clone)
            if cmd is fetch:
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertEqual(json.loads(proc.stdout)['ahead'], ['epic/e'])
            else:
                self.assertNotEqual(proc.returncode, 0)
                self.assertIn('checked out', proc.stderr)
        self.assertEqual(self.git(host_clone, 'rev-parse', 'epic/e'), old)
        self.assertEqual(self.git(hwt, 'status', '--porcelain'), '')
        # Once it is checked out nowhere on the host, the next launch brings the commit there.
        self.git(hwt, 'switch', '-q', '--detach')
        for cmd in (fetch, push):
            proc = self._run_skill_cmd(cmd, env, repo, host_clone)
            self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(host_clone, 'rev-parse', 'epic/e'), mine)
        proc = self._run_skill_cmd(fetch, env, repo, host_clone)
        self.assertEqual(json.loads(proc.stdout)['ahead'], [], 'after the push the two are the same')

    # ---- SECOND-SAFETY-7: the host's login directory is not on the cleanup check's sys.path ----

    def test_SECOND_SAFETY_7_the_host_cleanup_check_runs_isolated_from_the_login_directory(self):
        lines = [l.strip() for l in CLEANUP_SKILL.splitlines() if l.strip().startswith('ssh <host> python3')]
        self.assertEqual(len(lines), 1, 'the cleanup skill gives one ssh form of the check')
        cmd = lines[0]
        repo, _origin = self.remote()
        wt = self.tmp / 'wt'
        self.git(repo, 'worktree', 'add', '-q', '-b', 'temper/e/a', str(wt), 'main')
        # The host's login directory holds a json.py; the stub ssh runs the command from there.
        login = self.tmp / 'login'
        login.mkdir()
        marker = self.tmp / 'planted-ran'
        (login / 'json.py').write_text(f'open({str(marker)!r}, "w").close()\n', encoding='utf-8')
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        stub = bin_dir / 'ssh'
        stub.write_text('#!/bin/sh\nshift\ncd ' + f"'{login}'" + ' && exec sh -c "$*"\n', encoding='utf-8')
        stub.chmod(0o755)
        env = dict(self.env, PATH=f'{bin_dir}:{self.env["PATH"]}', CLAUDE_PLUGIN_ROOT=str(ROOT))
        line = (cmd.replace('<host repo>', str(repo)).replace('<branch>', 'temper/e/a')
                .replace('<path>', str(wt)).replace('<host>', 'buildhost'))
        proc = subprocess.run(['sh', '-c', line], cwd=str(self.tmp), env=env, capture_output=True,
                              text=True, check=False, timeout=60)
        self.assertFalse(marker.exists(), 'a json.py in the login directory replaced the stdlib module')
        out = json.loads(proc.stdout)
        self.assertIn('ok', out, proc.stderr)


    # ---- scripts/ssh_host_smoke.sh, in its test-only local mode (a fake ssh on PATH) ----

    def test_ssh_host_smoke_local_mode_passes_and_leaves_nothing_behind(self):
        smoke = ROOT / 'scripts' / 'ssh_host_smoke.sh'
        tmpdir = self.tmp / 'smoke-tmp'
        tmpdir.mkdir()
        env = dict(self.env, TMPDIR=str(tmpdir))
        proc = subprocess.run(['sh', str(smoke), '--local'], cwd=str(self.tmp), env=env,
                              capture_output=True, text=True, check=False, timeout=180)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertRegex(proc.stdout, r'ssh_host_smoke: PASS \(11 checks, host smoke-host, mode local\)')
        for case in ('SECOND-TESTS-DOCS-1', 'SECOND-CONTROL-FLOW-1', 'A7-REGRESSION', 'SECOND-CONTROL-FLOW-2'):
            self.assertRegex(proc.stdout, rf'(?m)^ok \d+ - .*\({case}\)$', case)
        self.assertEqual(list(tmpdir.iterdir()), [], 'the smoke test removed what it made')

        # A failure part-way still removes everything, and exits 1.
        bin_dir = self.tmp / 'nopython'
        bin_dir.mkdir()
        (bin_dir / 'python3').write_text('#!/bin/sh\nexit 3\n', encoding='utf-8')
        (bin_dir / 'python3').chmod(0o755)
        env = dict(env, PATH=f'{bin_dir}:{env["PATH"]}')
        proc = subprocess.run(['sh', str(smoke), '--local'], cwd=str(self.tmp), env=env,
                              capture_output=True, text=True, check=False, timeout=180)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertIn('FAIL - host_sync.py push (first launch)', proc.stderr)
        self.assertEqual(list(tmpdir.iterdir()), [], 'a failed run removed what it made too')

        # Bad usage changes nothing.
        for argv in ([], ['-x'], ['a', 'b']):
            proc = subprocess.run(['sh', str(smoke), *argv], cwd=str(self.tmp), env=env,
                                  capture_output=True, text=True, check=False, timeout=30)
            self.assertEqual(proc.returncode, 2, argv)
        self.assertEqual(list(tmpdir.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
