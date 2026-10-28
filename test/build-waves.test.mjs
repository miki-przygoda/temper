import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from './harness.mjs';

const WF = 'workflows/build.js';

const taskA = { id: 'a', title: 'A', wave: 0, owns: ['src/a.rs'], uses: [], provides: ['A'], text: 'do a' };
const taskC = { id: 'c', title: 'C', wave: 0, owns: ['src/c.rs'], uses: [], provides: [], text: 'do c' };
const taskB = { id: 'b', title: 'B', wave: 1, owns: ['src/b.rs'], uses: ['A'], provides: [], text: 'do b' };

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
    tasks: [taskA, taskC, taskB],
    behaviour_groups: [{ key: 'g1', title: 'Group 1' }],
    done: [],
    answers: {},
    ...extra,
  };
}

// A respond that answers every label with success, unless `over` has an entry for it.
// An entry is a value, or a function of the call (for replies that change between calls).
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
    if (label.startsWith('check:') || label.startsWith('recheck:')) return { pass: true, problems: [] };
    if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
    // The phases after the waves (Task 6) succeed with nothing failing.
    if (label === 'checkpoint') return { gate_passed: true, gate_log: 'logs/full.log', flows: [], gaps: [] };
    if (label === 'behaviour-spec') return { groups: [{ key: 'g1', behaviours: [{ id: 'G1-01', text: 't' }] }], commit: 'bbbbbb02' };
    if (label.startsWith('acceptance:')) return { group: id, passing: ['G1-01'], failing: [], untestable: [], commit: 'cccccc03' };
    if (label.startsWith('green:')) return { fixed: [], corrected: [], questions: [], still_failing: [] };
    return null;
  };
}

const labels = (calls) => calls.map((c) => c.opts.label);

test('invalid args return status invalid and call no agent', async () => {
  const { result, calls } = await runWorkflow(WF, { args: buildArgs({ tasks: [] }), respond: responder() });
  assert.equal(result.status, 'invalid');
  assert.ok(result.errors.length > 0);
  assert.equal(calls.length, 0);
});

test('a task id of epic is refused before any agent, so impl:epic never gets the shared epic worktree path (spec 3.1)', async () => {
  const epicTask = { ...taskA, id: 'epic' };
  const { result, calls } = await runWorkflow(WF, { args: buildArgs({ tasks: [epicTask] }), respond: responder() });
  assert.equal(result.status, 'invalid');
  assert.ok(result.errors.some((e) => e.includes('task id epic is reserved for the shared epic worktree')), result.errors.join('\n'));
  assert.equal(calls.length, 0);
});

test('two waves run implement, check and merge in order', async () => {
  const { result, calls } = await runWorkflow(WF, { args: buildArgs(), respond: responder() });
  assert.deepEqual(labels(calls).slice(0, 8), [
    'impl:a', 'check:a', 'impl:c', 'check:c', 'merge:wave0',
    'impl:b', 'check:b', 'merge:wave1',
  ]);
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.done_now, ['a', 'c', 'b']);
});

test('agents get the schemas and the Waves phase', async () => {
  const { calls } = await runWorkflow(WF, { args: buildArgs(), respond: responder() });
  for (const c of calls) {
    if (/^(impl|check|retry|recheck|merge):/.test(c.opts.label)) assert.equal(c.opts.phase, 'Waves', c.opts.label);
    assert.equal(c.opts.schema?.type, 'object', c.opts.label);
  }
  const impl = calls.find((c) => c.opts.label === 'impl:a');
  assert.ok(impl.opts.schema.properties.status);
  const merge = calls.find((c) => c.opts.label === 'merge:wave0');
  assert.ok(merge.opts.schema.properties.gate_passed);
});

test('tasks in done are skipped', async () => {
  const { result, calls } = await runWorkflow(WF, { args: buildArgs({ done: ['a'] }), respond: responder() });
  assert.ok(!labels(calls).includes('impl:a'));
  assert.ok(!labels(calls).includes('check:a'));
  assert.ok(labels(calls).includes('impl:c'));
  assert.deepEqual(result.done_now, ['c', 'b']);
});

test('a check that fails once gets exactly one retry and one recheck', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs(),
    respond: responder({ 'check:a': { pass: false, problems: ['missing test x'] } }),
  });
  const ls = labels(calls);
  assert.equal(ls.filter((l) => l === 'retry:a').length, 1);
  assert.equal(ls.filter((l) => l === 'recheck:a').length, 1);
  assert.deepEqual(ls.slice(0, 4), ['impl:a', 'check:a', 'retry:a', 'recheck:a']);
  const retry = calls.find((c) => c.opts.label === 'retry:a');
  assert.match(retry.prompt, /missing test x/);
  assert.match(retry.prompt, /The checker rejected your first attempt:/);
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.done_now, ['a', 'c', 'b']);
});

