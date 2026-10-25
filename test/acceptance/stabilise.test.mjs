// Acceptance tests for the stabilise group (docs/v1-behaviour.md, STABILISE-01..21).
// They drive the bundled workflows/stabilise.js through the harness with scripted agents, the way the
// head launches it (args from args.json and .temper/project.md, per skills/run/SKILL.md), and read the
// skills and templates for what the head does with the result. A test that fails because of the
// product is skipped with "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from '../harness.mjs';
import { namesField, schemaCases } from '../schema-cases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF = 'workflows/stabilise.js';
const EPIC = 'e';
const DEFAULTS = ['security', 'failure paths and lifecycle', 'test strength and docs'];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const RUN_SKILL = read('skills/run/SKILL.md');
const STAGE4 = RUN_SKILL.slice(RUN_SKILL.indexOf('## Stage 4'), RUN_SKILL.indexOf('## Stage 5'));

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
    lenses: [],
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
const reviewsOf = (calls) => calls.filter((c) => /(^|:)review:/.test(c.opts?.label ?? ''));

// Scripted agents. `reviews[lens]` is what that lens reports (nothing by default); every verify
// reproduces the finding with the reviewer's severity unless `verdicts[id]` overrides it; every fix
// is `fixed` unless `fixes[id]` overrides it. `second` holds the second sweep's reviews by lens.
function responder({ reviews = {}, second = {}, verdicts = {}, fixes = {}, regress = { regressions: [] } } = {}) {
  const all = {};
  for (const fs of [...Object.values(reviews), ...Object.values(second)]) for (const f of fs) all[f.id] = f;
  return ({ label }) => {
    if (label.startsWith('second:review:')) return { findings: second[label.slice('second:review:'.length)] ?? [] };
    if (label.startsWith('review:')) return { findings: reviews[label.slice('review:'.length)] ?? [] };
    const v = label.match(/^(?:second:)?verify:(.*)$/);
    if (v) {
      if (Object.prototype.hasOwnProperty.call(verdicts, v[1])) return verdicts[v[1]];
      return { real: true, severity: all[v[1]].severity, reason: 'reproduced' };
    }
    if (label.startsWith('fix:')) {
      const id = label.slice('fix:'.length);
      if (Object.prototype.hasOwnProperty.call(fixes, id)) return fixes[id];
      return { status: 'fixed', commit: `sha-${id}`, note: 'done' };
    }
    if (label === 'regress' || label === 'regress:fix') return regress;
    throw new Error(`unexpected label ${label}`);
  };
}

// The extra lenses on the `lenses` line of project.md, comma-separated.
function extraLenses(text) {
  const m = text.match(/^lenses:[ \t]*(.*)$/m);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim()).filter((s) => s !== '');
}

// The lenses the head passes, per skills/run/SKILL.md: the default lenses, followed by the
// extras from project.md, leaving out repeats.
function lensesFromProject(text) {
  return [...new Set([...DEFAULTS, ...extraLenses(text)])];
}

