import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from './harness.mjs';

const WF = 'workflows/build.js';

const taskA = { id: 'a', title: 'A', wave: 0, owns: ['src/a.rs'], uses: [], provides: ['A'], text: 'do a' };
const taskB = { id: 'b', title: 'B', wave: 1, owns: ['src/b.rs'], uses: ['A'], provides: [], text: 'do b' };

const GROUPS = [
  { key: 'g1', behaviours: [{ id: 'G1-01', text: 'given x when y then z' }, { id: 'G1-02', text: 'given p then q' }] },
  { key: 'g2', behaviours: [{ id: 'G2-01', text: 'given m then n' }] },
];

function buildArgs(extra = {}) {
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
    tasks: [taskA, taskB],
    behaviour_groups: [{ key: 'g1', title: 'Group 1' }, { key: 'g2', title: 'Group 2' }],
    done: [],
    answers: {},
    ...extra,
  };
}

const passingOf = (key) => GROUPS.find((g) => g.key === key).behaviours.map((b) => b.id);

// Answers every label with success, unless `over` has an entry for it (a value, or a function of the call).
function responder(over = {}) {
  return (call) => {
    const { label } = call;
    if (Object.prototype.hasOwnProperty.call(over, label)) {
      const v = over[label];
      return typeof v === 'function' ? v(call) : v;
    }
    const id = label.slice(label.indexOf(':') + 1);
    if (label.startsWith('impl:') || label.startsWith('retry:')) {
      return { status: 'done', branch: `temper/e/${id}`, commit: 'abcabc01', summary: `did ${id}` };
    }
    if (label.startsWith('check:') || label.startsWith('recheck:')) return { status: 'done', pass: true, problems: [] };
    if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
    if (label === 'checkpoint') {
      return { status: 'done', gate_passed: true, gate_log: 'logs/full.log', flows: [{ flow: 'f1', result: 'ok', evidence: 'ran' }], gaps: [] };
    }
    if (label === 'behaviour-spec') return { status: 'done', groups: GROUPS, commit: 'bbbbbb02' };
    if (label.startsWith('acceptance:')) {
      return { status: 'done', group: id, passing: passingOf(id), failing: [], untestable: [], commit: 'cccccc03' };
    }
    if (label.startsWith('green:')) return { status: 'done', fixed: [], corrected: [], questions: [], still_failing: [] };
    return null;
  };
}

const labels = (calls) => calls.map((c) => c.opts.label);
const afterMerges = (calls) => {
  const ls = labels(calls);
  return ls.slice(ls.lastIndexOf('merge:wave1') + 1);
};

// g1 fails G1-01 in acceptance; G1-02 passes.
const g1Fails = {
  'acceptance:g1': { status: 'done', group: 'g1', passing: ['G1-02'], failing: [{ id: 'G1-01', observed: 'exit 2' }], untestable: [], commit: 'cccccc03' },
};

test('everything passes: checkpoint, behaviour spec, one acceptance agent per group, no green round', async () => {
  const { result, calls, phases } = await runWorkflow(WF, { args: buildArgs(), respond: responder() });
  assert.deepEqual(afterMerges(calls), ['checkpoint', 'behaviour-spec', 'acceptance:g1', 'acceptance:g2']);
  assert.ok(!labels(calls).some((l) => l.startsWith('green:')));
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.acceptance, { passing: 3, failing: [], untestable: [] });
  assert.deepEqual(result.green, { rounds: 0, fixed: [], corrected: [] });
  assert.deepEqual(result.questions, []);
  assert.deepEqual(result.done_now, ['a', 'b']);
  assert.equal(result.checkpoint.gate_passed, true);
  assert.deepEqual(phases, ['Waves', 'Checkpoint', 'Behaviour']);
});

test('the phase agents get their schemas, phases and the behaviours of their group', async () => {
  const { calls } = await runWorkflow(WF, { args: buildArgs(), respond: responder(g1Fails) });
  const byLabel = (l) => calls.find((c) => c.opts.label === l);
  assert.ok(byLabel('checkpoint').opts.schema.properties.gate_passed);
  assert.equal(byLabel('checkpoint').opts.phase, 'Checkpoint');
  assert.ok(byLabel('behaviour-spec').opts.schema.properties.groups);
  assert.equal(byLabel('behaviour-spec').opts.phase, 'Behaviour');
  const g2 = byLabel('acceptance:g2');
  assert.ok(g2.opts.schema.properties.untestable);
  assert.equal(g2.opts.phase, 'Behaviour');
  assert.match(g2.prompt, /G2-01/);
  assert.doesNotMatch(g2.prompt, /G1-01/);
  const green = byLabel('green:1');
  assert.ok(green.opts.schema.properties.still_failing);
  assert.equal(green.opts.phase, 'Green');
  assert.match(green.prompt, /G1-01/);
  assert.match(green.prompt, /round 1/);
});

