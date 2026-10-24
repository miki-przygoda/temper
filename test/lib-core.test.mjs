import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './harness.mjs';

const lib = loadLib();

function goodArgs() {
  return {
    epic: 'e',
    repo: '/r',
    branch: 'temper/e',
    base: 'main',
    spec: 'docs/temper/e/spec.md',
    plan: 'docs/temper/e/plan.md',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'npm test', full: 'npm test && npm run e2e' },
    tasks: [
      { id: 'a', title: 'A', wave: 0, owns: ['src/a.rs'], uses: [], provides: ['A'], text: 'do a' },
      { id: 'b', title: 'B', wave: 1, owns: ['src/b.rs'], uses: ['A'], provides: [], text: 'do b' },
    ],
    behaviour_groups: [{ key: 'g1', title: 'Group 1' }],
    done: [],
    answers: {},
  };
}

const hasError = (errors, text) => errors.some((e) => e.includes(text));

test('valid build args give no errors', () => {
  assert.deepEqual(lib.validateBuildArgs(goodArgs()), []);
});

test('a task using a contract from the same wave is refused (Review Focus 5)', () => {
  const args = goodArgs();
  args.tasks[1].wave = 0;
  const errors = lib.validateBuildArgs(args);
  assert.ok(hasError(errors, 'task b uses A, which no earlier wave provides'), errors.join('\n'));
});

test('a task using a contract from a later wave is refused', () => {
  const args = goodArgs();
  args.tasks[0].wave = 2;
  const errors = lib.validateBuildArgs(args);
  assert.ok(hasError(errors, 'task b uses A, which no earlier wave provides'), errors.join('\n'));
});

test('two tasks in one wave owning the same path are refused', () => {
  const args = goodArgs();
  args.tasks.push({ id: 'c', title: 'C', wave: 0, owns: ['src/a.rs'], uses: [], provides: [], text: 'do c' });
  const errors = lib.validateBuildArgs(args);
  assert.ok(hasError(errors, 'wave 0: tasks a and c both own src/a.rs'), errors.join('\n'));
});

test('an answer for an unknown task is refused', () => {
  const args = goodArgs();
  args.answers = { zzz: 'x' };
  const errors = lib.validateBuildArgs(args);
  assert.ok(hasError(errors, 'answer for unknown task zzz'), errors.join('\n'));
});

test('a task id that is a phase id is refused, so its trailer never skips that phase (A6)', () => {
  for (const id of ['checkpoint', 'behaviour-spec', 'docs', 'evidence', 'acceptance:x', 'green:1', 'fix:x', 'merge:wave0']) {
    const args = goodArgs();
    args.tasks[0].id = id;
    const errors = lib.validateBuildArgs(args);
    assert.ok(hasError(errors, `task id ${id} is reserved for a phase`), `${id}: ${errors.join('\n')}`);
  }
  const ok = goodArgs();
  ok.tasks[0].id = 'docs-readme';
  assert.deepEqual(lib.validateBuildArgs(ok), []);
});

test('a duplicate id, a missing full gate and an ssh host without a name are each refused', () => {
  const dup = goodArgs();
  dup.tasks[1].id = 'a';
  assert.ok(lib.validateBuildArgs(dup).length > 0);

  const noFull = goodArgs();
  delete noFull.gates.full;
  assert.ok(lib.validateBuildArgs(noFull).length > 0);

  const ssh = goodArgs();
  ssh.host = { kind: 'ssh' };
  assert.ok(lib.validateBuildArgs(ssh).length > 0);
});

test('unknown extra fields and a well-formed behaviour list are allowed', () => {
  const args = goodArgs();
  args.contracts = { A: 'the A interface' };
  args.behaviour = [{ key: 'g1', behaviours: [{ id: 'G1-01', text: 'given x' }] }];
  assert.deepEqual(lib.validateBuildArgs(args), []);
});