// The same workflow run, but with the runtime's documented concurrency: pipeline() sends every item
// through its stages with no barrier between items, and parallel() runs its thunks together
// (notes/official-workflows.md). The harness runs them one after another, so parallelism needs this.
async function runConcurrent(filePath, { args: a, respond }) {
  const source = read(filePath).replace(/export\s+const\s+meta\b/, 'const meta');
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

// Wraps a responder to record, per label prefix, how many such agents were running at once.
function tracking(base, prefix) {
  const state = { now: 0, max: 0, order: [] };
  const respond = async (q) => {
    if (!q.label.startsWith(prefix)) return base(q);
    state.now += 1;
    state.max = Math.max(state.max, state.now);
    state.order.push(`start:${q.label}`);
    await tick();
    state.order.push(`end:${q.label}`);
    state.now -= 1;
    return base(q);
  };
  return { respond, state };
}

test('STABILISE args: every common field the args schema names, and part, lenses and severity_notes, are refused missing or of the wrong type, before any agent (SECOND-TESTS-DOCS-4)', async () => {
  const full = args({ default_branch: 'main', done: ['x1'], lenses: ['security'] });
  const ssh = { ...full, host: { kind: 'ssh', name: 'beast', root: '/srv/temper', clone: '/srv/repo' } };
  const only = ['epic', 'repo', 'branch', 'base', 'default_branch', 'log', 'host', 'gates', 'done'];
  const without = (f) => { const a = { ...full }; delete a[f]; return a; };
  const cases = [
    ...schemaCases(full, { only }),
    ...schemaCases(ssh, { only }).filter((c) => c.name.startsWith('host')),
    { name: 'part missing', args: without('part'), field: 'part' },
    { name: 'part not sweep or fix', args: { ...full, part: 'both' }, field: 'part' },
    { name: 'lenses missing', args: without('lenses'), field: 'lenses' },
    { name: 'lenses a string', args: { ...full, lenses: 'security' }, field: 'lenses' },
    { name: 'a lens a number', args: { ...full, lenses: [7] }, field: 'lenses' },
    { name: 'severity_notes missing', args: without('severity_notes'), field: 'severity_notes' },
    { name: 'severity_notes a number', args: { ...full, severity_notes: 7 }, field: 'severity_notes' },
  ];
  for (const f of only.filter((x) => x !== 'default_branch')) assert.ok(cases.some((c) => c.name === `${f} missing`), `no case for ${f} missing`);
  for (const valid of [full, ssh]) {
    const { result } = await runWorkflow(WF, { args: valid, respond: () => null });
    assert.notEqual(result.status, 'invalid', `the base is valid: ${result.errors}`);
  }
  for (const c of cases) {
    const { result, calls } = await runWorkflow(WF, { args: c.args, respond: () => null });
    assert.equal(calls.length, 0, `${c.name}: an agent was started`);
    assert.equal(result.status, 'invalid', `${c.name}: status`);
    assert.ok(namesField(result.errors, c.field), `${c.name}: no error names ${c.field}: ${result.errors}`);
  }
});

test('STABILISE-01 the first sweep runs one reviewer per lens, in parallel, each in a throwaway worktree', async () => {
  const base = responder({ reviews: { security: [finding('security-01', 'critical')] } });
  const { respond, state } = tracking(base, 'review:');
  const { calls, result } = await runConcurrent(WF, { args: args(), respond });
  assert.equal(result.status, 'list');
  const reviews = reviewsOf(calls);
  assert.equal(reviews.length, DEFAULTS.length);
  assert.equal(state.max, DEFAULTS.length, 'every reviewer should be running at the same time');
  for (const c of reviews) {
    const lens = c.opts.label.slice('review:'.length);
    assert.ok(c.prompt.includes(`one lens: ${lens}`), `review ${lens} names its lens`);
    for (const other of DEFAULTS.filter((l) => l !== lens)) {
      assert.ok(!c.prompt.includes(`lens: ${other}`), `review ${lens} is given only one lens`);
    }
    assert.match(c.prompt, /throwaway worktree/i);
  }
});

test('STABILISE-02 the default lenses run, and extra lenses from project.md run as well', async (t) => {
  await t.test('no extra lenses in project.md: the three defaults run', async () => {
    const template = read('templates/project.md');
    const lenses = lensesFromProject(template);
    const { calls } = await runWorkflow(WF, { args: args({ lenses }), respond: responder() });
    assert.deepEqual(labels(reviewsOf(calls)).sort(), DEFAULTS.map((l) => `review:${l}`).sort());
  });

  await t.test('extra lenses in project.md run as well as the defaults', async () => {
    assert.match(STAGE4, /`lenses` \(the default lenses `security`, `failure paths and lifecycle` and `test strength and docs`, followed by the extra lenses on the `lenses` line of `project\.md`/);
    const project = read('templates/project.md').replace(/^lenses:.*$/m, 'lenses: performance, concurrency');
    assert.deepEqual(extraLenses(project), ['performance', 'concurrency']);
    const lenses = lensesFromProject(project);
    const { calls } = await runWorkflow(WF, { args: args({ lenses }), respond: responder() });
    const got = labels(reviewsOf(calls)).sort();
    assert.deepEqual(got, [...DEFAULTS, 'performance', 'concurrency'].map((l) => `review:${l}`).sort());
  });
});

test('STABILISE-03 a finding without an input and the wrong result it produces is not accepted', async () => {
  const good = finding('security-01', 'critical');
  const vague = finding('security-02', 'critical', { input: '', wrong_result: '', summary: 'looks risky' });
  const noWrongResult = finding('security-03', 'critical', { wrong_result: '  ', summary: 'input but no wrong result' });
  const noInput = finding('security-04', 'critical', { input: '', summary: 'wrong result but no input' });
  const { calls, result } = await runWorkflow(WF, {
    args: args(),
    respond: responder({ reviews: { security: [good, vague, noWrongResult, noInput] } }),
  });
  const schema = reviewsOf(calls)[0].opts.schema;
  const item = schema.properties.findings.items;
  assert.ok(item.required.includes('input') && item.required.includes('wrong_result'));
  const ids = result.findings.map((f) => f.id);
  assert.ok(ids.includes('security-01'));
  assert.ok(!ids.includes('security-02'), 'a finding with an empty input and wrong result reached the list');
  assert.ok(!ids.includes('security-03'), 'a finding with an input but no wrong result reached the list');
  assert.ok(!ids.includes('security-04'), 'a finding with a wrong result but no input reached the list');
});

test('STABILISE-04 a separate agent tries to disprove each finding; disproved ones are dropped, duplicates merged', async () => {
  const a = finding('security-01', 'critical', { summary: 'Token leaks in log' });
  const b = finding('security-02', 'important');
  const dup = finding('failure-paths-and-lifecycle-01', 'critical', {
    lens: 'failure paths and lifecycle', file: a.file, line: a.line, summary: '  token leaks in LOG ',
  });
  const { calls, result } = await runWorkflow(WF, {
    args: args(),
    respond: responder({
      reviews: { security: [a, b], 'failure paths and lifecycle': [dup] },
      verdicts: { 'security-02': { real: false, severity: 'important', reason: 'could not reproduce' } },
    }),
  });
  const verifies = calls.filter((c) => c.opts.label.startsWith('verify:'));
  assert.deepEqual(verifies.map((c) => c.opts.label).sort(), ['verify:failure-paths-and-lifecycle-01', 'verify:security-01', 'verify:security-02']);
  for (const c of verifies) {
    assert.match(c.prompt, /disprove/i);
    assert.match(c.prompt, /reproduce/i);
    assert.ok(!reviewsOf([c]).length, 'the verifier is not the reviewer');
  }
  assert.equal(result.status, 'list');
  assert.ok(!result.findings.some((f) => f.id === 'security-02'), 'a disproved finding reached the list');
  const merged = result.findings.filter((f) => f.file === a.file && f.line === a.line);
  assert.equal(merged.length, 1, 'duplicates should be merged into one');
  assert.equal(result.findings.length, 1);
});

test("STABILISE-05 the verifier re-rates severity against the rubric and the project's notes", async () => {
  const up = finding('security-01', 'minor');
  const down = finding('security-02', 'severe');
  const notes = 'SEVERITY-NOTE: a panic on user input is critical';
  const { calls, result } = await runWorkflow(WF, {
    args: args({ severity_notes: notes }),
    respond: responder({
      reviews: { security: [up, down] },
      verdicts: {
        'security-01': { real: true, severity: 'critical', reason: 'panics on user input' },
        'security-02': { real: true, severity: 'important', reason: 'not a security issue' },
      },
    }),
  });
  const bySev = Object.fromEntries(result.findings.map((f) => [f.id, f.severity]));
  assert.deepEqual(bySev, { 'security-01': 'critical', 'security-02': 'important' });
  for (const c of calls.filter((x) => x.opts.label.startsWith('verify:'))) {
    for (const level of ['Severe', 'Critical', 'Important', 'Minor']) assert.ok(c.prompt.includes(`| ${level} |`), `rubric level ${level}`);
    assert.ok(c.prompt.includes(notes), 'the project severity notes reach the verifier');
    assert.match(c.prompt, /re-rate/i);
  }
});

test('STABILISE-06 the list is ordered Severe first, Minor last, and 4a fixes nothing', async () => {
  const fs = [
    finding('security-01', 'minor'),
    finding('security-02', 'important'),
    finding('security-03', 'severe'),
    finding('security-04', 'critical'),
    finding('security-05', 'minor'),
    finding('security-06', 'severe'),
  ];
  const { calls, result } = await runWorkflow(WF, { args: args(), respond: responder({ reviews: { security: fs } }) });
  assert.equal(result.status, 'list');
  const order = ['severe', 'critical', 'important', 'minor'];
  const ranks = result.findings.map((f) => order.indexOf(f.severity));
  assert.deepEqual(ranks, [...ranks].sort((x, y) => x - y));
  assert.equal(result.findings[0].severity, 'severe');
  assert.equal(result.findings.at(-1).severity, 'minor');
  assert.equal(result.findings.length, fs.length);
  assert.ok(!labels(calls).some((l) => l.startsWith('fix:') || l === 'regress'), 'no fix in 4a');
  for (const c of calls) assert.match(c.prompt, /Change nothing/);
});

test('STABILISE-07 with the user present the head shows the list as a multi-select question box', () => {
  assert.match(STAGE4, /User present:[^\n]*multi-select[^\n]*AskUserQuestion/);
  assert.match(STAGE4, /each option with the finding's id/);
  assert.match(STAGE4, /use more calls for a longer list/);
});

test('STABILISE-08 overnight the head picks by the preferences (default Critical and Important), logs it, and minors go to the open items', () => {
  assert.match(STAGE4, /Overnight: select the findings whose severity is in `overnight_fix_default`[^\n]*log the choice in `log\.md`/);
  assert.match(STAGE4, /every minor finding, go to the open items in `log\.md`/);
  assert.match(read('templates/preferences.md'), /^overnight_fix_default: critical\+important$/m);
  assert.match(read('skills/setup/SKILL.md'), /`overnight_fix_default`[^\n]*`critical\+important`/);
});

test('STABILISE-09 a Minor finding is never fixed in the code in 4b; it goes to the open items', async () => {
  const c = finding('security-01', 'critical');
  const m = finding('security-02', 'minor');
  const { calls, result } = await runWorkflow(WF, { args: fixArgs({ selected: [c, m] }), respond: responder() });
  assert.ok(labels(calls).includes('fix:security-01'));
  assert.ok(!labels(calls).includes('fix:security-02'), 'the minor finding was given to a fix agent');
  assert.ok(!result.fixed.includes('security-02'));
  assert.ok(result.open_items.some((f) => f.id === 'security-02'), 'the minor finding is not in the open items');
});

test('STABILISE-10 the chosen findings are fixed one at a time, in severity order', async () => {
  const sel = [finding('security-01', 'important'), finding('security-02', 'severe'), finding('security-03', 'critical')];
  const { respond, state } = tracking(responder(), 'fix:');
  const { calls } = await runConcurrent(WF, { args: fixArgs({ selected: sel }), respond });
  assert.deepEqual(labels(calls).filter((l) => l.startsWith('fix:')), ['fix:security-02', 'fix:security-03', 'fix:security-01']);
  assert.equal(state.max, 1, 'two fixes ran at the same time');
  assert.deepEqual(state.order, [
    'start:fix:security-02', 'end:fix:security-02',
    'start:fix:security-03', 'end:fix:security-03',
    'start:fix:security-01', 'end:fix:security-01',
  ]);
});

const FIX_STEPS_ORDER = (p) => [
  p.indexOf('git blame'),
  p.indexOf('A failing test first'),
  p.indexOf('The smallest fix'),
  p.indexOf('Impact check'),
  p.indexOf('revert and rethink'),
];

async function oneFixPrompt(extra = {}) {
  const f = finding('security-01', 'critical');
  const { calls, result } = await runWorkflow(WF, { args: fixArgs({ selected: [f], ...extra }), respond: responder() });
  return { prompt: calls.find((c) => c.opts.label === 'fix:security-01').prompt, call: calls.find((c) => c.opts.label === 'fix:security-01'), result };
}

test('STABILISE-11 a fix starts by tracing its origin: git blame, the Temper-Task trailer, the task and its contract', async () => {
  const { prompt, call } = await oneFixPrompt();
  assert.match(prompt, /Trace its origin:\*\* `git blame` leads to the `Temper-Task` trailer, which leads to the task and its contract/);
  const steps = FIX_STEPS_ORDER(prompt);
  assert.ok(steps.every((i) => i > -1));
  assert.ok(steps[0] < steps[1], 'the origin is traced before anything else');
  assert.ok(call.opts.schema.properties.origin_task, 'the fix reports the origin task');
});

test('STABILISE-12 a wrong contract goes to the user or the spec, never into a quiet code fix', async () => {
  const f1 = finding('security-01', 'critical');
  const f2 = finding('security-02', 'important');
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: [f1, f2] }),
    respond: responder({ fixes: { 'security-01': { status: 'contract', origin_task: 't3', note: 'the contract is wrong' } } }),
  });
  const prompt = calls.find((c) => c.opts.label === 'fix:security-01').prompt;
  assert.match(prompt, /If the contract is wrong, return status contract and change nothing/);
  assert.deepEqual(result.contract_items, ['security-01']);
  assert.ok(!result.fixed.includes('security-01'));
  assert.match(STAGE4, /`contract_items`: the contract is wrong\. Take each to the user or the spec, never into a quiet code fix\./);
});

