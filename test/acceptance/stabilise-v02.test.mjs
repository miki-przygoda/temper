// Acceptance tests for the v0.2 stabilise group (docs/temper/v0-2/behaviour.md, STABILISE-01..25):
// one-sweep mode, the per-fix regression check, selected minors, unverified findings and second-sweep
// ids (spec 3.3, 3.4, 3.9). They drive the bundled workflows/stabilise.js through the harness with
// scripted agents, the way the head launches it with args.json, and read the labels, prompts and
// results those runs produce. A test that fails because of the product is skipped with
// "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from '../harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF = 'workflows/stabilise.js';
const EPIC = 'e';

function args(extra = {}) {
  return {
    epic: EPIC,
    repo: '/r',
    branch: 'temper/e',
    base: 'main',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'QUICK-GATE-CMD', full: 'FULL-GATE-CMD' },
    part: 'sweep',
    lenses: ['security'],
    severity_notes: '',
    done: [],
    ...extra,
  };
}

const fixArgs = (extra = {}) => args({ part: 'fix', ...extra });

let line = 100;
function finding(id, severity, extra = {}) {
  line += 1;
  return {
    id,
    lens: 'security',
    file: 'src/a.rs',
    line,
    summary: `summary of ${id}`,
    input: `INPUT-${id}`,
    wrong_result: `WRONG-${id}`,
    severity,
    kind: 'fix',
    ...extra,
  };
}

const labels = (calls) => calls.map((c) => c.opts?.label);
const withPrefix = (calls, p) => labels(calls).filter((l) => l.startsWith(p));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Scripted agents. `reviews[lens]` is what that first-sweep lens reports; `second[lens]` what the
// second-sweep lens reports (nothing by default). Every verify reproduces its finding with the
// reviewer's severity unless `verdicts[id]` overrides it (null: the verifier returned nothing). Every
// fix is `fixed` unless `fixes[id]` overrides it. Every `regress:fix:<id>` returns `regress`, or
// `regress(id)` when it is a function.
function responder({ reviews = {}, second = {}, verdicts = {}, fixes = {}, regress = { regressions: [] } } = {}) {
  const all = {};
  for (const fs of Object.values(reviews)) for (const f of fs) all[f.id] = f;
  for (const fs of Object.values(second)) for (const f of fs) { all[f.id] = f; all[`second:${f.id}`] = f; }
  return ({ label }) => {
    if (label.startsWith('second:review:')) return { findings: second[label.slice('second:review:'.length)] ?? [] };
    if (label.startsWith('review:')) return { findings: reviews[label.slice('review:'.length)] ?? [] };
    const v = label.match(/^(?:second:)?verify:(.*)$/);
    if (v) {
      if (has(verdicts, v[1])) return verdicts[v[1]];
      return { real: true, severity: all[v[1]].severity, reason: 'reproduced' };
    }
    if (label.startsWith('regress:fix:')) {
      const id = label.slice('regress:fix:'.length);
      return typeof regress === 'function' ? regress(id) : regress;
    }
    if (label.startsWith('fix:')) {
      const id = label.slice('fix:'.length);
      if (has(fixes, id)) return fixes[id];
      return { status: 'fixed', commit: `sha-${id}`, note: 'done' };
    }
    throw new Error(`unexpected label ${label}`);
  };
}