test('a check that fails twice blocks the task, finishes the wave and merges only the tasks that passed (A9)', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs(),
    respond: responder({
      'check:a': { pass: false, problems: ['missing test x'] },
      'recheck:a': { pass: false, problems: ['still missing test x'] },
    }),
  });
  const ls = labels(calls);
  assert.equal(result.status, 'blocked');
  assert.equal(result.wave, 0);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].id, 'a');
  assert.ok(result.blocked[0].reason.startsWith('failed the check twice'), result.blocked[0].reason);
  assert.match(result.blocked[0].reason, /still missing test x/);
  assert.ok(ls.includes('impl:c') && ls.includes('check:c'), 'the wave-0 sibling still ran');
  assert.equal(ls.filter((l) => l === 'merge:wave0').length, 1, 'the passed task is merged before returning');
  const merge = calls.find((c) => c.opts.label === 'merge:wave0');
  assert.ok(merge.prompt.includes('temper/e/c'), 'c is merged');
  assert.ok(!merge.prompt.includes('temper/e/a'), 'the blocked task is not merged');
  assert.ok(!ls.includes('impl:b'), 'no later wave');
  assert.deepEqual(result.done_now, ['c']);
});

test('a wave with no passed task runs no merge (A9)', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs({ tasks: [taskA, taskB] }),
    respond: responder({ 'impl:a': null }),
  });
  assert.equal(result.status, 'blocked');
  assert.ok(!labels(calls).includes('merge:wave0'));
  assert.deepEqual(result.done_now, []);
});

test('a blocked wave whose merge of the passed tasks also blocks lists both, and marks nothing done (A9)', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs(),
    respond: responder({
      'impl:a': null,
      'merge:wave0': { status: 'blocked', merged: [], conflict: { task: 'c', files: ['x'] }, gate_passed: true },
    }),
  });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blocked.map((b) => b.id), ['a', 'merge:wave0']);
  assert.ok(!labels(calls).includes('impl:b'));
  assert.deepEqual(result.done_now, []);
});

test('an implementer that returns blocked gives its question as the reason', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs(),
    respond: responder({ 'impl:a': { status: 'blocked', branch: 'temper/e/a', question: 'Q?', summary: 's' } }),
  });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blocked, [{ id: 'a', reason: 'Q?' }]);
  assert.ok(!labels(calls).includes('check:a'));
  assert.ok(labels(calls).includes('impl:c'));
});

test('an implementer that returns null is blocked, never done (Review Focus 1)', async () => {
  const { result, calls } = await runWorkflow(WF, { args: buildArgs(), respond: responder({ 'impl:a': null }) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.blocked[0].id, 'a');
  assert.equal(result.blocked[0].reason, 'agent returned nothing');
  assert.ok(!labels(calls).includes('check:a'));
  const merge = calls.find((c) => c.opts.label === 'merge:wave0');
  assert.ok(!merge.prompt.includes('temper/e/a`'), 'the task that returned nothing is not merged (A9)');
  assert.ok(!result.done_now.includes('a'));
});

test('a null at any later step is blocked with agent returned nothing', async () => {
  for (const over of [
    { 'check:a': null },
    { 'check:a': { pass: false, problems: ['p'] }, 'retry:a': null },
    { 'check:a': { pass: false, problems: ['p'] }, 'recheck:a': null },
  ]) {
    const { result } = await runWorkflow(WF, { args: buildArgs(), respond: responder(over) });
    assert.equal(result.status, 'blocked', JSON.stringify(over));
    assert.deepEqual(result.blocked, [{ id: 'a', reason: 'agent returned nothing' }], JSON.stringify(over));
  }
});

test('a blocked merge stops the run before the next wave', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: buildArgs(),
    respond: responder({
      'merge:wave0': { status: 'blocked', merged: ['a'], conflict: { task: 'c', files: ['x'] }, gate_passed: true },
    }),
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.wave, 0);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].id, 'merge:wave0');
  assert.match(result.blocked[0].reason, /x/);
  assert.ok(!labels(calls).some((l) => l.endsWith(':b') || l === 'merge:wave1'), 'no wave-1 calls');
  assert.deepEqual(result.done_now, []);
});

test('a merge whose gate failed, or that returned nothing, is blocked', async () => {
  for (const merge of [{ status: 'merged', merged: ['a', 'c'], gate_passed: false }, null]) {
    const { result, calls } = await runWorkflow(WF, { args: buildArgs(), respond: responder({ 'merge:wave0': merge }) });
    assert.equal(result.status, 'blocked');
    assert.equal(result.blocked[0].id, 'merge:wave0');
    assert.ok(!labels(calls).includes('impl:b'));
  }
});

test('done_now lists the tasks merged before a later wave blocks', async () => {
  const { result } = await runWorkflow(WF, { args: buildArgs(), respond: responder({ 'impl:b': null }) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.wave, 1);
  assert.deepEqual(result.done_now, ['a', 'c']);
});

test('a wave whose tasks are all done runs no merge', async () => {
  const { calls } = await runWorkflow(WF, { args: buildArgs({ done: ['a', 'c'] }), respond: responder() });
  const ls = labels(calls);
  assert.deepEqual(ls.slice(0, ls.indexOf('merge:wave1') + 1), ['impl:b', 'check:b', 'merge:wave1']);
  assert.ok(!ls.some((l) => /^(impl|check|retry|recheck):(a|c)$/.test(l) || l === 'merge:wave0'), 'no wave-0 label');
});