test('a failure still failing after two green rounds becomes a question, with exactly 2 green calls', async () => {
  const stuck = { status: 'done', fixed: [], corrected: [], questions: [], still_failing: ['G1-01'] };
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs(),
    respond: responder({ ...g1Fails, 'green:1': stuck, 'green:2': stuck }),
  });
  assert.deepEqual(labels(calls).filter((l) => l.startsWith('green:')), ['green:1', 'green:2']);
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.questions, [{ id: 'G1-01', question: 'still failing after 2 rounds' }]);
  assert.equal(result.green.rounds, 2);
  assert.deepEqual(result.acceptance, { passing: 2, failing: ['G1-01'], untestable: [] });
  const second = calls.find((c) => c.opts.label === 'green:2');
  assert.match(second.prompt, /G1-01/);
  assert.match(second.prompt, /round 2/);
});

test('a green round that leaves nothing failing ends the rounds', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs(),
    respond: responder({ ...g1Fails, 'green:1': { status: 'done', fixed: ['G1-01'], corrected: [], questions: [], still_failing: [] } }),
  });
  assert.deepEqual(labels(calls).filter((l) => l.startsWith('green:')), ['green:1']);
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.green, { rounds: 1, fixed: ['G1-01'], corrected: [] });
  assert.deepEqual(result.questions, []);
});

test('green questions are collected, and a questioned id is not retried', async () => {
  const twoFail = {
    'acceptance:g1': {
      status: 'done',
      group: 'g1', passing: [], untestable: [{ id: 'G1-02', reason: 'needs a GPU' }], commit: 'c0c0c0c1',
      failing: [{ id: 'G1-01', observed: 'o1' }, { id: 'G1-02', observed: 'o2' }],
    },
    'green:1': {
      status: 'done',
      fixed: [], corrected: ['G1-02'], questions: [{ id: 'G1-01', question: 'which exit code?' }], still_failing: ['G1-01'],
    },
  };
  const { result, calls } = await runWorkflow(WF, { args: buildArgs(), respond: responder(twoFail) });
  assert.deepEqual(labels(calls).filter((l) => l.startsWith('green:')), ['green:1']);
  assert.deepEqual(result.questions, [{ id: 'G1-01', question: 'which exit code?' }]);
  assert.deepEqual(result.green, { rounds: 1, fixed: [], corrected: ['G1-02'] });
  assert.deepEqual(result.acceptance.untestable, [{ id: 'G1-02', reason: 'needs a GPU' }]);
});

test('done checkpoint and behaviour-spec are skipped when args.behaviour is given', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs({ done: ['a', 'b', 'checkpoint', 'behaviour-spec'], behaviour: GROUPS }),
    respond: responder(),
  });
  const ls = labels(calls);
  assert.ok(!ls.includes('checkpoint'));
  assert.ok(!ls.includes('behaviour-spec'));
  assert.deepEqual(ls, ['acceptance:g1', 'acceptance:g2']);
  assert.match(calls[0].prompt, /G1-01/);
  assert.equal(result.status, 'mvp');
});

test('done acceptance groups are skipped', async () => {
  const { calls } = await runWorkflow(WF, {
    args: buildArgs({ done: ['a', 'b', 'checkpoint', 'behaviour-spec', 'acceptance:g1'], behaviour: GROUPS }),
    respond: responder(),
  });
  assert.deepEqual(labels(calls).filter((l) => l.startsWith('acceptance:')), ['acceptance:g2']);
});

test('behaviour-spec done without args.behaviour is blocked', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs({ done: ['behaviour-spec'] }),
    respond: responder(),
  });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blocked, [{ id: 'behaviour-spec', reason: 'done but args.behaviour missing' }]);
  assert.ok(!labels(calls).includes('behaviour-spec'));
  assert.ok(!labels(calls).some((l) => l.startsWith('acceptance:')));
});