// The same workflow run with the runtime's documented concurrency: parallel() runs its thunks
// together and pipeline() sends every item through its stages with no barrier. The harness runs them
// one after another, so checking that regression agents run in parallel needs this.
async function runConcurrent(filePath, { args: a, respond }) {
  const source = readFileSync(join(ROOT, filePath), 'utf8').replace(/export\s+const\s+meta\b/, 'const meta');
  const calls = [];
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts });
    const r = await respond({ prompt, opts, label: opts?.label });
    return r === undefined ? null : r;
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let value = item;
    try {
      for (const stage of stages) value = await stage(value, item, i);
    } catch {
      value = null;
    }
    return value;
  }));
  const globals = { agent, pipeline, parallel, phase: () => {}, log: () => {}, args: a, budget: { total: null, spent: () => 0, remaining: () => Infinity } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction(...Object.keys(globals), source);
  const result = await run(...Object.values(globals));
  return { result, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function tracking(base, prefix) {
  const state = { now: 0, max: 0 };
  const respond = async (q) => {
    if (!q.label.startsWith(prefix)) return base(q);
    state.now += 1;
    state.max = Math.max(state.max, state.now);
    await tick();
    state.now -= 1;
    return base(q);
  };
  return { respond, state };
}

async function expectInvalid(a, field) {
  const { result, calls } = await runWorkflow(WF, { args: a, respond: () => null });
  assert.equal(result.status, 'invalid', `${field}=${JSON.stringify(a[field])} was accepted`);
  assert.equal(calls.length, 0, 'an agent was started on invalid args');
  assert.ok(result.errors.some((e) => e.includes(field)), `no error names ${field}: ${result.errors}`);
}

async function expectValid(a, label) {
  const { result } = await runWorkflow(WF, { args: a, respond: responder() });
  assert.notEqual(result.status, 'invalid', `${label} was refused: ${result.errors}`);
}

test('STABILISE-01 sweeps: missing, 1 or 2 is accepted; anything else is refused', async () => {
  const sel = [finding('security-01', 'critical')];
  for (const part of ['sweep', 'fix']) {
    const base = part === 'fix' ? fixArgs({ selected: sel }) : args();
    await expectValid(base, `${part}: sweeps missing`);
    await expectValid({ ...base, sweeps: 1 }, `${part}: sweeps 1`);
    await expectValid({ ...base, sweeps: 2 }, `${part}: sweeps 2`);
    for (const bad of [0, 3, -1, 1.5, '1', '2', null, true, [1], {}]) {
      await expectInvalid({ ...base, sweeps: bad }, 'sweeps');
    }
  }
});

test('STABILISE-02 attempt: missing or an integer >= 0 is accepted; anything else is refused', async () => {
  const sel = [finding('security-01', 'critical')];
  for (const part of ['sweep', 'fix']) {
    const base = part === 'fix' ? fixArgs({ selected: sel, sweeps: 1 }) : args();
    await expectValid(base, `${part}: attempt missing`);
    for (const ok of [0, 1, 7]) await expectValid({ ...base, attempt: ok }, `${part}: attempt ${ok}`);
    for (const bad of [-1, 1.5, '1', null, true, [1], {}, NaN]) {
      await expectInvalid({ ...base, attempt: bad }, 'attempt');
    }
  }
});

test('STABILISE-03 one regression agent per landed first-sweep fix, in parallel, labelled regress:fix:<id>, told to prove the break against the parent commit', async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'important'), finding('security-03', 'minor')];
  for (const sweeps of [1, 2]) {
    const { respond, state } = tracking(responder(), 'regress:fix:');
    const { calls } = await runConcurrent(WF, { args: fixArgs({ selected: sel, sweeps }), respond });
    const regress = calls.filter((c) => c.opts.label.startsWith('regress:fix:'));
    assert.deepEqual(regress.map((c) => c.opts.label).sort(), ['regress:fix:security-01', 'regress:fix:security-02', 'regress:fix:security-03'], `sweeps ${sweeps}`);
    assert.equal(state.max, 3, `sweeps ${sweeps}: the regression agents did not run in parallel`);
    for (const c of regress) {
      const id = c.opts.label.slice('regress:fix:'.length);
      assert.ok(c.prompt.includes(`fix:${id}`), 'the prompt does not name its one fix');
      assert.match(c.prompt, /Prove what this fix broke/);
      assert.match(c.prompt, /failing test, or a command and its wrong output/);
      assert.match(c.prompt, /parent commit/);
    }
    // Each runs after the fix loop: every fix: agent comes before every regress: agent.
    const ls = labels(calls);
    const lastFix = Math.max(...ls.map((l, i) => (/^fix:security-/.test(l) ? i : -1)));
    const firstRegress = ls.findIndex((l) => l.startsWith('regress:fix:'));
    assert.ok(lastFix < firstRegress, 'a regression agent started before the fix loop ended');
  }
});