test('STABILISE-13 a fix writes a failing test first, then the smallest fix', async () => {
  const { prompt } = await oneFixPrompt();
  const [, test1, small] = FIX_STEPS_ORDER(prompt);
  assert.ok(test1 > -1 && small > -1);
  assert.ok(test1 < small, 'the failing test comes before the fix');
  assert.ok(prompt.includes('`Temper-Task: e/fix:security-01`'), 'the fix commits with its trailer');
});

test("STABILISE-14 a fix is checked against the plan's dependants, then the whole acceptance suite and the quick gate", async () => {
  const { prompt } = await oneFixPrompt();
  const dep = prompt.indexOf("the dependants from the plan's contract graph");
  const suite = prompt.indexOf('the whole acceptance suite');
  const gate = prompt.indexOf('the quick gate', suite);
  assert.ok(dep > -1 && suite > dep && gate > suite, 'dependants, then the suite, then the quick gate');
  assert.ok(prompt.indexOf('The smallest fix') < dep, 'the impact check follows the fix');
  assert.ok(prompt.includes('QUICK-GATE-CMD'), 'the quick gate command is given');
});

test('STABILISE-15 a fix that breaks something is reverted and rethought; the next one starts only after it', async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'important')];
  const base = responder({ fixes: { 'security-01': { status: 'reverted', note: 'broke test x; reverted' } } });
  const { respond, state } = tracking(base, 'fix:');
  const { calls, result } = await runConcurrent(WF, { args: fixArgs({ selected: sel }), respond });
  const prompt = calls.find((c) => c.opts.label === 'fix:security-01').prompt;
  assert.match(prompt, /If anything else breaks, revert and rethink\. Move on only when this item is clean\./);
  assert.deepEqual(result.reverted, ['security-01']);
  assert.ok(!result.fixed.includes('security-01'));
  assert.equal(state.max, 1);
  assert.ok(state.order.indexOf('end:fix:security-01') < state.order.indexOf('start:fix:security-02'));
});

