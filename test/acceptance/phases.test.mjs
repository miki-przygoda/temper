// Acceptance tests for the phases group (docs/temper/v0-3/behaviour.md, PHASES-01..15).
// They drive the bundled workflows/build.js and workflows/publish.js through the harness with
// scripted agents, the way the head launches them with args.json. Schemas and prompts are read
// from the agent calls the workflows make, never from src/lib.js. A test that fails because of the
// product is skipped with "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from '../harness.mjs';

const BUILD = 'workflows/build.js';
const PUBLISH = 'workflows/publish.js';
const STABILISE = 'workflows/stabilise.js';
const EPIC = 'e';
const SHA = 'abcdef1234567';

const task = (id, wave) => ({
  id, title: `Title ${id}`, wave, owns: [`src/${id}.rs`], uses: [], provides: [], text: `build ${id}`,
});

const GROUPS = [{ key: 'g1', behaviours: [{ id: 'G1-01', text: 'given x then y' }] }];

function buildArgs(extra = {}) {
  return {
    epic: EPIC,
    repo: '/r',
    branch: 'temper/e',
    base: 'main',
    spec: 'docs/temper/e/spec.md',
    plan: 'docs/temper/e/plan.md',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'QUICK-GATE-CMD', full: 'FULL-GATE-CMD' },
    tasks: [task('a', 0), task('b', 1)],
    behaviour_groups: [{ key: 'g1', title: 'Group 1' }],
    done: [],
    answers: {},
    ...extra,
  };
}

function publishArgs(extra = {}) {
  return {
    epic: EPIC,
    repo: '/r',
    branch: 'temper/e',
    base: 'main',
    log: 'docs/temper/e/log.md',
    spec: 'docs/temper/e/spec.md',
    host: { kind: 'local' },
    gates: { quick: 'QUICK-GATE-CMD', full: 'FULL-GATE-CMD' },
    done: [],
    ...extra,
  };
}

function stabiliseArgs(extra = {}) {
  return {
    epic: EPIC, repo: '/r', branch: 'temper/e', base: 'main', log: 'docs/temper/e/log.md',
    host: { kind: 'local' }, gates: { quick: 'Q', full: 'F' }, part: 'sweep', lenses: [], severity_notes: '', done: [],
    ...extra,
  };
}

const idOf = (label) => label.slice(label.indexOf(':') + 1);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Every agent succeeds unless `over` has an entry for its label. The acceptance group reports one
// failing behaviour so a to-green round runs too.
function buildResponder(over = {}) {
  return (call) => {
    const { label } = call;
    if (has(over, label)) {
      const v = over[label];
      return typeof v === 'function' ? v(call) : v;
    }
    const id = idOf(label);
    if (label.startsWith('impl:') || label.startsWith('retry:')) {
      return { status: 'done', branch: `temper/e/${id}`, commit: 'abcabc01', summary: `did ${id}` };
    }
    if (label.startsWith('check:') || label.startsWith('recheck:')) return { pass: true, problems: [] };
    if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
    if (label === 'checkpoint') {
      return { status: 'done', gate_passed: true, gate_log: 'logs/full.log', flows: [], gaps: [], commit: 'aaaaaa01' };
    }
    if (label === 'behaviour-spec') return { status: 'done', groups: GROUPS, commit: 'bbbbbb02' };
    if (label.startsWith('acceptance:')) {
      return { status: 'done', group: id, passing: [], failing: [{ id: 'G1-01', observed: 'red' }], untestable: [], commit: 'cccccc03' };
    }
    if (label.startsWith('green:')) {
      return { status: 'done', fixed: ['G1-01'], corrected: [], questions: [], still_failing: [], commit: 'dddddd04' };
    }
    return null;
  };
}

function publishResponder(over = {}) {
  return (call) => {
    const { label } = call;
    if (has(over, label)) {
      const v = over[label];
      return typeof v === 'function' ? v(call) : v;
    }
    if (label === 'docs') return { status: 'done', commit: 'eeeeee05', files: ['README.md'], summary: 'docs' };
    if (label === 'evidence') return { status: 'done', script: 's.sh', checklist: 'c.md', commit: 'ffffff06' };
    if (label === 'gate') return { passed: true, exit_status: 0, log: 'logs/full.log' };
    return null;
  };
}