test('STABILISE-04 the regression check covers fixes made in this run and those whose fix:<id> trailer is in done', async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'important')];
  const { calls } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, sweeps: 1, done: ['fix:security-01'] }),
    respond: responder(),
  });
  assert.deepEqual(withPrefix(calls, 'fix:'), ['fix:security-02']);
  assert.deepEqual(withPrefix(calls, 'regress:fix:').sort(), ['regress:fix:security-01', 'regress:fix:security-02']);
});

test('STABILISE-05 a fix loop that was not clean still gets the regression check over landed fixes; reverted and contract items are left out', async () => {
  const sel = [
    finding('security-01', 'critical'),
    finding('security-02', 'critical'),
    finding('security-03', 'important'),
    finding('security-04', 'important'),
    finding('security-05', 'minor'),
  ];
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, done: ['fix:security-05'] }),
    respond: responder({
      fixes: {
        'security-02': { status: 'reverted', note: 'broke x' },
        'security-03': { status: 'contract', note: 'contract wrong' },
        'security-04': { status: 'blocked', note: 'needs root' },
      },
    }),
  });
  assert.deepEqual(withPrefix(calls, 'regress:fix:').sort(), ['regress:fix:security-01', 'regress:fix:security-05']);
  assert.deepEqual(result.reverted, ['security-02']);
  assert.deepEqual(result.contract_items, ['security-03']);
  assert.equal(result.status, 'blocked');
});

test('STABILISE-06 a proven regression makes the status handover and no second sweep runs, even with something blocked', async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'important'), finding('security-03', 'minor')];
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, sweeps: 2 }),
    respond: responder({
      fixes: { 'security-02': { status: 'blocked', note: 'stuck' } },
      regress: (id) => {
        if (id === 'security-01') return { regressions: [{ fix: 'security-01', evidence: 'test t fails; passes on parent' }] };
        return null;
      },
    }),
  });
  assert.equal(result.status, 'handover');
  assert.equal(result.regressions.length, 1);
  assert.equal(withPrefix(calls, 'second:').length, 0, 'a second sweep ran after a proven regression');
  assert.ok(result.blocked.some((b) => b.id === 'security-02'), 'the blocked fix is not reported');
});

test('STABILISE-07 no proven regression and a blocked fix or regression agent makes the status blocked', async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'important')];
  // A blocked fix.
  {
    const { calls, result } = await runWorkflow(WF, {
      args: fixArgs({ selected: sel }),
      respond: responder({ fixes: { 'security-02': { status: 'blocked', note: 'stuck' } } }),
    });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.regressions, []);
    assert.equal(withPrefix(calls, 'second:').length, 0);
  }
  // A blocked regression agent.
  {
    const { result } = await runWorkflow(WF, {
      args: fixArgs({ selected: sel, sweeps: 1 }),
      respond: responder({ regress: (id) => (id === 'security-02' ? null : { regressions: [] }) }),
    });
    assert.equal(result.status, 'blocked');
  }
});

test("STABILISE-08 a regression agent that returns nothing blocks its fix as regress:fix:<id>, 'agent returned nothing'", async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'important')];
  const { result } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, sweeps: 1 }),
    respond: responder({ regress: (id) => (id === 'security-01' ? undefined : { regressions: [] }) }),
  });
  assert.deepEqual(result.blocked, [{ id: 'regress:fix:security-01', reason: 'agent returned nothing' }]);
});

