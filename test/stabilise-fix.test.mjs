import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib, runWorkflow } from './harness.mjs';

const lib = loadLib();
const WF = 'workflows/stabilise.js';

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

const F1 = finding('f1', 'critical', { line: 11 });
const F2 = finding('f2', 'important', { line: 12 });
const S1 = finding('second:s1', 'severe', { line: 21 });
const M1 = finding('second:m1', 'minor', { line: 22 });

function fixArgs(extra = {}) {
  return {
    epic: 'e',
    repo: '/r',
    branch: 'temper/e',
    base: 'main',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'npm test', full: 'npm test && npm run e2e' },
    part: 'fix',
    lenses: [],
    severity_notes: '',
    done: [],
    selected: [F2, F1],
    ...extra,
  };
}

// Fixes return `fixed` unless `fixes` overrides one by finding id. The second sweep's security
// review returns `second` (nothing by default); every verify reproduces with the reported severity.
function responder({ fixes = {}, second = [], regress = { regressions: [] } } = {}) {
  const byId = Object.fromEntries(second.map((f) => [f.id, f]));
  return ({ label }) => {
    if (label.startsWith('fix:')) {
      const id = label.slice('fix:'.length);
      if (id in fixes) return fixes[id];
      return { status: 'fixed', commit: `sha-${id}`, note: 'done' };
    }
    if (label === 'second:review:security') return { findings: second };
    if (label.startsWith('second:review:')) return { findings: [] };
    if (label.startsWith('second:verify:')) {
      const id = label.slice('second:verify:'.length);
      return { real: true, severity: byId[id].severity, reason: 'reproduced' };
    }
    if (label === 'regress') return regress;
    throw new Error(`unexpected label ${label}`);
  };
}

const labels = (calls) => calls.map((c) => c.opts?.label);

test('selected findings are fixed one at a time in severity order', async () => {
  const { calls } = await runWorkflow(WF, { args: fixArgs(), respond: responder() });
  const fixes = calls.filter((c) => c.opts.label.startsWith('fix:'));
  assert.deepEqual(fixes.map((c) => c.opts.label), ['fix:f1', 'fix:f2']);
  for (const c of fixes) {
    assert.deepEqual(c.opts.schema, lib.FIX_SCHEMA);
    assert.equal(c.opts.phase, 'Fix');
  }
  assert.ok(fixes[0].prompt.includes('Temper-Task: e/fix:f1'));
});

test('a fix that finds the contract wrong is a contract item', async () => {
  const { result } = await runWorkflow(WF, {
    args: fixArgs(),
    respond: responder({ fixes: { f1: { status: 'contract', note: 'the contract is wrong' } } }),
  });
  assert.deepEqual(result.contract_items, ['f1']);
  assert.deepEqual(result.fixed, ['f2']);
});

test('a reverted fix is listed as reverted', async () => {
  const { result } = await runWorkflow(WF, {
    args: fixArgs(),
    respond: responder({ fixes: { f2: { status: 'reverted', note: 'broke a test' } } }),
  });
  assert.deepEqual(result.reverted, ['f2']);
  assert.deepEqual(result.fixed, ['f1']);
});

test('a fix already done is skipped', async () => {
  const { calls } = await runWorkflow(WF, { args: fixArgs({ done: ['fix:f1'] }), respond: responder() });
  assert.ok(!labels(calls).includes('fix:f1'));
  assert.ok(labels(calls).includes('fix:f2'));
});

test('nothing severe in the second sweep: stable, no regress, exactly one sweep', async () => {
  const args = fixArgs();
  const { result, calls } = await runWorkflow(WF, { args, respond: responder() });
  assert.equal(result.status, 'stable');
  assert.ok(!labels(calls).includes('regress'));
  const reviews = labels(calls).filter((l) => l.includes('review:'));
  assert.equal(reviews.length, lib.lensesOr(args.lenses).length);
  assert.deepEqual(reviews, lib.DEFAULT_LENSES.map((l) => `second:review:${l}`));
  assert.deepEqual(result.second_sweep, { severe: 0, others: 0 });
  assert.deepEqual(result.open_items, []);
  assert.deepEqual(result.regressions, []);
  assert.deepEqual(result.blocked, []);
});

test('the second sweep is told what was already fixed', async () => {
  const { calls } = await runWorkflow(WF, { args: fixArgs(), respond: responder() });
  const review = calls.find((c) => c.opts.label === 'second:review:security');
  assert.ok(review.prompt.includes('already fixed'));
  assert.ok(review.prompt.includes('f1'));
  assert.ok(review.prompt.includes('f2'));
});