const runBuild = (args, over) => runWorkflow(BUILD, { args, respond: buildResponder(over) });
const runPublish = (args, over) => runWorkflow(PUBLISH, { args, respond: publishResponder(over) });
const labels = (calls) => calls.map((c) => c.opts.label);
const callOf = (calls, label) => {
  const c = calls.find((x) => x.opts.label === label);
  assert.ok(c, `no agent call labelled ${label}; calls: ${labels(calls).join(', ')}`);
  return c;
};

// Every phase: which workflow runs it, its agent label (= phase id), and the labels that come after it.
const BUILD_PHASES = ['checkpoint', 'behaviour-spec', 'acceptance:g1', 'green:1'];
const PUBLISH_PHASES = ['docs', 'evidence'];
const PHASES = [
  ...BUILD_PHASES.map((id) => ({ id, run: (over) => runBuild(buildArgs(), over) })),
  ...PUBLISH_PHASES.map((id) => ({ id, run: (over) => runPublish(publishArgs(), over) })),
];

// A blocked result of the phase's own shape: every other required field sent empty.
const EMPTY = {
  checkpoint: { gate_passed: false, gate_log: '', flows: [], gaps: [] },
  'behaviour-spec': { groups: [], commit: '' },
  'acceptance:g1': { group: '', passing: [], failing: [], untestable: [], commit: '' },
  'green:1': { fixed: [], corrected: [], questions: [], still_failing: [] },
  docs: { commit: '', files: [], summary: '' },
  evidence: { script: '', checklist: '', commit: '' },
};
const blockedResult = (id, extra = {}) => ({ ...EMPTY[id], status: 'blocked', ...extra });

function assertStoppedAt(calls, id) {
  const ls = labels(calls);
  assert.equal(ls[ls.length - 1], id, `ran something after ${id}: ${ls.join(', ')}`);
}

// ---------------------------------------------------------------------------

test('PHASES-01 every phase schema has a required done|blocked status and an optional string reason', async () => {
  const b = await runBuild(buildArgs());
  assert.equal(b.result.status, 'mvp', JSON.stringify(b.result));
  const p = await runPublish(publishArgs());
  assert.equal(p.result.status, 'ready', JSON.stringify(p.result));
  const named = {
    CHECKPOINT_SCHEMA: callOf(b.calls, 'checkpoint'),
    BEHAVIOUR_SCHEMA: callOf(b.calls, 'behaviour-spec'),
    ACCEPTANCE_SCHEMA: callOf(b.calls, 'acceptance:g1'),
    GREEN_SCHEMA: callOf(b.calls, 'green:1'),
    DOCS_SCHEMA: callOf(p.calls, 'docs'),
    EVIDENCE_SCHEMA: callOf(p.calls, 'evidence'),
  };
  for (const [name, call] of Object.entries(named)) {
    const s = call.opts.schema;
    assert.ok(s && s.properties, `${name}: no schema`);
    assert.ok(s.required.includes('status'), `${name}: status not required`);
    assert.equal(s.properties.status.type, 'string', `${name}: status type`);
    assert.deepEqual([...s.properties.status.enum].sort(), ['blocked', 'done'], `${name}: status enum`);
    assert.ok(s.properties.reason, `${name}: no reason property`);
    assert.equal(s.properties.reason.type, 'string', `${name}: reason type`);
    assert.ok(!s.required.includes('reason'), `${name}: reason is required`);
  }
});

test('PHASES-02 a checkpoint blocked with "HEAD detached" blocks the build there', async () => {
  const { result, calls } = await runBuild(buildArgs(), { checkpoint: blockedResult('checkpoint', { reason: 'HEAD detached' }) });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blocked, [{ id: 'checkpoint', reason: 'HEAD detached' }]);
  assertStoppedAt(calls, 'checkpoint');
  for (const l of labels(calls)) assert.ok(!/^(behaviour-spec|acceptance:|green:)/.test(l), `later phase ran: ${l}`);
});

test('PHASES-03 a docs agent blocked with a reason blocks publish, never ready', async () => {
  const reason = 'docs cannot be written: README is generated';
  const { result, calls } = await runPublish(publishArgs(), { docs: blockedResult('docs', { reason }) });
  assert.equal(result.status, 'blocked');
  assert.notEqual(result.status, 'ready');
  assert.deepEqual(result.blocked, [{ id: 'docs', reason }]);
  assert.deepEqual(labels(calls), ['docs']);
});

test('PHASES-04 an evidence agent blocked with a reason blocks publish, never ready', async () => {
  const reason = 'no owner steps can be named';
  const { result, calls } = await runPublish(publishArgs(), { evidence: blockedResult('evidence', { reason }) });
  assert.equal(result.status, 'blocked');
  assert.notEqual(result.status, 'ready');
  assert.deepEqual(result.blocked, [{ id: 'evidence', reason }]);
  assert.deepEqual(labels(calls), ['docs', 'evidence']);
});