test('STABILISE-08 a second-sweep regression agent that returns nothing blocks its fix too', async () => {
  const sel = [finding('security-01', 'critical')];
  const secondFindings = [finding('security-07', 'severe'), finding('security-08', 'severe')];
  // Severe fixes made by this run's second sweep.
  {
    const { result } = await runWorkflow(WF, {
      args: fixArgs({ selected: sel, sweeps: 2 }),
      respond: responder({
        second: { security: secondFindings },
        regress: (id) => (id === 'second:security-07' ? undefined : { regressions: [] }),
      }),
    });
    assert.deepEqual(result.blocked, [{ id: 'regress:fix:second:security-07', reason: 'agent returned nothing' }]);
  }
  // A second-sweep fix trailer with its saved findings lost: the committed fix is still checked.
  {
    const { calls, result } = await runWorkflow(WF, {
      args: fixArgs({ selected: sel, done: ['fix:security-01', 'fix:second:security-08'], attempt: 1 }),
      respond: responder({ regress: (id) => (id === 'second:security-08' ? undefined : { regressions: [] }) }),
    });
    assert.ok(labels(calls).includes('regress:fix:second:security-08'), 'the lost second-sweep fix was not checked');
    assert.equal(result.status, 'handover');
    assert.ok(
      result.blocked.some((b) => b.id === 'regress:fix:second:security-08' && b.reason === 'agent returned nothing'),
      `the empty regression agent is not reported: ${JSON.stringify(result.blocked)}`,
    );
  }
});

test("STABILISE-09 a regression prompt includes the attempt and ends with 'Run attempt <n>.'", async () => {
  const sel = [finding('security-01', 'critical')];
  for (const [attempt, n] of [[undefined, 0], [0, 0], [3, 3]]) {
    const extra = attempt === undefined ? {} : { attempt };
    const { calls } = await runWorkflow(WF, { args: fixArgs({ selected: sel, sweeps: 1, ...extra }), respond: responder() });
    const r = calls.find((c) => c.opts.label === 'regress:fix:security-01');
    assert.ok(r, 'no regression agent ran');
    assert.ok(r.prompt.endsWith(`Run attempt ${n}.`), `attempt ${attempt}: prompt ends with ${JSON.stringify(r.prompt.slice(-30))}`);
  }
});

test('STABILISE-10 a fix run resumed with both fixes in done and attempt 1 runs the regression agents again and no fix agent', async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'important')];
  const { calls } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, sweeps: 1, attempt: 1, done: ['fix:security-01', 'fix:security-02'] }),
    respond: responder(),
  });
  assert.deepEqual(withPrefix(calls, 'fix:'), []);
  const regress = calls.filter((c) => c.opts.label.startsWith('regress:fix:'));
  assert.deepEqual(regress.map((c) => c.opts.label).sort(), ['regress:fix:security-01', 'regress:fix:security-02']);
  for (const c of regress) assert.ok(c.prompt.endsWith('Run attempt 1.'));
});

test('STABILISE-11 sweeps 1 with a clean regression check: stable, second_sweep null, no second: agent', async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'minor')];
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, sweeps: 1 }),
    respond: responder({ second: { security: [finding('security-09', 'severe')] } }),
  });
  assert.equal(result.status, 'stable');
  assert.equal(result.second_sweep, null);
  assert.equal(withPrefix(calls, 'second:').length, 0);
  assert.equal(withPrefix(calls, 'regress:fix:').length, 2);
});

test('STABILISE-12 sweeps 2 (or missing) with a clean regression check: the second sweep runs, each severe fix gets its own regress:fix:<id>', async () => {
  const sel = [finding('security-01', 'critical')];
  const secondFindings = [finding('security-07', 'severe'), finding('security-08', 'severe'), finding('security-09', 'important')];
  for (const extra of [{ sweeps: 2 }, {}]) {
    const { calls, result } = await runWorkflow(WF, {
      args: fixArgs({ selected: sel, ...extra }),
      respond: responder({ second: { security: secondFindings } }),
    });
    const ls = labels(calls);
    assert.deepEqual(withPrefix(calls, 'second:review:'), ['second:review:security']);
    assert.deepEqual(withPrefix(calls, 'fix:'), ['fix:security-01', 'fix:second:security-07', 'fix:second:security-08']);
    assert.deepEqual(withPrefix(calls, 'regress:fix:'), ['regress:fix:security-01', 'regress:fix:second:security-07', 'regress:fix:second:security-08']);
    assert.ok(ls.indexOf('regress:fix:security-01') < ls.indexOf('second:review:security'), 'the second sweep ran before the first regression check');
    assert.deepEqual(result.second_sweep, { severe: 2, others: 1 });
    assert.equal(result.status, 'handover');
  }
});