test('STABILISE-16 the second sweep uses fresh agents told what was already fixed', async () => {
  const sel = [finding('security-01', 'critical'), finding('security-02', 'important')];
  const { calls } = await runWorkflow(WF, {
    args: fixArgs({ selected: sel, done: ['fix:security-02'] }),
    respond: responder(),
  });
  const ls = labels(calls);
  const second = reviewsOf(calls);
  assert.deepEqual(labels(second).sort(), DEFAULTS.map((l) => `second:review:${l}`).sort());
  assert.ok(ls.indexOf(second[0].opts.label) > ls.indexOf('fix:security-01'), 'the second sweep runs after the fixes');
  for (const c of second) {
    assert.match(c.prompt, /already fixed/);
    assert.ok(c.prompt.includes('security-01'), 'told about the fix from this run');
    assert.ok(c.prompt.includes('security-02'), 'told about the fix from an earlier run');
  }
});

test('STABILISE-17 nothing severe in the second sweep: the stage is done and the rest go to the open items', async () => {
  const c = finding('second-security-01', 'critical');
  const m = finding('second-security-02', 'minor');
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: [finding('security-01', 'important')] }),
    respond: responder({ second: { security: [c, m] } }),
  });
  assert.equal(result.status, 'stable');
  assert.deepEqual(result.open_items.map((f) => f.id).sort(), ['second-security-01', 'second-security-02']);
  const ls = labels(calls);
  assert.ok(!ls.includes('fix:second-security-01') && !ls.includes('fix:second-security-02'));
  assert.ok(!ls.includes('regress'));
  assert.match(STAGE4, /`open_items`: append them to the open items in `log\.md`/);
  assert.match(STAGE4, /`status: "stable"`: go to stage 5/);
});

