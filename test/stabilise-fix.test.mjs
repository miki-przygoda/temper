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
// Every `regress:fix:<id>` agent returns `regress`, or `regress(id)` when it is a function.
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
    if (label.startsWith('regress:fix:')) {
      const id = label.slice('regress:fix:'.length);
      return typeof regress === 'function' ? regress(id) : regress;
    }
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

test('nothing severe in the second sweep: stable, no second-sweep regress, exactly one sweep', async () => {
  const args = fixArgs();
  const { result, calls } = await runWorkflow(WF, { args, respond: responder() });
  assert.equal(result.status, 'stable');
  // Updated for v0.2: the first-wave fixes always get their regression check; the second sweep adds none.
  assert.deepEqual(labels(calls).filter((l) => l.startsWith('regress')), ['regress:fix:f1', 'regress:fix:f2']);
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
  const iRegress = ls.indexOf('regress:fix:second:s1');
  assert.ok(iFix > -1, 'no fix:S1 call');
  assert.equal(ls.slice(iFix).filter((l) => l.startsWith('regress')).length, 1);
  assert.ok(iRegress > iFix, 'regress must come after fix:second:s1');
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
    respond: responder({ second: [S1], regress: (id) => (id === 'second:s1' ? { regressions } : { regressions: [] }) }),
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

test('a blocked first-sweep fix stops part fix before the second sweep: status blocked, naming the fix (SECOND-CONTROL-FLOW-4)', async () => {
  for (const reply of [{ status: 'blocked', note: 'which behaviour?' }, null]) {
    const { result, calls } = await runWorkflow(WF, { args: fixArgs(), respond: responder({ fixes: { f1: reply } }) });
    assert.equal(result.status, 'blocked', JSON.stringify(reply));
    assert.deepEqual(result.blocked.map((b) => b.id), ['f1']);
    assert.deepEqual(result.fixed, ['f2'], 'the other fixes still run');
    // Updated for v0.2: the fix that landed still gets its regression check; no second sweep runs.
    assert.ok(!labels(calls).some((l) => l.includes('review:')), labels(calls).join(', '));
    assert.deepEqual(labels(calls).filter((l) => l.startsWith('regress')), ['regress:fix:f2']);
    assert.equal(result.second_sweep_findings, undefined, 'no second sweep ran, so nothing to save');
  }
});

test('a resume after the block is resolved checks every landed fix for regressions, done ones included, then runs the second sweep (SECOND-CONTROL-FLOW-4)', async () => {
  for (const extra of [{ answers: { f1: 'do X' } }, { done: ['fix:f2'] }]) {
    const { result, calls } = await runWorkflow(WF, { args: fixArgs({ done: ['fix:f2'], ...extra }), respond: responder() });
    const ls = labels(calls);
    assert.deepEqual(ls.filter((l) => l.startsWith('fix:')), ['fix:f1'], ls.join(', '));
    assert.deepEqual(ls.filter((l) => l.startsWith('regress')).sort(), ['regress:fix:f1', 'regress:fix:f2']);
    for (const id of ['f1', 'f2']) {
      const regress = calls[ls.indexOf(`regress:fix:${id}`)];
      assert.ok(ls.indexOf(`regress:fix:${id}`) > ls.indexOf('fix:f1'), ls.join(', '));
      assert.deepEqual(regress.opts.schema, lib.REGRESS_SCHEMA);
      assert.ok(regress.prompt.includes(`Temper-Task: e/fix:${id}`));
      const other = id === 'f1' ? 'f2' : 'f1';
      assert.ok(!regress.prompt.includes(`Temper-Task: e/fix:${other}`), 'one fix per regression agent');
    }
    const lastRegress = Math.max(ls.indexOf('regress:fix:f1'), ls.indexOf('regress:fix:f2'));
    const reviews = ls.map((l, i) => [l, i]).filter(([l]) => l.startsWith('second:review:'));
    assert.equal(reviews.length, lib.DEFAULT_LENSES.length);
    assert.ok(reviews.every(([, i]) => i > lastRegress), 'the second sweep runs after the regression check');
    assert.equal(result.status, 'stable');
    assert.deepEqual(result.blocked, []);
  }
});

test('a regression check that finds a regression or returns nothing stops before the second sweep (SECOND-CONTROL-FLOW-4)', async () => {
  const regressions = [{ fix: 'f1', evidence: 'test x fails' }];
  for (const [reply, status] of [[{ regressions }, 'handover'], [null, 'blocked']]) {
    const base = responder();
    const respond = (q) => (q.label === 'regress:fix:f1' ? reply : base(q));
    for (const extra of [{}, { done: ['fix:f2'], answers: { f1: 'do X' } }]) {
      const { result, calls } = await runWorkflow(WF, { args: fixArgs(extra), respond });
      assert.equal(result.status, status, JSON.stringify(reply));
      assert.ok(!labels(calls).some((l) => l.includes('review:')), labels(calls).join(', '));
      if (reply) assert.deepEqual(result.regressions, regressions);
      else assert.deepEqual(result.blocked, [{ id: 'regress:fix:f1', reason: 'agent returned nothing' }]);
    }
  }
});

test('an unverified second-sweep finding above minor makes the result handover, and is saved marked', async () => {
  for (const severity of ['severe', 'critical', 'important', 'minor']) {
    const u = finding('second:u1', severity, { line: 60 });
    const base = responder({ second: [u] });
    const respond = (q) => (q.label === 'second:verify:second:u1' ? null : base(q));
    const { result, calls } = await runWorkflow(WF, { args: fixArgs(), respond });
    assert.ok(!labels(calls).includes('fix:second:u1'), `${severity}: an unverified finding went to a fix agent`);
    assert.equal(result.status, severity === 'minor' ? 'stable' : 'handover', severity);
    assert.deepEqual(
      result.blocked,
      severity === 'minor' ? [] : [{ id: 'second:verify:second:u1', reason: 'agent returned nothing' }],
      severity,
    );
    assert.deepEqual(result.second_sweep_findings.map((f) => [f.id, f.unverified]), [['second:u1', true]], severity);
    assert.deepEqual(result.unverified.map((f) => f.id), ['second:u1'], severity);
    assert.ok(result.open_items.some((f) => f.id === 'second:u1' && f.unverified === true), `${severity}: not in the open items`);
    assert.deepEqual(result.second_sweep, { severe: 0, others: 0 }, severity);
  }
});

test('an unverified second-sweep finding that duplicates a verified one is listed once, verified', async () => {
  const v = finding('second:v1', 'important', { line: 61, summary: 'Same Bug' });
  const u = finding('second:u1', 'important', { line: 61, summary: 'same bug', lens: 'failure paths and lifecycle' });
  const base = responder({ second: [v] });
  const respond = (q) => {
    if (q.label === 'second:review:failure paths and lifecycle') return { findings: [u] };
    if (q.label === 'second:verify:second:u1') return null;
    return base(q);
  };
  const { result } = await runWorkflow(WF, { args: fixArgs(), respond });
  assert.equal(result.status, 'stable');
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.second_sweep_findings.map((f) => f.id), ['second:v1']);
  assert.deepEqual(result.unverified, []);
});

test('a saved unverified finding is never fixed on resume', async () => {
  for (const severity of ['severe', 'important', 'minor']) {
    const u = { ...finding('second:u1', severity, { line: 62 }), unverified: true };
    const { result, calls } = await runWorkflow(WF, {
      args: fixArgs({ done: ['fix:f1', 'fix:f2'], second_sweep_findings: [u] }),
      respond: responder(),
    });
    assert.ok(!labels(calls).includes('fix:second:u1'), `${severity}: a saved unverified finding was fixed`);
    assert.ok(!labels(calls).some((l) => l.startsWith('second:review:')), `${severity}: swept again`);
    assert.equal(result.status, severity === 'minor' ? 'stable' : 'handover', severity);
    assert.deepEqual(
      result.blocked,
      severity === 'minor' ? [] : [{ id: 'second:verify:second:u1', reason: 'agent returned nothing' }],
      severity,
    );
    assert.deepEqual(result.second_sweep_findings.map((f) => [f.id, f.unverified]), [['second:u1', true]], severity);
    assert.deepEqual(result.unverified.map((f) => f.id), ['second:u1'], severity);
    assert.deepEqual(result.second_sweep, { severe: 0, others: 0 }, severity);
  }
});

test('a first-sweep finding whose id is in the second: namespace is never verified, and blocks its lens', async () => {
  for (const lens of ['second', 'Second opinion', 'second: x', 'a:b']) assert.ok(!lib.isSecondId(`${lib.lensSlug(lens)}-01`), lens);
  assert.equal(lib.SECOND_PREFIX, 'second:');
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

test('a lens with no slug, or a selected id in the second: namespace, is refused before any agent', async () => {
  for (const extra of [{ lenses: ['!!!'] }, { lenses: ['security', ' '] }, { selected: [finding('second:security-01', 'critical')] }]) {
    const { result, calls } = await runWorkflow(WF, { args: fixArgs(extra), respond: responder() });
    assert.equal(result.status, 'invalid', JSON.stringify(extra));
    assert.equal(calls.length, 0);
  }
});