test('STABILISE-13 second_sweep_findings [] and no sweeps: no second sweep, the first-wave regression check still runs', async () => {
  const sel = [finding('security-01', 'critical')];
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, second_sweep_findings: [] }),
    respond: responder({ second: { security: [finding('security-09', 'severe')] } }),
  });
  assert.equal(withPrefix(calls, 'second:').length, 0);
  assert.deepEqual(withPrefix(calls, 'regress:fix:'), ['regress:fix:security-01']);
  assert.equal(result.status, 'stable');
});

test('STABILISE-14 every selected finding is fixed in severity order, minors last; no selected minor goes to the open items', async () => {
  const sel = [finding('security-01', 'minor'), finding('security-02', 'critical'), finding('security-03', 'important'), finding('security-04', 'severe')];
  for (const sweeps of [1, 2]) {
    const { calls, result } = await runWorkflow(WF, {
      args: fixArgs({ selected: sel, sweeps }),
      respond: responder({ second: { security: [finding('security-09', 'minor')] } }),
    });
    assert.deepEqual(withPrefix(calls, 'fix:'), ['fix:security-04', 'fix:security-02', 'fix:security-03', 'fix:security-01']);
    assert.ok(result.fixed.includes('security-01'), 'the selected minor was not fixed');
    assert.ok(!result.open_items.some((f) => f.id === 'security-01'), 'the selected minor went to the open items');
  }
  // The behaviour's example: a critical first and a minor second.
  const { calls } = await runWorkflow(WF, {
    args: fixArgs({ selected: [finding('security-05', 'minor'), finding('security-06', 'critical')], sweeps: 1 }),
    respond: responder(),
  });
  assert.deepEqual(withPrefix(calls, 'fix:'), ['fix:security-06', 'fix:security-05']);
});

test('STABILISE-15 unselected minor findings are not fixed and go to the open items', async () => {
  const sel = [finding('security-01', 'critical')];
  const unselected = finding('security-09', 'minor');
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel }),
    respond: responder({ second: { security: [unselected] } }),
  });
  assert.ok(!labels(calls).some((l) => l.startsWith('fix:') && l.includes('security-09')), 'an unselected minor was fixed');
  assert.deepEqual(result.open_items.map((f) => f.id), ['second:security-09']);
  assert.equal(result.status, 'stable');
  // The head's side: unselected first-sweep minors go to the open items (skills/run/SKILL.md).
  const run = readFileSync(join(ROOT, 'skills/run/SKILL.md'), 'utf8');
  assert.match(run, /every minor finding the user didn't select[^\n]*go to the open items/);
});

test('STABILISE-16 a finding whose verifier returned nothing is kept unverified, never counted as refuted, never fixed automatically', async () => {
  // First sweep.
  const a = finding('security-01', 'critical');
  const b = finding('security-02', 'important');
  {
    const { result } = await runWorkflow(WF, {
      args: args(),
      respond: responder({ reviews: { security: [a, b] }, verdicts: { 'security-01': null, 'security-02': { real: false, severity: 'important', reason: 'no' } } }),
    });
    assert.deepEqual(result.findings, []);
    assert.equal(result.refuted, 1, 'the unverified finding was counted as refuted');
    assert.equal(result.unverified.length, 1);
    assert.equal(result.unverified[0].id, 'security-01');
    assert.equal(result.unverified[0].unverified, true);
  }
  // Second sweep: a severe unverified finding is never given to a fix agent.
  {
    const s = finding('security-08', 'severe');
    const { calls, result } = await runWorkflow(WF, {
      args: fixArgs({ selected: [finding('security-03', 'critical')] }),
      respond: responder({ second: { security: [s] }, verdicts: { 'second:security-08': null } }),
    });
    assert.ok(!labels(calls).includes('fix:second:security-08'), 'an unverified finding was fixed');
    assert.equal(result.unverified.length, 1);
    assert.equal(result.unverified[0].unverified, true);
    assert.equal(result.second_sweep.severe, 0);
  }
});