test('STABILISE-18 something severe in the second sweep: fixed with the five steps, only those diffs checked, then hand over', async () => {
  const s = finding('second-security-01', 'severe');
  const m = finding('second-security-02', 'minor');
  const { calls, result } = await runWorkflow(WF, {
    args: fixArgs({ selected: [finding('security-01', 'critical')] }),
    respond: responder({ second: { security: [s, m] } }),
  });
  const ls = labels(calls);
  const fix = calls.find((c) => c.opts.label === 'fix:second-security-01');
  assert.ok(fix, 'the severe finding is fixed');
  assert.ok(FIX_STEPS_ORDER(fix.prompt).every((i) => i > -1), 'with the same five steps');
  const regress = calls.filter((c) => c.opts.label === 'regress');
  assert.equal(regress.length, 1);
  assert.ok(ls.indexOf('regress') > ls.indexOf('fix:second-security-01'));
  assert.ok(regress[0].prompt.includes('Temper-Task: e/fix:second-security-01'));
  assert.ok(!regress[0].prompt.includes('Temper-Task: e/fix:security-01'), 'only the second-sweep fixes are checked');
  assert.match(regress[0].prompt, /Check only the diffs/);
  assert.ok(!ls.includes('fix:second-security-02'));
  assert.equal(result.status, 'handover');
  assert.match(STAGE4, /`status: "handover"`[^\n]*Stop, record it in `log\.md`, and hand over to the user/);
});

