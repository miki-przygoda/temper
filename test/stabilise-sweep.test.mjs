import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLib, runWorkflow } from './harness.mjs';

const lib = loadLib();
const WF = 'workflows/stabilise.js';

function sweepArgs(extra = {}) {
  return {
    epic: 'e',
    repo: '/r',
    branch: 'temper/e',
    base: 'main',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'npm test', full: 'npm test && npm run e2e' },
    part: 'sweep',
    lenses: [],
    severity_notes: '',
    done: [],
    ...extra,
  };
}

function finding(id, severity, extra = {}) {
  return {
    id,
    lens: 'security',
    file: 'src/a.rs',
    line: 10,
    summary: `summary of ${id}`,
    input: 'x',
    wrong_result: 'y',
    severity,
    kind: 'fix',
    ...extra,
  };
}

const F1 = finding('F1', 'minor', { summary: 'Token Leaks In Log' });
const F2 = finding('F2', 'important', { line: 20 });
const F3 = finding('F3', 'minor', { lens: 'failure paths and lifecycle', summary: '  token leaks in log ' });

// Reviews: security finds F1 and F2, the failure-paths lens finds F3 (a duplicate of F1), the third finds nothing.
// Verifies: real, keeping the reported severity, unless `verdicts` overrides one by finding id.
function responder(verdicts = {}) {
  const byId = { F1, F2, F3 };
  return ({ label }) => {
    if (label === 'review:security') return { findings: [F1, F2] };
    if (label === 'review:failure paths and lifecycle') return { findings: [F3] };
    if (label.startsWith('review:')) return { findings: [] };
    if (label.startsWith('verify:')) {
      const id = label.slice('verify:'.length);
      if (id in verdicts) return verdicts[id];
      return { real: true, severity: byId[id].severity, reason: 'reproduced' };
    }
    throw new Error(`unexpected label ${label}`);
  };
}

const labels = (calls) => calls.map((c) => c.opts?.label);

test('meta names the stage and its four phases', () => {
  const text = readFileSync(new URL('../workflows/stabilise.js', import.meta.url), 'utf8');
  const m = text.match(/^export const meta = (\{.*\});?$/m);
  assert.ok(m, 'meta line not found');
  const meta = Function(`return (${m[1]});`)();
  assert.deepEqual(meta, {
    name: 'stabilise',
    description: 'temper stage 4: sweep, then careful fixes and one more sweep',
    phases: [{ title: 'Sweep' }, { title: 'Verify' }, { title: 'Fix' }, { title: 'Second sweep' }],
  });
});

test('invalid args return invalid with no agent calls', async () => {
  const { result, calls } = await runWorkflow(WF, { args: sweepArgs({ part: 'nope' }), respond: responder() });
  assert.equal(result.status, 'invalid');
  assert.ok(result.errors.length > 0);
  assert.equal(calls.length, 0);
});

test('empty lenses run one review per default lens', async () => {
  const { calls } = await runWorkflow(WF, { args: sweepArgs(), respond: responder() });
  const reviews = labels(calls).filter((l) => l.startsWith('review:'));
  assert.deepEqual(reviews, lib.DEFAULT_LENSES.map((l) => `review:${l}`));
  for (const c of calls.filter((c) => c.opts.label.startsWith('review:'))) {
    assert.deepEqual(c.opts.schema, lib.FINDINGS_SCHEMA);
  }
});

test('given lenses are used instead of the defaults', async () => {
  const { calls } = await runWorkflow(WF, { args: sweepArgs({ lenses: ['security'] }), respond: responder() });
  assert.deepEqual(labels(calls).filter((l) => l.startsWith('review:')), ['review:security']);
});

test('every finding is verified, and duplicates are merged after the verdicts', async () => {
  const { result, calls } = await runWorkflow(WF, { args: sweepArgs(), respond: responder() });
  const verifies = calls.filter((c) => c.opts.label.startsWith('verify:'));
  assert.deepEqual(verifies.map((c) => c.opts.label).sort(), ['verify:F1', 'verify:F2', 'verify:F3']);
  for (const c of verifies) assert.deepEqual(c.opts.schema, lib.VERDICT_SCHEMA);
  assert.equal(result.status, 'list');
  assert.deepEqual(result.findings.map((f) => f.id), ['F2', 'F1']);
  assert.equal(result.refuted, 0);
});

test("the verdict's severity replaces the reported one", async () => {
  const { result } = await runWorkflow(WF, {
    args: sweepArgs(),
    respond: responder({ F2: { real: true, severity: 'severe', reason: 'worse than reported' } }),
  });
  const f2 = result.findings.find((f) => f.id === 'F2');
  assert.equal(f2.severity, 'severe');
  assert.equal(result.findings[0].id, 'F2');
});

test('a finding the verifier refutes is dropped and counted', async () => {
  const { result } = await runWorkflow(WF, {
    args: sweepArgs(),
    respond: responder({ F1: { real: false, severity: 'minor', reason: 'could not reproduce' } }),
  });
  assert.ok(!result.findings.some((f) => f.id === 'F1'));
  assert.ok(result.refuted >= 1);
});

test('a verify that returns nothing counts as refuted', async () => {
  const { result } = await runWorkflow(WF, { args: sweepArgs(), respond: responder({ F2: null }) });
  assert.ok(!result.findings.some((f) => f.id === 'F2'));
  assert.equal(result.refuted, 1);
});

test('a review that returns nothing contributes no findings', async () => {
  const base = responder();
  const respond = (q) => (q.label === 'review:security' ? null : base(q));
  const { result } = await runWorkflow(WF, { args: sweepArgs(), respond });
  assert.equal(result.status, 'list');
  assert.deepEqual(result.findings.map((f) => f.id), ['F3']);
});

test("part 'sweep' makes no fix calls", async () => {
  const { calls } = await runWorkflow(WF, { args: sweepArgs(), respond: responder() });
  assert.ok(!labels(calls).some((l) => l.startsWith('fix:')));
});