test('PHASES-05 a phase status other than done with no reason blocks with "phase returned status <status>"', async () => {
  for (const { id, run } of PHASES) {
    for (const status of ['blocked', 'weird']) {
      const r = { ...EMPTY[id], status };
      if (id === 'checkpoint') r.gate_passed = true;
      const { result, calls } = await run({ [id]: r });
      assert.equal(result.status, 'blocked', `${id}/${status}: ${JSON.stringify(result)}`);
      assert.deepEqual(result.blocked, [{ id, reason: 'phase returned status ' + status }], `${id}/${status}`);
      assertStoppedAt(calls, id);
    }
  }
});

test('PHASES-06 a phase agent returning null blocks with "agent returned nothing"', async () => {
  for (const { id, run } of PHASES) {
    const { result, calls } = await run({ [id]: null });
    assert.equal(result.status, 'blocked', `${id}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.blocked, [{ id, reason: 'agent returned nothing' }], id);
    assertStoppedAt(calls, id);
  }
});

test('PHASES-07 a blocked phase that reports a sha commit has it recorded, and is still blocked', async () => {
  for (const { id, run } of PHASES) {
    const { result } = await run({ [id]: blockedResult(id, { reason: 'stuck', commit: SHA }) });
    assert.equal(result.status, 'blocked', id);
    assert.deepEqual(result.blocked, [{ id, reason: 'stuck' }], id);
    assert.equal(result.commits[id], SHA, `${id}: commits ${JSON.stringify(result.commits)}`);
  }
});

test('PHASES-08 a blocked phase whose commit is not a sha has exactly one blocked entry, the agent\'s', async () => {
  for (const { id, run } of PHASES) {
    for (const commit of ['', 'not a sha; rm -rf /']) {
      const { result } = await run({ [id]: blockedResult(id, { reason: 'stuck', commit }) });
      assert.equal(result.status, 'blocked', `${id}/${commit}`);
      assert.deepEqual(result.blocked, [{ id, reason: 'stuck' }], `${id}/${JSON.stringify(commit)}`);
      assert.ok(!result.blocked.some((e) => e.reason === 'commit is not a sha'), id);
      assert.ok(!(id in result.commits), `${id}: a non-sha was recorded`);
    }
  }
});

test('PHASES-09 a done checkpoint whose gate did not pass blocks the build', async () => {
  for (const gate_passed of [false, undefined]) {
    const cp = { status: 'done', gate_log: 'logs/full.log', flows: [], gaps: [] };
    if (gate_passed !== undefined) cp.gate_passed = gate_passed;
    const { result, calls } = await runBuild(buildArgs(), { checkpoint: cp });
    assert.equal(result.status, 'blocked', JSON.stringify(result));
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].id, 'checkpoint');
    assert.match(result.blocked[0].reason, /logs\/full\.log/);
    assertStoppedAt(calls, 'checkpoint');
  }
});

test('PHASES-10 every phase prompt\'s return lines say a blocked agent sends its other required fields empty', async () => {
  const b = await runBuild(buildArgs());
  const p = await runPublish(publishArgs());
  const prompts = {
    ...Object.fromEntries(BUILD_PHASES.map((id) => [id, callOf(b.calls, id).prompt])),
    ...Object.fromEntries(PUBLISH_PHASES.map((id) => [id, callOf(p.calls, id).prompt])),
  };
  for (const [id, prompt] of Object.entries(prompts)) {
    const lines = prompt.split('\n');
    const ret = lines.findLastIndex((l) => /^Return /.test(l.trim()));
    assert.ok(ret >= 0, `${id}: no Return line`);
    // The return instructions: the Return line and the paragraph just before it.
    const before = lines.slice(0, ret).filter((l) => l.trim() !== '');
    const text = `${before[before.length - 1]}\n${lines[ret]}`;
    assert.match(text, /return status "blocked"/, `${id}: ${text}`);
    assert.match(text, /reason/, `${id}: ${text}`);
    assert.match(text, /every other required field empty/, `${id}: ${text}`);
    assert.ok(text.includes('("" or [])'), `${id}: ${text}`);
  }
});

test('PHASES-11 the checkpoint prompt commits with the trailer only on a green gate, and blocks with the gate log on red', async () => {
  const { calls } = await runBuild(buildArgs());
  const prompt = callOf(calls, 'checkpoint').prompt;
  const commitLine = prompt.split('\n').find((l) => l.includes('Temper-Task: e/checkpoint'));
  assert.ok(commitLine, `no trailer line:\n${prompt}`);
  assert.match(commitLine, /Only when the full gate passed/);
  assert.match(commitLine, /commit it/);
  assert.match(prompt, /When the full gate failed: commit nothing, and return status "blocked" with the gate log in reason\./);
});

test('PHASES-12 build args with no attempt or an integer attempt >= 0 are accepted, missing counts as 0', async () => {
  for (const attempt of [undefined, 0, 1, 7]) {
    const a = buildArgs();
    if (attempt !== undefined) a.attempt = attempt;
    const { result } = await runBuild(a);
    assert.notEqual(result.status, 'invalid', `attempt ${attempt}: ${result.errors}`);
    assert.equal(result.status, 'mvp');
  }
  const missing = await runBuild(buildArgs());
  const zero = await runBuild(buildArgs({ attempt: 0 }));
  assert.match(callOf(missing.calls, 'checkpoint').prompt, /Run attempt 0\.$/);
  assert.equal(callOf(missing.calls, 'checkpoint').prompt, callOf(zero.calls, 'checkpoint').prompt);
});

test('PHASES-13 build args with an attempt not an integer >= 0 are rejected, as stabilise rejects them', async () => {
  for (const attempt of [-1, 1.5, '1', null, Number.NaN, true]) {
    const { result, calls } = await runBuild(buildArgs({ attempt }));
    assert.equal(result.status, 'invalid', `attempt ${String(attempt)}`);
    assert.equal(calls.length, 0, `attempt ${String(attempt)}: an agent ran`);
    assert.ok(result.errors.some((e) => /attempt/.test(e)), `attempt ${String(attempt)}: ${result.errors}`);
    const s = await runWorkflow(STABILISE, { args: stabiliseArgs({ attempt }), respond: () => null });
    assert.equal(s.result.status, 'invalid', `stabilise attempt ${String(attempt)}`);
    const msg = (es) => es.filter((e) => /attempt/.test(e));
    assert.deepEqual(msg(result.errors), msg(s.result.errors), 'build rejects attempt as stabilise does');
  }
});

test('PHASES-14 the checkpoint and every later phase prompt end with "Run attempt <n>."; task prompts do not', async () => {
  const { result, calls } = await runBuild(buildArgs({ attempt: 4 }));
  assert.equal(result.status, 'mvp');
  for (const id of BUILD_PHASES) assert.match(callOf(calls, id).prompt, /Run attempt 4\.$/, id);
  const tasky = calls.filter((c) => /^(impl|check|retry|recheck|merge):/.test(c.opts.label));
  assert.ok(tasky.length > 0);
  for (const c of tasky) assert.ok(!/Run attempt/.test(c.prompt), `${c.opts.label} carries the attempt`);
});

test('PHASES-15 a resume after a red checkpoint with attempt bumped reruns the checkpoint live and skips finished phases', async () => {
  const red = blockedResult('checkpoint', { reason: 'full gate failed: logs/full.log' });
  const first = await runBuild(buildArgs({ attempt: 0 }), { checkpoint: red });
  assert.equal(first.result.status, 'blocked');
  assert.deepEqual(first.result.blocked, [{ id: 'checkpoint', reason: 'full gate failed: logs/full.log' }]);
  assert.deepEqual([...first.result.done_now].sort(), ['a', 'b']);

  const second = await runBuild(buildArgs({ attempt: 1, done: first.result.done_now }));
  const ls = labels(second.calls);
  assert.ok(!ls.some((l) => /^(impl|check|retry|recheck|merge):/.test(l)), `finished tasks reran: ${ls.join(', ')}`);
  assert.equal(ls[0], 'checkpoint');
  assert.notEqual(callOf(second.calls, 'checkpoint').prompt, callOf(first.calls, 'checkpoint').prompt);
  assert.equal(second.result.status, 'mvp');

  // A later resume skips the checkpoint and behaviour spec through done, and still bumps the rest.
  const third = await runBuild(buildArgs({ attempt: 2, done: ['a', 'b', 'checkpoint', 'behaviour-spec'], behaviour: GROUPS }));
  const l3 = labels(third.calls);
  assert.ok(!l3.includes('checkpoint') && !l3.includes('behaviour-spec'), l3.join(', '));
  assert.equal(l3[0], 'acceptance:g1');
});