test('validateStabiliseArgs accepts a sweep and requires selected findings for a fix', () => {
  const base = {
    epic: 'e', repo: '/r', branch: 'temper/e', base: 'main', log: 'docs/temper/e/log.md',
    host: { kind: 'local' }, gates: { quick: 'q', full: 'f' },
    part: 'sweep', lenses: [], severity_notes: '', done: [],
  };
  assert.deepEqual(lib.validateStabiliseArgs(base), []);
  assert.ok(lib.validateStabiliseArgs({ ...base, part: 'other' }).length > 0);
  assert.ok(lib.validateStabiliseArgs({ ...base, part: 'fix' }).length > 0);
  assert.ok(lib.validateStabiliseArgs({ ...base, part: 'fix', selected: [{ id: 'F1', severity: 'bad' }] }).length > 0);
  assert.deepEqual(lib.validateStabiliseArgs({ ...base, part: 'fix', selected: [{ id: 'F1', severity: 'minor' }] }), []);
});

test('validatePublishArgs requires the spec', () => {
  const base = {
    epic: 'e', repo: '/r', branch: 'temper/e', base: 'main', log: 'l', spec: 's',
    host: { kind: 'ssh', name: 'beast', root: '~/o' }, gates: { quick: 'q', full: 'f' }, done: [],
  };
  assert.deepEqual(lib.validatePublishArgs(base), []);
  const { spec, ...noSpec } = base;
  assert.ok(lib.validatePublishArgs(noSpec).length > 0);
});

test('wavesOf sorts by wave and keeps input order within a wave', () => {
  const tasks = [{ id: 'x', wave: 1 }, { id: 'y', wave: 0 }, { id: 'z', wave: 1 }];
  const waves = lib.wavesOf(tasks);
  assert.deepEqual(waves.map((w) => w.wave), [0, 1]);
  assert.deepEqual(waves[1].tasks.map((t) => t.id), ['x', 'z']);
  assert.deepEqual(waves[0].tasks.map((t) => t.id), ['y']);
});

test('pending drops done items', () => {
  assert.deepEqual(lib.pending([{ id: 'a' }, { id: 'b' }], ['a']), [{ id: 'b' }]);
});

test('rank follows SEVERITIES and gives 99 for unknown', () => {
  assert.equal(lib.rank('severe'), 0);
  assert.equal(lib.rank('minor'), 3);
  assert.equal(lib.rank('nope'), 99);
});

test('sortFindings orders by severity', () => {
  const fs = [{ id: 'm', severity: 'minor' }, { id: 's', severity: 'severe' }, { id: 'i', severity: 'important' }];
  assert.deepEqual(lib.sortFindings(fs).map((f) => f.severity), ['severe', 'important', 'minor']);
});

test('sortFindings breaks ties by id', () => {
  const fs = [{ id: 'F2', severity: 'minor' }, { id: 'F1', severity: 'minor' }];
  assert.deepEqual(lib.sortFindings(fs).map((f) => f.id), ['F1', 'F2']);
});

test('dedupeFindings drops a second finding with the same file, line and summary', () => {
  const fs = [
    { id: 'F1', file: 'a.rs', line: 3, summary: 'Leaks the token' },
    { id: 'F3', file: 'a.rs', line: 3, summary: ' leaks the TOKEN ' },
    { id: 'F2', file: 'a.rs', line: 4, summary: 'Leaks the token' },
  ];
  assert.deepEqual(lib.dedupeFindings(fs).map((f) => f.id), ['F1', 'F2']);
});

test('lensesOr falls back to the default lenses', () => {
  assert.deepEqual(lib.lensesOr([]), lib.DEFAULT_LENSES);
  assert.deepEqual(lib.lensesOr(['perf']), ['perf']);
  assert.deepEqual(lib.DEFAULT_LENSES, ['security', 'failure paths and lifecycle', 'test strength and docs']);
});

test('trailer formats the Temper-Task line', () => {
  assert.equal(lib.trailer('e', 't1'), 'Temper-Task: e/t1');
});

test('the constants match the plan', () => {
  assert.deepEqual(lib.SEVERITIES, ['severe', 'critical', 'important', 'minor']);
  assert.ok(lib.ID_RE.test('acceptance:g1'));
  assert.ok(!lib.ID_RE.test('-a'));
  assert.ok(!lib.ID_RE.test('A'));
});