test('the second sweep uses the given lenses', async () => {
  const { calls } = await runWorkflow(WF, { args: fixArgs({ lenses: ['security'] }), respond: responder() });
  assert.deepEqual(labels(calls).filter((l) => l.includes('review:')), ['second:review:security']);
});

test('something severe in the second sweep: fix it, check those fixes, then hand over', async () => {
  const { result, calls } = await runWorkflow(WF, {
    args: fixArgs(),
    respond: responder({ second: [S1, M1] }),
  });
  const ls = labels(calls);
  const iFix = ls.indexOf('fix:second:s1');
  const iRegress = ls.indexOf('regress');
  assert.ok(iFix > -1, 'no fix:second:s1 call');
  assert.equal(ls.filter((l) => l === 'regress').length, 1);
  assert.ok(iRegress > iFix, 'regress must come after fix:s1');
  assert.ok(!ls.includes('fix:second:m1'));
  assert.ok(!ls.slice(iRegress + 1).some((l) => l.includes('review:')), 'no review after regress');
  const regress = calls[iRegress];
  assert.deepEqual(regress.opts.schema, lib.REGRESS_SCHEMA);
  assert.ok(regress.prompt.includes('Temper-Task: e/fix:second:s1'));
  assert.ok(!regress.prompt.includes('Temper-Task: e/fix:f1'));
  assert.equal(result.status, 'handover');
  assert.deepEqual(result.open_items.map((f) => f.id), ['second:m1']);
  assert.deepEqual(result.second_sweep, { severe: 1, others: 1 });
  assert.deepEqual(result.fixed, ['f1', 'f2', 'second:s1']);
});

test('regressions the check finds are returned', async () => {
  const regressions = [{ fix: 'second:s1', evidence: 'test x fails' }];
  const { result } = await runWorkflow(WF, {
    args: fixArgs(),
    respond: responder({ second: [S1], regress: { regressions } }),
  });
  assert.equal(result.status, 'handover');
  assert.deepEqual(result.regressions, regressions);
});

test('a fix that returns nothing is blocked', async () => {
  const { result } = await runWorkflow(WF, { args: fixArgs(), respond: responder({ fixes: { f1: null } }) });
  assert.ok(result.blocked.some((b) => b.id === 'f1'));
  assert.equal(result.blocked.find((b) => b.id === 'f1').reason, 'agent returned nothing');
  assert.ok(!result.fixed.includes('f1'));
});

test('a blocked fix keeps its reason', async () => {
  const { result } = await runWorkflow(WF, {
    args: fixArgs(),
    respond: responder({ fixes: { f2: { status: 'blocked', note: 'needs root' } } }),
  });
  assert.deepEqual(result.blocked, [{ id: 'f2', reason: 'needs root' }]);
});

test("part 'fix' with no selected findings is invalid with no agent calls", async () => {
  const { result, calls } = await runWorkflow(WF, { args: fixArgs({ selected: [] }), respond: responder() });
  assert.equal(result.status, 'invalid');
  assert.equal(calls.length, 0);
});

test('a second-sweep review that returns nothing is blocked, and the stage is not stable', async () => {
  const base = responder();
  const respond = (q) => (q.label.startsWith('second:review:') ? null : base(q));
  const { result, calls } = await runWorkflow(WF, { args: fixArgs(), respond });
  assert.notEqual(result.status, 'stable');
  assert.equal(result.status, 'handover');
  assert.deepEqual(
    result.blocked,
    lib.DEFAULT_LENSES.map((l) => ({ id: `second:review:${l}`, reason: 'agent returned nothing' })),
  );
  const ls = labels(calls);
  assert.ok(!ls.slice(ls.lastIndexOf(`second:review:${lib.DEFAULT_LENSES.at(-1)}`) + 1).some((l) => /review:/.test(l)));
});

test('a second-sweep severe finding whose id does not match ID_RE never reaches a fix agent, and the run hands over (SECOND-SAFETY-4)', async () => {
  const bad = finding('S_1', 'severe', { line: 40 });
  const { result, calls } = await runWorkflow(WF, { args: fixArgs(), respond: responder({ second: [bad] }) });
  assert.ok(!labels(calls).some((l) => l.includes('S_1')), labels(calls).join(', '));
  assert.equal(result.status, 'handover');
  assert.ok(result.blocked.some((b) => b.id === 'second:review:security'), JSON.stringify(result.blocked));
  assert.deepEqual(result.second_sweep_findings, []);
});