test('a checkpoint whose full gate failed blocks the run before the behaviour spec', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs(),
    respond: responder({ checkpoint: { status: 'done', gate_passed: false, gate_log: 'logs/full.log', flows: [], gaps: [] } }),
  });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blocked, [{ id: 'checkpoint', reason: 'full gate failed: logs/full.log' }]);
  assert.ok(!labels(calls).includes('behaviour-spec'));
  assert.deepEqual(result.done_now, ['a', 'b']);
});

test('a phase agent that returns nothing is blocked, never done (Review Focus 1)', async () => {
  for (const [label, over] of [
    ['checkpoint', { checkpoint: null }],
    ['behaviour-spec', { 'behaviour-spec': null }],
    ['acceptance:g1', { 'acceptance:g1': null }],
    ['green:1', { ...g1Fails, 'green:1': null }],
  ]) {
    const { result, calls } = await runWorkflow(WF, { args: buildArgs(), respond: responder(over) });
    assert.equal(result.status, 'blocked', label);
    assert.deepEqual(result.blocked, [{ id: label, reason: 'agent returned nothing' }], label);
    assert.equal(labels(calls).at(-1), label, `nothing runs after ${label}`);
  }
});

// CONTROL-FLOW-1: a resume whose acceptance groups are in args.done doesn't know their failures,
// so to-green still runs and takes every test still marked acceptance-failing.
test('a resume with its acceptance groups done still runs to-green over the marked failing tests', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs({ done: ['a', 'b', 'checkpoint', 'behaviour-spec', 'acceptance:g1', 'acceptance:g2'], behaviour: GROUPS }),
    respond: responder({ 'green:1': { status: 'done', fixed: ['G1-01'], corrected: [], questions: [], still_failing: [] } }),
  });
  assert.deepEqual(labels(calls), ['green:1']);
  assert.match(calls[0].prompt, /acceptance-failing: <id>/);
  assert.match(calls[0].prompt, /earlier run/);
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.green, { rounds: 1, fixed: ['G1-01'], corrected: [] });
});

test('a resume with one acceptance group done sends the live failures and the marked ones to to-green', async () => {
  const stuck = { status: 'done', fixed: [], corrected: [], questions: [], still_failing: ['G1-01'] };
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs({ done: ['a', 'b', 'checkpoint', 'behaviour-spec', 'acceptance:g1'], behaviour: GROUPS }),
    respond: responder({
      'acceptance:g2': { status: 'done', group: 'g2', passing: [], failing: [{ id: 'G2-01', observed: 'exit 1' }], untestable: [], commit: 'c0c0c0c1' },
      'green:1': stuck,
      'green:2': stuck,
    }),
  });
  assert.deepEqual(labels(calls), ['acceptance:g2', 'green:1', 'green:2']);
  const first = calls.find((c) => c.opts.label === 'green:1');
  assert.match(first.prompt, /G2-01/);
  assert.match(first.prompt, /acceptance-failing: <id>/);
  assert.match(calls.find((c) => c.opts.label === 'green:2').prompt, /G1-01/);
  assert.deepEqual(result.questions, [{ id: 'G1-01', question: 'still failing after 2 rounds' }]);
});

test('a run that ran every acceptance group itself does not ask to-green for marked tests', async () => {
  const { calls } = await runWorkflow(WF, { args: buildArgs(), respond: responder(g1Fails) });
  assert.doesNotMatch(calls.find((c) => c.opts.label === 'green:1').prompt, /earlier run/);
});

// TESTS-DOCS-3: a resume after green:1 is done, with round 2 still needed, still runs round 2
// over the tests marked acceptance-failing, and a test still failing becomes a question.
test('a resume with the acceptance groups and green:1 done still runs green:2 over the marked failing tests', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs({ done: ['a', 'b', 'checkpoint', 'behaviour-spec', 'acceptance:g1', 'acceptance:g2', 'green:1'], behaviour: GROUPS }),
    respond: responder({ 'green:2': { status: 'done', fixed: [], corrected: [], questions: [], still_failing: ['G1-02'] } }),
  });
  assert.deepEqual(labels(calls), ['green:2']);
  assert.match(calls[0].prompt, /acceptance-failing: <id>/);
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.questions, [{ id: 'G1-02', question: 'still failing after 2 rounds' }]);
});