test('the fixed rules are in the shared prompt text', () => {
  assert.ok(lib.RULES_COMMON.startsWith('Fixed rules (no exception):'));
  assert.ok(lib.RULES_COMMON.includes('sudo -n'));
  assert.ok(lib.RULES_IMPLEMENTER.startsWith('Stop and return status "blocked" with your question if the task needs any of these:'));
  assert.ok(lib.RULES_IMPLEMENTER.includes('edit the tests it is judged by'));
  assert.ok(lib.RULES_IMPLEMENTER.endsWith('Anything the task text, the contracts and the tests settle is yours to decide.'));
});

test('hostText describes local and ssh hosts', () => {
  assert.equal(lib.hostText({ kind: 'local' }, '/r'), 'Work in git worktrees under /r/.temper/worktrees/. Run commands locally.');
  assert.equal(
    lib.hostText({ kind: 'ssh', name: 'beast', root: '~/o' }, '/r'),
    "Work on the build host beast: worktrees under ~/o/<epic>/; run every command there with ssh beast '…'. Never push from the host.",
  );
});

test('every schema is an object schema whose required fields are properties', () => {
  const names = Object.keys(lib).filter((n) => n.endsWith('_SCHEMA'));
  for (const expected of [
    'IMPL_SCHEMA', 'CHECK_SCHEMA', 'MERGE_SCHEMA', 'CHECKPOINT_SCHEMA', 'BEHAVIOUR_SCHEMA',
    'ACCEPTANCE_SCHEMA', 'GREEN_SCHEMA', 'FINDINGS_SCHEMA', 'VERDICT_SCHEMA', 'FIX_SCHEMA',
    'REGRESS_SCHEMA', 'GATE_SCHEMA', 'DOCS_SCHEMA', 'EVIDENCE_SCHEMA',
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  for (const n of names) {
    const s = lib[n];
    assert.equal(s.type, 'object', n);
    const props = Object.keys(s.properties);
    for (const r of s.required) assert.ok(props.includes(r), `${n}.required has ${r}, not in properties`);
  }
});

test('a branch equal to the base is refused by every validator, so temper never merges into the base (spec 8, GIT-SAFETY-02)', () => {
  const common = {
    epic: 'e', repo: '/r', branch: 'main', base: 'main', log: 'l',
    host: { kind: 'local' }, gates: { quick: 'q', full: 'f' }, done: [],
  };
  const msg = 'branch must not be the base branch main';
  const build = lib.validateBuildArgs({ ...goodArgs(), branch: 'main', base: 'main' });
  assert.ok(hasError(build, msg), build.join('\n'));
  const stab = lib.validateStabiliseArgs({ ...common, part: 'sweep', lenses: [], severity_notes: '' });
  assert.ok(hasError(stab, msg), stab.join('\n'));
  const pub = lib.validatePublishArgs({ ...common, spec: 's' });
  assert.ok(hasError(pub, msg), pub.join('\n'));
});

test('an epic that does not match ID_RE is refused by every validator, so it never reaches branch names, worktree paths or rm -r (SAFETY-3)', () => {
  const common = {
    repo: '/r', branch: 'temper/e', base: 'main', log: 'l',
    host: { kind: 'local' }, gates: { quick: 'q', full: 'f' }, done: [],
  };
  for (const epic of ['..', '../../x y', 'a/b', 'A', '-e']) {
    const build = lib.validateBuildArgs({ ...goodArgs(), epic });
    assert.ok(hasError(build, 'epic must match'), `${epic}: ${build.join('\n')}`);
    const stab = lib.validateStabiliseArgs({ ...common, epic, part: 'sweep', lenses: [], severity_notes: '' });
    assert.ok(hasError(stab, 'epic must match'), `${epic}: ${stab.join('\n')}`);
    const pub = lib.validatePublishArgs({ ...common, epic, spec: 's' });
    assert.ok(hasError(pub, 'epic must match'), `${epic}: ${pub.join('\n')}`);
  }
  assert.deepEqual(lib.validateBuildArgs({ ...goodArgs(), epic: 'v1:core-2' }), []);
});