test('a malformed saved second_sweep_findings is refused before any agent, never swept a third time (SECOND-TESTS-DOCS-3)', async () => {
  for (const second of [{}, 'x', null, [{ id: 'second-security-01' }], [{ id: 'second-security-01', severity: 'bad' }], [null]]) {
    const { result, calls } = await runWorkflow(WF, {
      args: fixArgs({ done: ['fix:f1', 'fix:f2'], second_sweep_findings: second }),
      respond: responder(),
    });
    assert.equal(result.status, 'invalid', JSON.stringify(second));
    assert.equal(calls.length, 0, `${JSON.stringify(second)}: ${labels(calls).join(', ')}`);
  }
});

test("a first-sweep fix from a lens whose slug starts with 'second' is not taken for a second-sweep fix: a resume still runs the second sweep (SECOND-TESTS-DOCS-2, SECOND-CONTROL-FLOW-7)", async () => {
  const lenses = ['security', 'second opinion'];
  // The first sweep's prompt for that lens names its ids, and the id it gives is a first-sweep id.
  const first = lib.reviewPrompt('second opinion', { ...fixArgs(), part: 'sweep', lenses }, []);
  const m = first.match(/Give each finding an id `([^`]*)-NN`/);
  assert.ok(m, 'the first-sweep review prompt names the ids');
  const id = `${m[1]}-01`;
  const sel = [finding(id, 'critical', { lens: 'second opinion' })];
  const { result, calls } = await runWorkflow(WF, {
    args: fixArgs({ lenses, selected: sel, done: [`fix:${id}`] }),
    respond: responder(),
  });
  const reviews = labels(calls).filter((l) => l.includes('review:'));
  assert.deepEqual(reviews, lenses.map((l) => `second:review:${l}`), labels(calls).join(', '));
  assert.ok(!result.blocked.some((b) => b.id === 'second-sweep'), JSON.stringify(result.blocked));
  assert.equal(result.status, 'stable');
});

test('a second-sweep id carries a namespace no first-sweep lens slug can produce, and the workflow enforces it both ways (SECOND-TESTS-DOCS-2, SECOND-CONTROL-FLOW-7)', async () => {
  for (const lens of ['second', 'Second opinion', 'second: x', 'a:b']) assert.ok(!lib.isSecondId(`${lib.lensSlug(lens)}-01`), lens);
  const second = lib.reviewPrompt('security', fixArgs(), []);
  const m = second.match(/Give each finding an id `([^`]*)-NN`/);
  assert.ok(m && lib.isSecondId(`${m[1]}-01`), 'the second-sweep prompt names ids in the namespace');
  // A second-sweep finding given without the namespace is put into it before any verify or fix.
  const bare = finding('security-07', 'severe', { line: 50 });
  const base = responder({ second: [bare] });
  const respond = (q) => (q.label === 'second:verify:second:security-07' ? { real: true, severity: 'severe', reason: 'r' } : base(q));
  const run = await runWorkflow(WF, { args: fixArgs(), respond });
  assert.ok(labels(run.calls).includes('second:verify:second:security-07'), labels(run.calls).join(', '));
  assert.ok(labels(run.calls).includes('fix:second:security-07'), labels(run.calls).join(', '));
  // A first-sweep finding in the namespace is never verified; its lens is blocked.
  const sweep = await runWorkflow(WF, {
    args: { ...fixArgs(), part: 'sweep', selected: undefined },
    respond: ({ label }) => (label === 'review:security'
      ? { findings: [finding('second:security-01', 'critical')] }
      : label.startsWith('review:') ? { findings: [] } : { real: true, severity: 'critical', reason: 'r' }),
  });
  assert.ok(!labels(sweep.calls).some((l) => l.startsWith('verify:')), labels(sweep.calls).join(', '));
  assert.deepEqual(sweep.result.findings, []);
  assert.deepEqual(sweep.result.blocked.map((b) => b.id), ['review:security']);
});

test('a lens with no slug, or a selected id in the second-sweep namespace, is refused before any agent (SECOND-TESTS-DOCS-2, SECOND-CONTROL-FLOW-7)', async () => {
  for (const extra of [{ lenses: ['!!!'] }, { lenses: ['security', ' '] }, { selected: [finding('second:security-01', 'critical')] }]) {
    const { result, calls } = await runWorkflow(WF, { args: fixArgs(extra), respond: responder() });
    assert.equal(result.status, 'invalid', JSON.stringify(extra));
    assert.equal(calls.length, 0);
  }
});