test('STABILISE-19 there is never a third sweep', async (t) => {
  const lensCount = DEFAULTS.length;
  for (const [name, second] of [['stable', {}], ['handover', { security: [finding('second-security-01', 'severe')] }]]) {
    await t.test(`after a ${name} second sweep, the run ends with no further review`, async () => {
      const { calls, result } = await runWorkflow(WF, {
        args: fixArgs({ selected: [finding('security-01', 'critical')] }),
        respond: responder({ second }),
      });
      assert.equal(result.status, name);
      assert.equal(reviewsOf(calls).length, lensCount, 'exactly one sweep in part fix');
      const ls = labels(calls);
      const lastReview = Math.max(...reviewsOf(calls).map((c) => ls.indexOf(c.opts.label)));
      assert.ok(!ls.slice(lastReview + 1).some((l) => /review:/.test(l)));
    });
  }

  await t.test('the head never starts another sweep after a handover', () => {
    assert.match(STAGE4, /There is never a third sweep\./);
  });

  await t.test('resuming the stage after the second sweep ran does not sweep again', async () => {
    // Run 1 (4a) and run 2 (4b with a severe second-sweep finding) as the head launches them.
    const sev = finding('second-security-01', 'severe');
    const first = await runWorkflow(WF, { args: args(), respond: responder({ reviews: { security: [finding('security-01', 'critical')] } }) });
    const selected = first.result.findings;
    const second = await runWorkflow(WF, { args: fixArgs({ selected }), respond: responder({ second: { security: [sev] } }) });
    assert.equal(second.result.status, 'handover');
    // The head resumes (e.g. after a usage-limit stop) with args.done refreshed from the trailers.
    const done = ['fix:security-01', 'fix:second-security-01'];
    const resumed = await runWorkflow(WF, { args: fixArgs({ selected, done }), respond: responder({ second: { security: [sev] } }) });
    const sweeps = [first, second, resumed].reduce((n, r) => n + (reviewsOf(r.calls).length > 0 ? 1 : 0), 0);
    assert.ok(sweeps <= 2, `${sweeps} sweeps ran across the stage`);
  });

  await t.test('with the ids the reviewers are told to use, a resume after the second sweep does not sweep again', async () => {
    // A real reviewer names its finding as its prompt says, and the resume guard relies on that id,
    // so here the security reviewer takes the id from its prompt instead of a scripted one.
    const asTold = () => {
      const seen = {};
      return (call) => {
        const r = call.label.match(/^(second:)?review:security$/);
        if (r) {
          const m = call.prompt.match(/Give each finding an id `([^`]*)-NN`/);
          assert.ok(m, 'the review prompt says how to name the ids');
          const f = finding(`${m[1]}-01`, r[1] ? 'severe' : 'critical');
          seen[f.id] = f;
          return { findings: [f] };
        }
        return responder({ reviews: { security: Object.values(seen) } })(call);
      };
    };
    const first = await runWorkflow(WF, { args: args(), respond: asTold() });
    const selected = first.result.findings;
    const second = await runWorkflow(WF, { args: fixArgs({ selected }), respond: asTold() });
    assert.equal(second.result.status, 'handover');
    // The head refreshes args.done from the fix trailers the two runs committed.
    const done = [...new Set([first, second].flatMap((r) => labels(r.calls).filter((l) => /^fix:/.test(l))))];
    const resumed = await runWorkflow(WF, { args: fixArgs({ selected, done }), respond: asTold() });
    const sweeps = [first, second, resumed].reduce((n, r) => n + (reviewsOf(r.calls).length > 0 ? 1 : 0), 0);
    assert.ok(sweeps <= 2, `${sweeps} sweeps ran across the stage`);
  });

  // The head saves a fix run's second-sweep findings in args and passes them on every resume.
  const resumeAfter = (run, extra) => runWorkflow(WF, {
    args: fixArgs({ second_sweep_findings: run.result.second_sweep_findings, ...extra }),
    respond: responder(),
  });

  await t.test('a severe second-sweep finding left blocked is not lost on resume', async () => {
    const selected = [finding('security-01', 'critical')];
    const s1 = finding('second-security-01', 'severe');
    const s2 = finding('second-security-02', 'severe');
    const run = await runWorkflow(WF, {
      args: fixArgs({ selected }),
      respond: responder({ second: { security: [s1, s2] }, fixes: { 'second-security-02': null } }),
    });
    assert.ok(run.result.blocked.some((b) => b.id === 'second-security-02'));
    assert.match(STAGE4, /`second_sweep_findings`/);
    const resumed = await resumeAfter(run, { selected, done: ['fix:security-01', 'fix:second-security-01'] });
    assert.equal(reviewsOf(resumed.calls).length, 0, 'the resume swept again');
    assert.ok(labels(resumed.calls).includes('fix:second-security-02'), 'the blocked severe finding is fixed on resume');
    assert.equal(resumed.result.status, 'handover');
    assert.equal(resumed.result.second_sweep.severe, 2);
  });

  await t.test('a resume after a second sweep with no committed fix does not sweep again', async () => {
    const selected = [finding('security-01', 'critical')];
    const s1 = finding('second-security-01', 'severe');
    const m1 = finding('second-security-02', 'minor');
    const run = await runWorkflow(WF, {
      args: fixArgs({ selected }),
      respond: responder({ second: { security: [s1, m1] }, fixes: { 'second-security-01': { status: 'blocked', note: 'q' } } }),
    });
    assert.equal(run.result.status, 'handover');
    const resumed = await resumeAfter(run, { selected, done: ['fix:security-01'] });
    assert.equal(reviewsOf(resumed.calls).length, 0, 'a third sweep ran');
    assert.ok(labels(resumed.calls).includes('fix:second-security-01'));
    assert.deepEqual(resumed.result.open_items.map((f) => f.id), ['second-security-02']);
  });

  await t.test('a second-sweep trailer without the saved findings never sweeps again or guesses', async () => {
    const { calls, result } = await runWorkflow(WF, {
      args: fixArgs({ selected: [finding('security-01', 'critical')], done: ['fix:security-01', 'fix:second-security-01'] }),
      respond: responder(),
    });
    assert.equal(reviewsOf(calls).length, 0, 'the resume swept again');
    assert.deepEqual(labels(calls), ['regress'], 'the committed severe second-sweep fix got no regression check');
    assert.ok(calls[0].prompt.includes('Temper-Task: e/fix:second-security-01'));
    assert.ok(!calls[0].prompt.includes('Temper-Task: e/fix:security-01'), 'only the second-sweep fixes are checked');
    assert.equal(result.status, 'handover');
    assert.deepEqual(result.blocked, [{ id: 'second-sweep', reason: 'done but args.second_sweep_findings missing' }]);
  });
});

test('STABILISE-20 a Severe finding contacts the user per severe_contact', async (t) => {
  await t.test('the preference offers a push, the morning report only, or a push for anything blocking', () => {
    assert.match(read('templates/preferences.md'), /^severe_contact: (report|push|push-blocking)$/m);
    assert.match(read('skills/setup/SKILL.md'), /`severe_contact`[^\n]*`report`[^\n]*`push`[^\n]*`push-blocking`/);
  });

  await t.test('a Severe finding in the stage 4 list reaches the user per severe_contact', () => {
    // From the 4a list to choosing the fixes: what the head does when the list holds a Severe finding.
    const choosing = STAGE4.slice(STAGE4.indexOf('1. **4a.**'), STAGE4.indexOf('3. **4b.**'));
    assert.match(choosing, /severe/i);
    assert.match(choosing, /severe_contact/);
  });
});

test('STABILISE-21 fixes committed with their trailers are not redone on resume', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'temper-acc-stabilise-'));
  try {
    const gitconfig = join(dir, 'gitconfig');
    writeFileSync(gitconfig, '');
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      CLAUDE_CONFIG_DIR: join(dir, 'claude-config'),
    };
    const repo = join(dir, 'repo');
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', repo, ...a], { env, encoding: 'utf8' });
    execFileSync('git', ['init', '--quiet', '-b', 'main', repo], { env });
    git('commit', '--quiet', '--allow-empty', '-m', 'initial');
    git('checkout', '--quiet', '-b', 'temper/e');

    const sel = [finding('security-01', 'critical'), finding('security-02', 'important')];
    // The first 4b run committed security-01's fix with its trailer, then stopped.
    const run1 = await runWorkflow(WF, {
      args: fixArgs({ repo, selected: sel }),
      respond: (q) => {
        if (q.label === 'fix:security-01') {
          assert.ok(q.prompt.includes('`Temper-Task: e/fix:security-01`'));
          git('commit', '--quiet', '--allow-empty', '-m', 'fix: security-01', '-m', 'Temper-Task: e/fix:security-01');
        }
        return responder()(q);
      },
    });
    assert.ok(run1.result.fixed.includes('security-01'));

    const done = JSON.parse(execFileSync('python3', [join(ROOT, 'scripts/done_tasks.py'), repo, 'temper/e', 'main', EPIC], { env, encoding: 'utf8' }));
    assert.deepEqual(done, ['fix:security-01']);

    const { calls } = await runWorkflow(WF, { args: fixArgs({ repo, selected: sel, done }), respond: responder() });
    const ls = labels(calls);
    assert.ok(!ls.includes('fix:security-01'), 'a committed fix ran again');
    assert.ok(ls.includes('fix:security-02'));
    for (const c of reviewsOf(calls)) assert.ok(c.prompt.includes('security-01'), 'the second sweep still knows it was fixed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a blocked fix's answer reaches only its own fix prompt on resume, and the one second sweep runs after it (spec 3.6, 3.5, SECOND-CONTROL-FLOW-4)", async (t) => {
  const selected = [finding('security-01', 'critical'), finding('security-02', 'important')];

  await t.test('the head passes the answers to part fix, keyed by finding id', () => {
    assert.match(STAGE4, /`answers`[^\n]*finding id/);
  });

  await t.test('the answer is put into its own fix prompt and into no other', async () => {
    const run = await runWorkflow(WF, {
      args: fixArgs({ selected }),
      respond: responder({ fixes: { 'security-01': { status: 'blocked', note: 'which behaviour?' } } }),
    });
    assert.equal(run.result.status, 'blocked');
    assert.deepEqual(run.result.blocked.map((b) => b.id), ['security-01']);
    assert.equal(reviewsOf(run.calls).length, 0, 'the second sweep ran on a branch missing a selected fix');
    const resumed = await runWorkflow(WF, {
      args: fixArgs({
        selected,
        done: ['fix:security-02'],
        answers: { 'security-01': 'ANSWER-do-X' },
      }),
      respond: responder(),
    });
    const fix = resumed.calls.find((c) => c.opts?.label === 'fix:security-01');
    assert.ok(fix, 'the answered fix did not run again');
    assert.ok(fix.prompt.includes('Answer from the head:') && fix.prompt.includes('ANSWER-do-X'), 'the answer never reached the fix agent');
    const ls = labels(resumed.calls);
    assert.ok(ls.indexOf('regress:fix') > ls.indexOf('fix:security-01'), 'the resolved fix got no regression check');
    assert.equal(reviewsOf(resumed.calls).length, DEFAULTS.length, 'the second sweep did not run exactly once');
    assert.ok(reviewsOf(resumed.calls).every((c) => ls.indexOf(c.opts.label) > ls.indexOf('regress:fix')));
    assert.deepEqual(resumed.result.fixed, ['security-01']);
    assert.deepEqual(resumed.result.blocked, []);
    assert.equal(resumed.result.status, 'stable');

    const other = await runWorkflow(WF, {
      args: fixArgs({ selected, answers: { 'security-01': 'ANSWER-do-X' }, second_sweep_findings: [] }),
      respond: responder(),
    });
    const otherFix = other.calls.find((c) => c.opts?.label === 'fix:security-02');
    assert.ok(!otherFix.prompt.includes('ANSWER-do-X') && !otherFix.prompt.includes('Answer from the head:'));
  });

  await t.test('answers that are not an object of strings are refused before any agent runs', async () => {
    for (const answers of [[], 'x', { 'security-01': 3 }]) {
      const { calls, result } = await runWorkflow(WF, { args: fixArgs({ selected, answers }), respond: responder() });
      assert.equal(result.status, 'invalid', JSON.stringify(answers));
      assert.equal(calls.length, 0);
    }
  });
});
