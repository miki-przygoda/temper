"""Acceptance tests for the worktrees group (docs/temper/v0-3/behaviour.md, WORKTREES-09..19).

The scripts are driven through their CLIs with subprocess, the way the cleanup and run skills run
them: ``cleanup_check.py <repo> --detached --worktree P [--disposable P]...`` and
``host_sync.py fetch <repo> <host> <clone> <branch> <epic>``. Each test builds throwaway git repos
in a temporary directory, with a temporary HOME and git config (the sandbox of
test_git_safety.py). The ssh host is a local clone reached through a stub ssh on PATH; a git
wrapper on PATH records the git commands host_sync.py runs. WORKTREES-01..08 are in
test/acceptance/worktrees.test.mjs.

A test that fails because of the product is skipped with "acceptance-failing: <id>".
"""

import json
import subprocess
import sys
from pathlib import Path

from tests_py.acceptance.test_git_safety import GitSandbox

ROOT = Path(__file__).resolve().parent.parent.parent
CLEANUP = ROOT / 'scripts' / 'cleanup_check.py'
HOST_SYNC = ROOT / 'scripts' / 'host_sync.py'


class TestWorktrees(GitSandbox):

    # ---- helpers ----

    def check(self, *argv):
        proc = subprocess.run([sys.executable, str(CLEANUP), *argv],
                              cwd=str(self.tmp), env=self.env, capture_output=True, text=True,
                              check=False, timeout=60)
        try:
            out = json.loads(proc.stdout)
        except ValueError:
            self.fail(f'cleanup_check printed no JSON: {proc.stdout!r} {proc.stderr!r}')
        self.assertEqual(set(out), {'ok', 'reasons'}, proc.stdout)
        self.assertIsInstance(out['ok'], bool, proc.stdout)
        self.assertIsInstance(out['reasons'], list, proc.stdout)
        self.assertIn(proc.returncode, (0, 1), proc.stdout + proc.stderr)
        self.assertEqual(out['ok'], proc.returncode == 0, proc.stdout)
        return proc.returncode, out, proc.stdout

    def detached(self, repo, wt, *extra):
        return self.check(str(repo), '--detached', '--worktree', str(wt), *extra)

    def throwaway(self, repo, commit='origin/main', label='check-a-12345678', epic='e'):
        path = Path(repo) / '.temper' / 'worktrees' / epic / 'tmp' / label
        path.parent.mkdir(parents=True, exist_ok=True)
        (Path(repo) / '.git' / 'info' / 'exclude').write_text('.temper/\n', encoding='utf-8')
        self.git(repo, 'worktree', 'add', '-q', '--detach', str(path), commit)
        return path

    def snapshot(self, repo, wt):
        """Every ref, every worktree, and every file in the worktree with its content."""
        files = {}
        for p in sorted(Path(wt).rglob('*')):
            rel = p.relative_to(wt)
            if '.git' in rel.parts or not p.is_file():
                continue
            files[str(rel)] = p.read_bytes()
        return (self.git(repo, 'for-each-ref', '--format=%(refname) %(objectname)',
                         'refs/heads/', 'refs/tags/'),
                self.git(repo, 'worktree', 'list', '--porcelain'),
                files)

    def assert_ok(self, repo, wt, *extra):
        code, out, raw = self.detached(repo, wt, *extra)
        self.assertEqual(code, 0, raw)
        self.assertEqual(out, {'ok': True, 'reasons': []}, raw)

    def assert_not_ok(self, repo, wt, *extra):
        code, out, raw = self.detached(repo, wt, *extra)
        self.assertEqual(code, 1, raw)
        self.assertIs(out['ok'], False, raw)
        self.assertTrue(out['reasons'] and all(isinstance(r, str) and r.strip()
                                               for r in out['reasons']), raw)
        return out['reasons']

    # ---- cleanup_check.py --detached ----

    def test_WORKTREES_09_clean_detached_worktree_on_origin_main_exits_0(self):
        repo, _origin = self.remote()
        wt = self.throwaway(repo)
        self.assert_ok(repo, wt)
        self.assertTrue(wt.is_dir())

    def test_WORKTREES_10_head_on_another_remote_tracking_branch_exits_0(self):
        repo, origin = self.remote()
        # A task commit pushed to origin as temper/e/a, never merged into main.
        other = self.other_clone(origin)
        self.git(other, 'checkout', '-q', '-b', 'temper/e/a')
        tip = self.commit(other, 'feat: a\n\nTemper-Task: e/a')
        self.git(other, 'push', '-q', 'origin', 'temper/e/a')
        self.git(repo, 'fetch', '-q', 'origin')
        self.assertNotEqual(
            subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', tip,
                            'origin/main'], env=self.env).returncode, 0)
        wt = self.throwaway(repo, commit=tip)
        self.assert_ok(repo, wt)
        # An ancestor of that branch tip, not the tip itself, is reachable too.
        self.git(other, 'checkout', '-q', 'temper/e/a')
        self.commit(other, 'feat: a, more')
        self.git(other, 'push', '-q', 'origin', 'temper/e/a')
        self.assert_ok(repo, wt)

    def test_WORKTREES_11_head_on_no_remote_branch_exits_1(self):
        repo, _origin = self.remote()
        wt = self.throwaway(repo)
        self.commit(wt, 'feat: on no branch anywhere')
        reasons = self.assert_not_ok(repo, wt)
        self.assertTrue(any('not on origin' in r for r in reasons), reasons)

    def test_WORKTREES_12_uncommitted_change_on_origin_main_exits_1(self):
        repo, _origin = self.remote()
        wt = self.throwaway(repo)
        tracked = sorted(p.name for p in wt.iterdir() if p.suffix == '.txt')[0]
        (wt / tracked).write_text('edited, not committed\n', encoding='utf-8')
        reasons = self.assert_not_ok(repo, wt)
        self.assertTrue(any('uncommitted' in r for r in reasons), reasons)
        self.assertEqual((wt / tracked).read_text(encoding='utf-8'), 'edited, not committed\n')

    def test_WORKTREES_13_only_disposable_ignored_files_exits_0(self):
        repo, origin = self.remote()
        other = self.other_clone(origin)
        self.git(other, 'checkout', '-q', '-b', 'temper/e/b')
        (other / '.gitignore').write_text('target/\n*.log\n', encoding='utf-8')
        self.git(other, 'add', '.gitignore')
        self.git(other, 'commit', '-q', '--no-gpg-sign', '-m', 'chore: ignore build output')
        self.git(other, 'push', '-q', 'origin', 'temper/e/b')
        self.git(repo, 'fetch', '-q', 'origin')
        wt = self.throwaway(repo, commit='origin/temper/e/b')
        (wt / 'target' / 'debug').mkdir(parents=True)
        (wt / 'target' / 'debug' / 'app').write_text('bin\n', encoding='utf-8')
        (wt / 'run.log').write_text('log\n', encoding='utf-8')
        self.assert_ok(repo, wt, '--disposable', 'target/', '--disposable', '*.log')
        # Without the patterns those ignored files are not disposable.
        self.assert_not_ok(repo, wt)
        # Only some of them disposable is not enough.
        self.assert_not_ok(repo, wt, '--disposable', 'target/')
        self.assertTrue((wt / 'target' / 'debug' / 'app').exists())
        self.assertTrue((wt / 'run.log').exists())

    def test_WORKTREES_14_a_path_that_is_not_a_worktree_of_repo_exits_1(self):
        repo, origin = self.remote()
        plain = self.tmp / 'plain'
        plain.mkdir()
        self.assert_not_ok(repo, plain)
        # A directory inside the repo that is not a worktree root.
        inner = repo / 'sub'
        inner.mkdir()
        self.assert_not_ok(repo, inner)
        # A detached worktree of another clone of the same origin.
        other = self.other_clone(origin)
        foreign = self.tmp / 'foreign'
        self.git(other, 'worktree', 'add', '-q', '--detach', str(foreign), 'origin/main')
        reasons = self.assert_not_ok(repo, foreign)
        self.assertTrue(any('not a worktree of' in r for r in reasons), reasons)
        # A path that does not exist.
        self.assert_not_ok(repo, self.tmp / 'missing')

    def test_WORKTREES_15_usage_errors_and_a_non_detached_worktree_exit_1_with_a_reason(self):
        repo, _origin = self.remote()
        wt = self.throwaway(repo)
        self.git(repo, 'branch', 'temper/e/c', 'origin/main')
        attached = self.worktree(repo, 'temper/e/c', name='attached')
        cases = [
            ([str(repo), '--detached'], 1),
            ([str(repo), 'main', '--detached', '--worktree', str(wt)], 1),
        ]
        for argv, n in cases:
            code, out, raw = self.check(*argv)
            self.assertEqual(code, 1, raw)
            self.assertIs(out['ok'], False, raw)
            self.assertEqual(len(out['reasons']), n, raw)
            self.assertTrue(out['reasons'][0].strip(), raw)
        reasons = self.assert_not_ok(repo, attached)
        self.assertTrue(any('not detached' in r for r in reasons), reasons)

    def test_WORKTREES_16_exactly_one_of_branch_and_detached_branch_mode_unchanged(self):
        repo, _origin = self.remote()
        code, out, raw = self.check(str(repo))
        self.assertEqual(code, 1, raw)
        self.assertIs(out['ok'], False, raw)
        self.assertEqual(len(out['reasons']), 1, raw)
        self.assertIn('--detached', out['reasons'][0], raw)
        # Branch mode, as in v0.2: merged branch ok; unpushed branch not; a worktree is checked.
        self.git(repo, 'branch', 'temper/e/merged', 'main')
        code, out, raw = self.check(str(repo), 'temper/e/merged')
        self.assertEqual((code, out), (0, {'ok': True, 'reasons': []}), raw)
        self.feature(repo, 'temper/e/unpushed')
        code, out, raw = self.check(str(repo), 'temper/e/unpushed')
        self.assertEqual(code, 1, raw)
        self.assertTrue(out['reasons'], raw)
        wt = self.worktree(repo, 'temper/e/merged', name='merged-wt')
        code, out, raw = self.check(str(repo), 'temper/e/merged', '--worktree', str(wt))
        self.assertEqual(code, 0, raw)
        (wt / 'scratch.txt').write_text('wip\n', encoding='utf-8')
        code, out, raw = self.check(str(repo), 'temper/e/merged', '--worktree', str(wt))
        self.assertEqual(code, 1, raw)

    def test_WORKTREES_17_detached_runs_keep_the_output_shape_and_delete_nothing(self):
        repo, _origin = self.remote()
        clean = self.throwaway(repo, label='clean')
        local = self.throwaway(repo, label='local')
        self.commit(local, 'feat: local only')
        dirty = self.throwaway(repo, label='dirty')
        (dirty / 'scratch.txt').write_text('wip\n', encoding='utf-8')
        plain = self.tmp / 'plain'
        plain.mkdir()
        (plain / 'keep.txt').write_text('keep\n', encoding='utf-8')
        for wt, want in ((clean, 0), (local, 1), (dirty, 1), (plain, 1)):
            before = self.snapshot(repo, wt)
            code, out, raw = self.detached(repo, wt)  # check() asserts the shape
            self.assertEqual(code, want, raw)
            self.assertEqual(self.snapshot(repo, wt), before, f'{wt}: the check changed something')
            self.assertTrue(wt.is_dir())
        listed = self.git(repo, 'worktree', 'list', '--porcelain')
        for wt in (clean, local, dirty):
            self.assertIn(str(wt), listed)

    # ---- host_sync.py fetch --prune ----

    def _stub_ssh(self):
        """A stand-in for ssh on PATH: it drops the options and host and runs the command locally."""
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
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
            'shift\n'
            'exec sh -c "$*"\n',
            encoding='utf-8')
        stub.chmod(0o755)
        return dict(self.env, PATH=f'{bin_dir}:{self.env["PATH"]}'), None

    def _host(self):
        """The user's repo, a host clone of the same origin, and env with stub ssh and git log."""
        repo, origin = self.remote()
        self.git(repo, 'branch', '--no-track', 'epic/e', 'main')
        host_clone = self.tmp / 'host' / 'repo'
        self.git(self.tmp, 'clone', '-q', str(origin), str(host_clone))
        self.git(host_clone, 'branch', '--no-track', 'epic/e', 'origin/main')
        env, _log = self._stub_ssh()
        real_git = subprocess.run(['sh', '-c', 'command -v git'], env=self.env,
                                  capture_output=True, text=True, check=True).stdout.strip()
        gitlog = self.tmp / 'git.log'
        wrapper = self.tmp / 'bin' / 'git'
        wrapper.write_text(f'#!/bin/sh\nprintf "%s\\n" "$*" >> \'{gitlog}\'\nexec \'{real_git}\' "$@"\n',
                           encoding='utf-8')
        wrapper.chmod(0o755)
        return repo, host_clone, env, gitlog

    def sync_fetch(self, env, repo, host_clone):
        return subprocess.run([sys.executable, str(HOST_SYNC), 'fetch', str(repo), 'buildhost',
                               str(host_clone), 'epic/e', 'e'],
                              cwd=str(self.tmp), env=env, capture_output=True, text=True,
                              check=False, timeout=60)

    def host_task(self, host_clone, task, base='epic/e'):
        self.git(host_clone, 'checkout', '-q', '-b', f'temper/e/{task}', base)
        sha = self.commit(host_clone, f'feat: {task}\n\nTemper-Task: e/{task}', name=f'{task}.txt')
        self.git(host_clone, 'checkout', '-q', '--detach')
        return sha

    def test_WORKTREES_18_a_task_branch_deleted_on_the_host_loses_its_private_ref(self):
        repo, host_clone, env, gitlog = self._host()
        self.host_task(host_clone, 'a')
        self.host_task(host_clone, 'b')
        proc = self.sync_fetch(env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(self.git(repo, 'rev-parse', '--verify', 'refs/temper/host/temper/e/b'))
        self.git(host_clone, 'branch', '-D', 'temper/e/b')
        gitlog.write_text('', encoding='utf-8')
        proc = self.sync_fetch(env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        fetches = [l for l in gitlog.read_text(encoding='utf-8').splitlines()
                   if ' fetch ' in f' {l} ' and 'refs/temper/host/' in l]
        self.assertTrue(fetches, gitlog.read_text(encoding='utf-8'))
        self.assertTrue(all('--prune' in l.split() for l in fetches), fetches)
        self.assertEqual(self.git(repo, 'for-each-ref', '--format=%(refname)',
                                  'refs/temper/host/temper/e/').split(),
                         ['refs/temper/host/temper/e/a'])
        self.assertNotEqual(
            subprocess.run(['git', '-C', str(repo), 'rev-parse', '--verify', '--quiet',
                            'refs/temper/host/temper/e/b'], env=self.env,
                           capture_output=True).returncode, 0)

    def test_WORKTREES_19_prune_touches_only_this_epics_private_refs_and_never_refs_heads(self):
        repo, host_clone, env, _gitlog = self._host()
        main = self.git(repo, 'rev-parse', 'main')
        # Refs outside refs/temper/host/<branch> and refs/temper/host/temper/<epic>/.
        outside = {
            'refs/temper/host/temper/other/x': main,
            'refs/temper/host/feature/y': main,
            'refs/temper/host/temper/e-two/z': main,
            'refs/temper/keep': main,
            'refs/heads/temper/e/local-only': main,
        }
        for ref, sha in outside.items():
            self.git(repo, 'update-ref', ref, sha)
        a = self.host_task(host_clone, 'a')
        b = self.host_task(host_clone, 'b')
        proc = self.sync_fetch(env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'refs/heads/temper/e/b'), b)
        # The host deletes b; the local branch b stays, as does every ref outside the namespace.
        self.git(host_clone, 'branch', '-D', 'temper/e/b')
        proc = self.sync_fetch(env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'refs/heads/temper/e/b'), b,
                         'refs/heads/ is never pruned')
        for ref, sha in outside.items():
            self.assertEqual(self.git(repo, 'rev-parse', ref), sha, f'{ref} was touched')
        # Fast-forward-only is unchanged: a local branch with commits the host lacks, while the
        # host moved too, is refused and nothing local moves.
        self.git(repo, 'checkout', '-q', 'temper/e/a')
        mine = self.commit(repo, 'feat: local work on a', name='mine.txt')
        self.git(repo, 'checkout', '-q', 'main')
        self.git(host_clone, 'checkout', '-q', 'temper/e/a')
        self.commit(host_clone, 'feat: host work on a', name='theirs.txt')
        self.git(host_clone, 'checkout', '-q', '--detach')
        heads_before = self.git(repo, 'for-each-ref', '--format=%(refname) %(objectname)',
                                'refs/heads/')
        proc = self.sync_fetch(env, repo, host_clone)
        self.assertNotEqual(proc.returncode, 0, proc.stdout)
        self.assertEqual(self.git(repo, 'rev-parse', 'temper/e/a'), mine)
        self.assertEqual(self.git(repo, 'for-each-ref', '--format=%(refname) %(objectname)',
                                  'refs/heads/'), heads_before)
        self.assertNotEqual(mine, a)
        # A local branch ahead of the host (the head's own commit) is left as it is.
        self.git(repo, 'checkout', '-q', 'epic/e')
        ahead = self.commit(repo, 'docs: head commit', name='head.txt')
        self.git(repo, 'checkout', '-q', 'main')
        self.git(repo, 'branch', '-f', 'temper/e/a', a)
        self.git(host_clone, 'branch', '-f', 'temper/e/a', a)
        proc = self.sync_fetch(env, repo, host_clone)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git(repo, 'rev-parse', 'epic/e'), ahead)
        out = json.loads(proc.stdout)
        self.assertIn('epic/e', json.dumps(out.get('ahead')), proc.stdout)