test('STABILISE-17 the same bug from two lenses, verified once and unverified once, appears once, as verified', async () => {
  const one = finding('security-01', 'critical', { lens: 'security' });
  const twin = { ...one, id: 'perf-01', lens: 'perf', summary: '  SUMMARY of security-01 ' };
  // Two unverified copies of another bug, deduped against themselves.
  const u1 = finding('security-02', 'important');
  const u2 = { ...u1, id: 'perf-02', lens: 'perf' };
  const { result } = await runWorkflow(WF, {
    args: args({ lenses: ['security', 'perf'] }),
    respond: responder({
      reviews: { security: [one, u1], perf: [twin, u2] },
      verdicts: { 'perf-01': null, 'security-02': null, 'perf-02': null },
    }),
  });
  assert.deepEqual(result.findings.map((f) => f.id), ['security-01']);
  assert.ok(!result.findings[0].unverified, 'the verified copy is marked unverified');
  assert.equal(result.unverified.length, 1, `unverified: ${result.unverified.map((f) => f.id)}`);
  assert.ok(['security-02', 'perf-02'].includes(result.unverified[0].id));
});

test("STABILISE-18 an unverified finding above minor blocks as verify:<id> (second:verify:<id> in the second sweep), 'agent returned nothing'", async () => {
  {
    const { result } = await runWorkflow(WF, {
      args: args(),
      respond: responder({
        reviews: { security: [finding('security-01', 'important'), finding('security-02', 'minor')] },
        verdicts: { 'security-01': null, 'security-02': null },
      }),
    });
    assert.deepEqual(result.blocked, [{ id: 'verify:security-01', reason: 'agent returned nothing' }]);
  }
  {
    const { result } = await runWorkflow(WF, {
      args: fixArgs({ selected: [finding('security-03', 'critical')] }),
      respond: responder({
        second: { security: [finding('security-08', 'important'), finding('security-09', 'minor')] },
        verdicts: { 'second:security-08': null, 'second:security-09': null },
      }),
    });
    assert.deepEqual(result.blocked, [{ id: 'second:verify:second:security-08', reason: 'agent returned nothing' }]);
    assert.notEqual(result.status, 'stable');
  }
});

test('STABILISE-19 an unverified second-sweep finding is saved with unverified: true and stays unverified on resume', async () => {
  const sel = [finding('security-01', 'critical')];
  const first = await runWorkflow(WF, {
    args: fixArgs({ selected: sel }),
    respond: responder({ second: { security: [finding('security-08', 'severe')] }, verdicts: { 'second:security-08': null } }),
  });
  const saved = first.result.second_sweep_findings;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'second:security-08');
  assert.equal(saved[0].unverified, true);
  // The head saves them and resumes (JSON round trip, as args.json).
  const resumed = JSON.parse(JSON.stringify(saved));
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, done: ['fix:security-01'], second_sweep_findings: resumed, attempt: 1 }),
    respond: responder(),
  });
  assert.equal(withPrefix(calls, 'second:').length, 0, 'the second sweep ran again');
  assert.ok(!labels(calls).includes('fix:second:security-08'), 'the unverified finding was fixed on resume');
  assert.deepEqual(result.unverified.map((f) => [f.id, f.unverified]), [['second:security-08', true]]);
  assert.ok(result.second_sweep_findings.every((f) => f.unverified === true));
  assert.ok(result.blocked.some((b) => b.id === 'second:verify:second:security-08'));
  assert.notEqual(result.status, 'stable');
});

test('STABILISE-20 part sweep with a verifier that returned nothing: unverified beside findings, verify:<id> in blocked', async () => {
  const { result } = await runWorkflow(WF, {
    args: args(),
    respond: responder({
      reviews: { security: [finding('security-01', 'critical'), finding('security-02', 'severe')] },
      verdicts: { 'security-02': null },
    }),
  });
  assert.equal(result.status, 'list');
  assert.deepEqual(result.findings.map((f) => f.id), ['security-01']);
  assert.deepEqual(result.unverified.map((f) => f.id), ['security-02']);
  assert.deepEqual(result.blocked, [{ id: 'verify:security-02', reason: 'agent returned nothing' }]);
});

test('STABILISE-21 a first-sweep blocked verify:<id> whose finding the user selected does not stop part fix; the finding is fixed', async () => {
  const sweep = await runWorkflow(WF, {
    args: args(),
    respond: responder({ reviews: { security: [finding('security-01', 'critical')] }, verdicts: { 'security-01': null } }),
  });
  assert.deepEqual(sweep.result.blocked.map((b) => b.id), ['verify:security-01']);
  const selected = JSON.parse(JSON.stringify(sweep.result.unverified));
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected, sweeps: 1 }),
    respond: responder(),
  });
  assert.notEqual(result.status, 'invalid', `${result.errors}`);
  assert.deepEqual(withPrefix(calls, 'fix:'), ['fix:security-01']);
  assert.deepEqual(result.fixed, ['security-01']);
  assert.equal(result.status, 'stable');
});

test('STABILISE-22 second-sweep ids are in the second: namespace; no lens slug makes a first-sweep id look second-sweep', async () => {
  // Second sweep: the reviewer's plain id is put into second:.
  {
    const { calls, result } = await runWorkflow(WF, {
      args: fixArgs({ selected: [finding('security-01', 'critical')] }),
      respond: responder({ second: { security: [finding('security-08', 'severe'), finding('security-09', 'minor')] } }),
    });
    const ids = result.second_sweep_findings.map((f) => f.id);
    assert.deepEqual(ids.sort(), ['second:security-08', 'second:security-09']);
    for (const id of ids) assert.ok(id.startsWith('second:'));
    assert.ok(labels(calls).includes('fix:second:security-08'));
    const p = calls.find((c) => c.opts.label === 'second:review:security').prompt;
    assert.ok(p.includes('`second:security-NN`'), 'the second-sweep reviewer is not told the second: id');
  }
  // First sweep: a lens named like the namespace still gets a slug without a colon.
  {
    const { calls } = await runWorkflow(WF, { args: args({ lenses: ['second: opinion', 'Second:x'] }), respond: responder() });
    for (const c of calls.filter((x) => x.opts.label.startsWith('review:'))) {
      const m = c.prompt.match(/Give each finding an id `([^`]*)`/);
      assert.ok(m, 'no id pattern in the review prompt');
      assert.ok(!m[1].startsWith('second:'), `first-sweep id pattern ${m[1]} is in the second: namespace`);
    }
  }
  // First sweep: a reviewer that writes a second: id anyway is never verified or listed.
  {
    const rogue = finding('second:security-01', 'critical');
    const { calls, result } = await runWorkflow(WF, { args: args(), respond: responder({ reviews: { security: [rogue] } }) });
    assert.ok(!labels(calls).some((l) => l.startsWith('verify:')), 'a second: id was verified in the first sweep');
    assert.deepEqual(result.findings, []);
    assert.ok(result.blocked.some((b) => b.id === 'review:security'));
  }
});

test("STABILISE-23 a selected first-sweep finding from a lens whose slug starts with 'second' is treated as first-sweep and fixed", async () => {
  const f = finding('second-opinion-01', 'critical', { lens: 'second opinion' });
  // Fresh: it is fixed, and the second sweep still runs.
  {
    const { calls, result } = await runWorkflow(WF, {
      args: fixArgs({ selected: [f], lenses: ['second opinion'] }),
      respond: responder(),
    });
    assert.ok(labels(calls).includes('fix:second-opinion-01'));
    assert.ok(result.fixed.includes('second-opinion-01'));
    assert.deepEqual(withPrefix(calls, 'second:review:'), ['second:review:second opinion']);
    assert.equal(result.status, 'stable');
  }
  // Resumed with its trailer in done: still a first-sweep fix, so the second sweep runs.
  {
    const { calls, result } = await runWorkflow(WF, {
      args: fixArgs({ selected: [f], lenses: ['second opinion'], done: ['fix:second-opinion-01'] }),
      respond: responder(),
    });
    assert.deepEqual(withPrefix(calls, 'regress:fix:'), ['regress:fix:second-opinion-01']);
    assert.deepEqual(withPrefix(calls, 'second:review:'), ['second:review:second opinion']);
    assert.ok(!result.blocked.some((b) => b.id === 'second-sweep'), 'the trailer was read as a second-sweep fix');
    assert.equal(result.status, 'stable');
  }
});

test('STABILISE-24 a legacy fix:second-* trailer not in selected proves the second sweep ran: no third sweep, the regression check still runs', async () => {
  const sel = [finding('security-01', 'critical')];
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, done: ['fix:second-security-01'] }),
    respond: responder({ second: { security: [finding('security-09', 'severe')] } }),
  });
  assert.equal(withPrefix(calls, 'second:review:').length, 0, 'the second sweep ran again');
  assert.equal(withPrefix(calls, 'review:').length, 0);
  assert.deepEqual(withPrefix(calls, 'regress:fix:').sort(), ['regress:fix:second-security-01', 'regress:fix:security-01']);
  assert.equal(result.status, 'handover');
});

test('STABILISE-25 on every part fix path, fresh or resumed, no third sweep runs and the regression check never sweeps', async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'minor')];
  const severe = finding('security-08', 'severe');
  const savedSevere = { ...severe, id: 'second:security-08' };
  const paths = [
    { name: 'sweeps 1 fresh', a: fixArgs({ selected: sel, sweeps: 1 }) },
    { name: 'sweeps 1 resumed', a: fixArgs({ selected: sel, sweeps: 1, done: ['fix:security-01', 'fix:security-02'], attempt: 1 }) },
    { name: 'sweeps 2 fresh', a: fixArgs({ selected: sel, sweeps: 2 }) },
    { name: 'no sweeps fresh', a: fixArgs({ selected: sel }) },
    { name: 'sweeps 2 resumed with saved findings', a: fixArgs({ selected: sel, done: ['fix:security-01', 'fix:security-02', 'fix:second:security-08'], second_sweep_findings: [savedSevere], attempt: 2 }) },
    { name: 'resumed, second fix trailer, no saved findings', a: fixArgs({ selected: sel, done: ['fix:security-01', 'fix:second:security-08'], attempt: 1 }) },
    { name: 'legacy trailer', a: fixArgs({ selected: sel, done: ['fix:second-security-08'] }) },
    { name: 'regression found', a: fixArgs({ selected: sel }), regress: (id) => ({ regressions: id === 'security-01' ? [{ fix: id, evidence: 'e' }] : [] }) },
  ];
  for (const p of paths) {
    const { calls } = await runWorkflow(WF, {
      args: p.a,
      respond: responder({ second: { security: [severe] }, ...(p.regress ? { regress: p.regress } : {}) }),
    });
    const reviews = labels(calls).filter((l) => /(^|:)review:/.test(l));
    assert.ok(reviews.length <= 1, `${p.name}: ${reviews.length} sweeps of the one lens: ${reviews}`);
    assert.ok(reviews.every((l) => l.startsWith('second:review:')), `${p.name}: a first sweep ran in part fix: ${reviews}`);
    // The regression check never sweeps: no review or verify agent starts after the last regression
    // agent of a wave, and the regression prompt does not ask for a review.
    for (const c of calls.filter((x) => x.opts.label.startsWith('regress:fix:'))) {
      assert.ok(!/through one lens/.test(c.prompt), `${p.name}: a regression prompt asks for a sweep`);
    }
    const ls = labels(calls);
    const lastRegress = ls.map((l, i) => (l.startsWith('regress:fix:') ? i : -1)).filter((i) => i >= 0);
    const firstRegress = Math.min(...lastRegress);
    if (lastRegress.length > 0) {
      const reviewIdx = ls.findIndex((l) => l.startsWith('second:review:'));
      // A sweep after the first regression wave is the one second sweep; after the second wave, none.
      const afterSecondWave = ls.slice(Math.max(...lastRegress) + 1);
      assert.ok(!afterSecondWave.some((l) => /review:|verify:/.test(l)), `${p.name}: a sweep ran after the regression check`);
      if (reviewIdx >= 0) assert.ok(reviewIdx > firstRegress, `${p.name}: the second sweep ran before the regression check`);
    }
  }
});
