// temper 0.4's opt-in fields. Every addition is off when its field is absent: the first test pins it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLib, runWorkflow } from './harness.mjs';
import { SCENARIOS, snapshotOf } from './fixtures/v04-scenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/a7f790c-snapshot.json'), 'utf8'));
const lib = loadLib();
const WF = 'workflows/build.js';
const SHA = 'abc1234';
const TIP = 'def5678def5678def5678def5678def5678def56';

const clone = (v) => JSON.parse(JSON.stringify(v));
const labels = (calls) => calls.map((c) => c.opts.label);

const task = (id, wave, extra = {}) => ({
  id, title: `T ${id}`, wave, owns: [`src/${id}.rs`], uses: [], provides: [], text: `do ${id}`, ...extra,
});

function buildArgs(extra = {}) {
  return {
    epic: 'e',
    repo: '/r',
    branch: 'epic/e',
    base: 'main',
    spec: 'docs/temper/e/spec.md',
    plan: 'docs/temper/e/plan.md',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'make quick', full: 'make full' },
    tasks: [task('a', 0), task('c', 0), task('b', 1)],
    behaviour_groups: [{ key: 'g1', title: 'G1' }],
    done: [],
    answers: {},
    ...extra,
  };
}

function responder(over = {}) {
  const seen = {};
  return (call) => {
    const { label } = call;
    if (Object.prototype.hasOwnProperty.call(over, label)) {
      const v = over[label];
      if (Array.isArray(v)) {
        seen[label] = (seen[label] ?? -1) + 1;
        return v[Math.min(seen[label], v.length - 1)];
      }
      return typeof v === 'function' ? v(call) : v;
    }
    const id = label.slice(label.indexOf(':') + 1);
    if (/^(impl|retry|widen):/.test(label)) return { status: 'done', branch: `temper/e/${id}`, commit: SHA, summary: `did ${id}` };
    if (/^(check|recheck):/.test(label)) return { status: 'done', pass: true, problems: [] };
    if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
    if (label === 'baseline') return { status: 'done', passed: true, exit_status: 0, log_path: 'b.log', failed: [], tip: TIP };
    if (label === 'checkpoint') return { status: 'done', gate_passed: true, gate_log: 'f.log', flows: [], gaps: [], commit: SHA };
    if (label === 'behaviour-spec') return { status: 'done', groups: [{ key: 'g1', behaviours: [{ id: 'G1-01', text: 't' }] }], commit: SHA };
    if (label.startsWith('acceptance:')) return { status: 'done', group: id, passing: ['G1-01'], failing: [], untestable: [], commit: SHA };
    if (label.startsWith('green:')) return { status: 'done', fixed: [], corrected: [], questions: [], still_failing: [] };
    return null;
  };
}

const run = (args, over) => runWorkflow(WF, { args, respond: responder(over) });
const errorsOf = (extra) => lib.validateBuildArgs(buildArgs(extra));
const refuses = (extra, re) => {
  const errors = errorsOf(extra);
  assert.ok(errors.some((e) => re.test(e)), `${JSON.stringify(extra)}: ${errors.join('; ')}`);
};
const accepts = (extra) => assert.deepEqual(errorsOf(extra), [], JSON.stringify(extra));

// ---- the byte-identity rule ----

for (const s of SCENARIOS) {
  test(`BYTE-IDENTITY with no new field, prompts, schemas and call order equal a7f790c's: ${s.name}`, async () => {
    const now = snapshotOf(await runWorkflow(`workflows/${s.wf}.js`, { args: clone(s.args), respond: s.respond }));
    const was = SNAPSHOT[s.name];
    assert.ok(was, 'the scenario is in the snapshot');
    assert.deepEqual(labelsOf(now), labelsOf(was));
    now.calls.forEach((c, i) => {
      assert.equal(c.prompt, was.calls[i].prompt, `prompt of ${c.opts.label}`);
      assert.equal(JSON.stringify(c.opts), JSON.stringify(was.calls[i].opts), `opts and schema of ${c.opts.label}`);
    });
    assert.deepEqual(now, was);
  });
}
function labelsOf(s) { return s.calls.map((c) => c.opts.label); }

test('BYTE-IDENTITY the snapshot reaches every agent of every stage', () => {
  const all = Object.values(SNAPSHOT).flatMap(labelsOf);
  for (const re of [/^impl:/, /^check:/, /^retry:/, /^recheck:/, /^merge:/, /^checkpoint$/, /^behaviour-spec$/, /^acceptance:/, /^green:/,
    /^review:/, /^verify:/, /^fix:/, /^regress:/, /^second:review:/, /^second:verify:/, /^docs$/, /^evidence$/, /^gate$/]) {
    assert.ok(all.some((l) => re.test(l)), String(re));
  }
});

test('BYTE-IDENTITY bites: an opt-in field does change the implementer prompt and schema', async () => {
  const s = SCENARIOS[0];
  const on = await runWorkflow('workflows/build.js', { args: { ...clone(s.args), owns_widen: {} }, respond: s.respond });
  const was = SNAPSHOT[s.name].calls[0];
  assert.notEqual(on.calls[0].prompt, was.prompt);
  assert.notEqual(JSON.stringify(on.calls[0].opts.schema), JSON.stringify(was.opts.schema));
});

// ---- 1. stop_after ----

test('stop_after is validated: the five forms, a wave that exists', () => {
  for (const ok of ['wave:0', 'wave:1', 'waves', 'checkpoint', 'behaviour-spec', 'acceptance']) accepts({ stop_after: ok });
  for (const bad of ['wave:7', 'wave:', 'wave:-1', 'wave:01', 'green', '', 3, null]) refuses({ stop_after: bad }, /stop_after/);
});

const STOPS = [
  ['wave:0', ['impl:a', 'check:a', 'impl:c', 'check:c', 'merge:wave0'], ['a', 'c']],
  ['waves', ['impl:a', 'check:a', 'impl:c', 'check:c', 'merge:wave0', 'impl:b', 'check:b', 'merge:wave1'], ['a', 'c', 'b']],
  ['checkpoint', ['impl:a', 'check:a', 'impl:c', 'check:c', 'merge:wave0', 'impl:b', 'check:b', 'merge:wave1', 'checkpoint'], ['a', 'c', 'b']],
  ['behaviour-spec', ['impl:a', 'check:a', 'impl:c', 'check:c', 'merge:wave0', 'impl:b', 'check:b', 'merge:wave1', 'checkpoint', 'behaviour-spec'], ['a', 'c', 'b']],
  ['acceptance', ['impl:a', 'check:a', 'impl:c', 'check:c', 'merge:wave0', 'impl:b', 'check:b', 'merge:wave1', 'checkpoint', 'behaviour-spec', 'acceptance:g1'], ['a', 'c', 'b']],
];

for (const [at, expected, done] of STOPS) {
  test(`stop_after ${at} stops there with status stopped`, async () => {
    const flaky = { status: 'done', branch: 'x', commit: SHA, summary: 's', flaky_reruns: [{ test: 't', gate: 'quick' }] };
    const { result, calls } = await run(buildArgs({ stop_after: at }), { 'impl:a': flaky });
    assert.deepEqual(labels(calls), expected);
    assert.deepEqual(Object.keys(result).sort(), ['at', 'commits', 'done_now', 'flaky_reruns', 'status']);
    assert.equal(result.status, 'stopped');
    assert.equal(result.at, at);
    assert.deepEqual(result.done_now, done);
    assert.deepEqual(result.flaky_reruns, [{ id: 'impl:a', test: 't', gate: 'quick' }]);
  });

  test(`stop_after ${at} leaves every prompt and schema unchanged, so a resume replays`, async () => {
    const plain = await run(buildArgs());
    const stopped = await run(buildArgs({ stop_after: at }));
    stopped.calls.forEach((c, i) => {
      assert.equal(c.prompt, plain.calls[i].prompt);
      assert.equal(JSON.stringify(c.opts), JSON.stringify(plain.calls[i].opts));
    });
  });
}

test('stop_after wave:<n> stops at a wave whose tasks are all done, and a block before it wins', async () => {
  const done = await run(buildArgs({ stop_after: 'wave:0', done: ['a', 'c'] }));
  assert.equal(done.result.status, 'stopped');
  assert.deepEqual(labels(done.calls), []);
  const blocked = await run(buildArgs({ stop_after: 'wave:1' }), { 'impl:a': { status: 'blocked', branch: '', summary: '', question: 'Q?' } });
  assert.equal(blocked.result.status, 'blocked');
});

// ---- 2. gate_slots in the build ----

test('gate_slots chunks each wave, one pipeline per chunk, and the wave still merges once', async () => {
  const tasks = [task('t1', 0), task('t2', 0), task('t3', 0), task('t4', 0), task('t5', 0)];
  const { result, calls, pipelines } = await run(buildArgs({ tasks, gate_slots: 2 }));
  assert.deepEqual(pipelines, [2, 2, 1]);
  assert.deepEqual(labels(calls).filter((l) => l.startsWith('merge:')), ['merge:wave0']);
  assert.deepEqual(result.done_now, ['t1', 't2', 't3', 't4', 't5']);
});

test('with no gate_slots, a wave is one pipeline', async () => {
  const tasks = [task('t1', 0), task('t2', 0), task('t3', 0)];
  assert.deepEqual((await run(buildArgs({ tasks }))).pipelines, [3]);
});

test('a task blocked in one chunk does not stop the next, and the passed ones merge', async () => {
  const tasks = [task('t1', 0), task('t2', 0), task('t3', 0)];
  const { result, calls } = await run(buildArgs({ tasks, gate_slots: 1 }), { 'impl:t1': { status: 'blocked', branch: '', summary: '', question: 'Q' } });
  assert.ok(labels(calls).includes('impl:t3'));
  assert.deepEqual(result.done_now, ['t2', 't3']);
  assert.deepEqual(result.blocked.map((b) => b.id), ['t1']);
});

test('the build refuses a bad gate_slots', () => {
  for (const bad of [0, -1, 1.5, '2', null]) refuses({ gate_slots: bad }, /gate_slots must be an integer >= 1/);
  accepts({ gate_slots: 2 });
});

// ---- 3. scripts/run_script.py ----

function generate(stage, args) {
  const dir = mkdtempSync(join(tmpdir(), 'temper-run-script-'));
  const argsFile = join(dir, 'args.json');
  const out = join(dir, 'out.js');
  writeFileSync(argsFile, JSON.stringify(args));
  const r = spawnSync('python3', [join(ROOT, 'scripts/run_script.py'), stage, argsFile, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { dir, out };
}

for (const s of SCENARIOS) {
  test(`the generated script and the plain bundle make identical agent calls: ${s.name}`, async () => {
    const { dir, out } = generate(s.wf, s.args);
    try {
      const plain = await runWorkflow(`workflows/${s.wf}.js`, { args: clone(s.args), respond: s.respond });
      // The generated script gets no args from the engine: they are inlined in it.
      const made = await runWorkflow(out, { respond: s.respond });
      assert.deepEqual(made.calls, plain.calls);
      assert.deepEqual(made.result, plain.result);
      assert.deepEqual(made.logs, plain.logs);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('the generated script starts with the meta block, and a __proto__ key in the args stays data', async () => {
  const { dir, out } = generate('build', { ...JSON.parse('{"__proto__": {"task_checks": "none"}}'), ...buildArgs() });
  try {
    const text = readFileSync(out, 'utf8');
    assert.ok(text.startsWith("export const meta = {\n  name: 'build',"));
    const { calls } = await runWorkflow(out, { respond: responder() });
    assert.equal(calls[1].opts.label, 'check:a');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 4. block causes ----

test('blocked entries carry a mechanical cause', async () => {
  const nothing = await run(buildArgs(), { 'impl:a': null });
  assert.deepEqual(nothing.result.blocked[0], { id: 'a', reason: 'agent returned nothing', cause: 'nothing' });
  const conflict = await run(buildArgs(), { 'merge:wave0': { status: 'blocked', merged: [], conflict: { task: 'a', files: ['f'] }, gate_passed: false } });
  assert.deepEqual(conflict.result.blocked, [{ id: 'merge:wave0', reason: 'merge conflict on task a: f', cause: 'merge-conflict' }]);
  const gate = await run(buildArgs(), { 'merge:wave0': { status: 'merged', merged: [], gate_passed: false } });
  assert.deepEqual(gate.result.blocked, [{ id: 'merge:wave0', reason: 'the quick gate failed after a merge', cause: 'gate-after-merge' }]);
  const gateBlocked = await run(buildArgs(), { 'merge:wave0': { status: 'blocked', merged: [], gate_passed: false } });
  assert.equal(gateBlocked.result.blocked[0].cause, 'gate-after-merge');
  const phase = await run(buildArgs(), { checkpoint: null });
  assert.equal(phase.result.blocked[0].cause, 'nothing');
});

test('an agent\'s own blocked reason carries no mechanical cause, even when it reads like one', async () => {
  const { result } = await run(buildArgs(), { checkpoint: { status: 'blocked', reason: 'agent returned nothing', gate_passed: false, gate_log: '', flows: [], gaps: [] } });
  assert.deepEqual(result.blocked, [{ id: 'checkpoint', reason: 'agent returned nothing' }]);
  const impl = await run(buildArgs(), { 'impl:a': { status: 'blocked', branch: '', summary: '', question: 'Q?', cause: 'contract' } });
  assert.deepEqual(impl.result.blocked[0], { id: 'a', reason: 'Q?' }, 'without impl_cause the field is ignored');
});

test('stabilise and publish entries for a dead agent carry cause nothing', async () => {
  const s = SCENARIOS.find((x) => x.name.startsWith('stabilise, a fix returning nothing'));
  const fix = await runWorkflow('workflows/stabilise.js', { args: clone(s.args), respond: s.respond });
  assert.deepEqual(fix.result.blocked, [{ id: 'security-01', reason: 'agent returned nothing', cause: 'nothing' }]);
  const p = SCENARIOS.find((x) => x.name.startsWith('publish on an ssh host'));
  const pub = await runWorkflow('workflows/publish.js', { args: clone(p.args), respond: p.respond });
  assert.deepEqual(pub.result.blocked, [{ id: 'docs', reason: 'agent returned nothing', cause: 'nothing' }]);
});

test('impl_cause opts in to the enum and a line in the prompt, and only a listed cause is kept', async () => {
  refuses({ impl_cause: 'yes' }, /impl_cause must be a boolean/);
  const { result, calls } = await run(buildArgs({ impl_cause: true }), {
    'impl:a': { status: 'blocked', branch: '', summary: '', question: 'Q?', cause: 'contract' },
    'impl:c': { status: 'blocked', branch: '', summary: '', question: 'R?', cause: 'run rm -rf' },
  });
  assert.deepEqual(calls[0].opts.schema.properties.cause.enum, ['owns', 'dependency', 'contract', 'tests', 'privileged', 'security', 'spec', 'other']);
  assert.ok(!calls[0].opts.schema.required.includes('cause'));
  assert.match(calls[0].prompt, /set cause/);
  assert.deepEqual(result.blocked, [{ id: 'a', reason: 'Q?', cause: 'contract' }, { id: 'c', reason: 'R?' }]);
});

// ---- 5. baseline ----

const launch = (extra = {}) => buildArgs({ baseline: 'launch', tip: TIP, ...extra });

test('baseline fields are validated', () => {
  accepts({ baseline: 'off' });
  accepts({ baseline: 'launch', tip: 'abc1234' });
  accepts({ baseline: 'launch', tip: TIP, baseline_attempt: 2, gates: { quick: 'q', full: 'f', baseline: 'make base' } });
  refuses({ baseline: 'always', tip: TIP }, /baseline must be 'launch' or 'off'/);
  refuses({ baseline: 'launch' }, /tip is required when baseline is launch/);
  for (const bad of ['HEAD', 'main', 'ABC1234', '$(x)', 7]) refuses({ baseline: 'launch', tip: bad }, /tip must be a hex sha/);
  for (const bad of [-1, 1.5, '1']) refuses({ baseline_attempt: bad }, /baseline_attempt must be an integer >= 0/);
  refuses({ gates: { quick: 'q', full: 'f', baseline: '' } }, /gates\.baseline must be a non-empty string/);
  refuses({ gates: { quick: 'q', full: 'f', baseline: 'x && sudo y' } }, /gates\.baseline must not run sudo/);
  refuses({ baseline: 'launch', tip: TIP, tasks: [task('baseline', 0)] }, /task id baseline is reserved/);
  accepts({ tasks: [task('baseline', 0)] });
});

test('baseline launch runs one agent before the first implementer, and green goes on', async () => {
  const { result, calls } = await run(launch());
  assert.deepEqual(labels(calls).slice(0, 2), ['baseline', 'impl:a']);
  assert.equal(labels(calls).filter((l) => l === 'baseline').length, 1, 'once per launch');
  assert.equal(result.status, 'mvp');
});

test('the baseline prompt names the tip, the throwaway worktree, the gate, the attempt, and it is GATE_SCHEMA plus failed and tip', async () => {
  const { calls } = await run(launch({ baseline_attempt: 4, gates: { quick: 'make quick', full: 'make full', baseline: 'make base' }, flaky: ['t'] }));
  const c = calls[0];
  assert.ok(c.prompt.includes(TIP));
  assert.ok(c.prompt.includes('git rev-parse epic/e'));
  assert.ok(c.prompt.includes('`make base`'));
  assert.ok(!c.prompt.includes('make quick'));
  assert.match(c.prompt, /throwaway worktree is `\/r\/\.temper\/worktrees\/e\/tmp\/baseline-/);
  assert.ok(c.prompt.endsWith('Baseline attempt 4.'));
  assert.ok(c.prompt.includes('Known flaky tests'));
  assert.equal(c.opts.phase, 'Waves');
  for (const k of ['status', 'passed', 'exit_status', 'log_path', 'failed', 'tip']) assert.ok(c.opts.schema.required.includes(k), k);
  const dflt = (await run(launch())).calls[0];
  assert.ok(dflt.prompt.includes('`make quick`'), 'defaults to the quick gate');
  assert.ok(dflt.prompt.endsWith('Baseline attempt 0.'));
});

test('a red tip blocks before any implementer, with cause base-red, the tip, the failures and the log', async () => {
  const { result, calls } = await run(launch(), { baseline: { status: 'done', passed: false, exit_status: 1, log_path: 'b.log', failed: ['t::one', 't::two'], tip: TIP } });
  assert.deepEqual(labels(calls), ['baseline']);
  assert.equal(result.status, 'blocked');
  assert.equal(result.blocked.length, 1);
  const [b] = result.blocked;
  assert.equal(b.id, 'baseline');
  assert.equal(b.cause, 'base-red');
  for (const part of [TIP, 't::one', 't::two', 'b.log']) assert.ok(b.reason.includes(part), part);
});

test('a green claim with a failing exit status is red', async () => {
  const { result } = await run(launch(), { baseline: { status: 'done', passed: true, exit_status: 1, log_path: 'b.log', failed: [], tip: TIP } });
  assert.equal(result.blocked[0].cause, 'base-red');
});

test('a tip mismatch blocks before any implementer, whatever the gate says', async () => {
  for (const tip of ['0000000000000000000000000000000000000000', 'not a sha', '']) {
    const { result, calls } = await run(launch(), { baseline: { status: 'done', passed: true, exit_status: 0, log_path: 'b.log', failed: [], tip } });
    assert.deepEqual(labels(calls), ['baseline'], tip);
    assert.equal(result.blocked[0].id, 'baseline');
    assert.equal(result.blocked[0].cause, 'tip-mismatch');
  }
  const short = await run(launch({ tip: TIP.slice(0, 7) }));
  assert.equal(short.result.status, 'mvp', 'a short args.tip matches the full sha the agent reports');
});

test('a dead or blocked baseline agent blocks under its id', async () => {
  const dead = await run(launch(), { baseline: null });
  assert.deepEqual(dead.result.blocked, [{ id: 'baseline', reason: 'agent returned nothing', cause: 'nothing' }]);
  const stuck = await run(launch(), { baseline: { status: 'blocked', reason: 'worktree busy', passed: false, exit_status: 0, log_path: '', failed: [], tip: '' } });
  assert.deepEqual(stuck.result.blocked, [{ id: 'baseline', reason: 'worktree busy' }]);
});

test('baseline runs before the first wave with pending tasks, never with none, and off is absent', async () => {
  const later = await run(launch({ done: ['a', 'c'] }));
  assert.deepEqual(labels(later.calls).slice(0, 2), ['baseline', 'impl:b']);
  const none = await run(launch({ done: ['a', 'c', 'b'] }));
  assert.ok(!labels(none.calls).includes('baseline'));
  const off = await run(buildArgs({ baseline: 'off', tip: TIP }));
  const plain = await run(buildArgs());
  assert.deepEqual(off.calls, plain.calls);
});

// ---- 6. owns widening ----

const WIDEN = { max: 3, protected: ['schema/**', 'settings/*.sample.ini', '**/keyring*', 'packages/*/src/vault/**'] };
const widenArgs = (extra = {}) => buildArgs({ owns_widen: WIDEN, ...extra });
const ask = (...paths) => ({ status: 'needs_owns', branch: '', summary: 'need more', owns_add: paths.map((path) => ({ path, why: `for ${path}` })) });
const widenResult = async (paths, extra = {}) => run(widenArgs(extra), { 'impl:a': ask(...paths) });
const refusedBy = async (paths, extra = {}) => {
  const { result, calls } = await widenResult(paths, extra);
  assert.ok(!labels(calls).includes('widen:a'), `${paths}: must not widen`);
  assert.equal(result.status, 'blocked', `${paths}`);
  const entry = result.blocked.find((b) => b.id === 'a');
  assert.equal(entry.cause, 'owns-refused', `${paths}: ${JSON.stringify(entry)}`);
  assert.deepEqual(result.owns_widened, []);
  return entry;
};

test('owns_widen is validated: max 1 to 3, protected a list of plain globs', () => {
  for (const ok of [{}, { max: 1 }, { max: 3 }, { protected: [] }, WIDEN]) accepts({ owns_widen: ok });
  for (const bad of [0, 4, 1.5, '3']) refuses({ owns_widen: { max: bad } }, /owns_widen\.max must be an integer from 1 to 3/);
  for (const bad of ['x', true, null, []]) refuses({ owns_widen: bad }, /owns_widen must be/);
  refuses({ owns_widen: { protected: 'x' } }, /owns_widen\.protected must be an array of strings/);
  for (const bad of ['', '/abs/**', 'a/../b', 'a\\b', '[ab]/c', '{a,b}', '!x']) refuses({ owns_widen: { protected: [bad] } }, /owns_widen\.protected/);
  refuses({ owns_widened: 'x' }, /owns_widened must be an array/);
  refuses({ owns_widened: [{ id: 'nope', paths: ['p'] }] }, /owns_widened/);
  refuses({ owns_widened: [{ id: 'a', paths: 'p' }] }, /owns_widened/);
  accepts({ owns_widened: [{ id: 'a', paths: ['p'], why: ['w'] }] });
});

test('off: needs_owns is not a status the schema or the workflow knows', async () => {
  const off = await run(buildArgs());
  assert.deepEqual(off.calls[0].opts.schema.properties.status.enum, ['done', 'blocked']);
  assert.ok(!off.calls[0].opts.schema.properties.owns_add);
  assert.match(off.calls[0].prompt, /- touch a file outside `owns\[\]`;/);
  assert.ok(!('owns_widened' in off.result));
  const { result, calls } = await run(buildArgs(), { 'impl:a': ask('src/x.rs') });
  assert.ok(!labels(calls).includes('widen:a'));
  assert.deepEqual(result.blocked[0], { id: 'a', reason: 'implementer returned status needs_owns' });
});

test('on: IMPL_SCHEMA_WIDEN and the prompt tell the implementer how to ask, and what is refused', async () => {
  const { calls, result } = await run(widenArgs());
  const { schema } = calls[0].opts;
  assert.deepEqual(schema.properties.status.enum, ['done', 'blocked', 'needs_owns']);
  assert.deepEqual(schema.properties.owns_add.items.required, ['path', 'why']);
  assert.ok(!schema.required.includes('owns_add'));
  const p = calls[0].prompt;
  assert.ok(!p.includes('- touch a file outside `owns[]`;'));
  assert.match(p, /status "needs_owns"/);
  assert.match(p, /- change a contract;/);
  assert.match(p, /- add a dependency;/);
  for (const g of ['.git/**', '.github/**', '.temper/**', '.claude/**', '.gitattributes', 'docs/temper/e/**', 'schema/**']) assert.ok(p.includes(g), g);
  assert.ok(p.includes('realpath'), 'the verified resolve');
  assert.deepEqual(result.owns_widened, []);
});

test('a grant widens the task in memory, logs it, runs widen:<id>, and the checker uses the wider owns', async () => {
  const args = widenArgs();
  const before = clone(args);
  const { result, calls, logs } = await run(args, { 'impl:a': ask('src/x.rs', 'src/y.rs') });
  assert.deepEqual(labels(calls).slice(0, 3), ['impl:a', 'widen:a', 'check:a']);
  assert.deepEqual(args, before, 'args stay as given');
  assert.ok(logs.includes('owns_widened:a:src/x.rs,src/y.rs'), logs.join('\n'));
  const widen = calls[1];
  assert.equal(widen.opts.phase, 'Waves');
  assert.equal(JSON.stringify(widen.opts.schema), JSON.stringify(calls[0].opts.schema));
  for (const p of ['- src/a.rs', '- src/x.rs', '- src/y.rs']) assert.ok(widen.prompt.includes(p), p);
  assert.match(widen.prompt, /before you change anything/i);
  assert.ok(widen.prompt.includes('realpath'));
  assert.match(widen.prompt, /name each widened path in your summary and in the commit message/i);
  assert.ok(calls[2].prompt.includes('- src/x.rs'), 'checker sees the widened owns');
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.owns_widened, [{ id: 'a', paths: ['src/x.rs', 'src/y.rs'], why: ['for src/x.rs', 'for src/y.rs'] }]);
});

test('the merge agent checks a widened branch with git: symlinks in its tree, its diff against the widened owns', async () => {
  const { calls } = await run(widenArgs(), { 'impl:a': ask('src/deep/x.rs') });
  const merge = calls.find((c) => c.opts.label === 'merge:wave0');
  assert.ok(merge.prompt.includes(`for p in 'src' 'src/deep' 'src/deep/x.rs'; do git ls-tree temper/e/a -- "$p"; git ls-tree epic/e -- "$p"; done`), merge.prompt);
  assert.ok(merge.prompt.includes('120000'));
  assert.ok(merge.prompt.includes('git diff --name-only --no-renames epic/e...temper/e/a'));
  assert.ok(merge.prompt.includes('- src/deep/x.rs'));
  assert.ok(merge.opts.schema.properties.owns_refused);
  const plainMerge = calls.find((c) => c.opts.label === 'merge:wave1');
  assert.ok(!plainMerge.opts.schema.properties.owns_refused, 'a wave with no widening keeps the plain schema');
  assert.ok(!plainMerge.prompt.includes('ls-tree'));
});

test('a merge agent that finds a symlink blocks with owns-refused, and the task is not done', async () => {
  const { result } = await run(widenArgs(), {
    'impl:a': ask('src/x.rs'),
    'merge:wave0': { status: 'blocked', merged: [], gate_passed: false, owns_refused: [{ task: 'a', path: 'src/x.rs', why: 'mode 120000' }] },
  });
  const [b] = result.blocked;
  assert.equal(b.id, 'merge:wave0');
  assert.equal(b.cause, 'owns-refused');
  assert.ok(b.reason.includes('src/x.rs'));
  assert.deepEqual(result.done_now, []);
  const claimed = await run(widenArgs(), {
    'impl:a': ask('src/x.rs'),
    'merge:wave0': { status: 'merged', merged: ['a', 'c'], gate_passed: true, owns_refused: [{ task: 'a', path: 'src/x.rs', why: 'w' }] },
  });
  assert.equal(claimed.result.status, 'blocked', 'merged with a refusal still blocks');
});

test('an implementer that finds a symlink says owns symlink, and the block carries owns-refused', async () => {
  for (const over of [
    { 'impl:a': { status: 'blocked', branch: '', summary: '', question: 'owns symlink: src/link/x.rs' } },
    { 'impl:a': ask('src/link/x.rs'), 'widen:a': { status: 'blocked', branch: '', summary: '', question: 'owns symlink: src/link/x.rs' } },
  ]) {
    const { result } = await run(widenArgs(), over);
    assert.equal(result.blocked[0].cause, 'owns-refused');
  }
  const off = await run(buildArgs(), { 'impl:a': { status: 'blocked', branch: '', summary: '', question: 'owns symlink: x' } });
  assert.deepEqual(off.result.blocked[0], { id: 'a', reason: 'owns symlink: x' });
});

test('more than max is refused, and max defaults to 3', async () => {
  await refusedBy(['p/1', 'p/2', 'p/3', 'p/4']);
  await refusedBy(['p/1', 'p/2'], { owns_widen: { max: 1 } });
  await refusedBy(['p/1', 'p/2', 'p/3', 'p/4'], { owns_widen: {} });
  const ok = await widenResult(['p/1', 'p/2', 'p/3'], { owns_widen: {} });
  assert.deepEqual(ok.result.owns_widened[0].paths, ['p/1', 'p/2', 'p/3']);
  const dup = await widenResult(['p/1', 'p/1'], { owns_widen: { max: 1 } });
  assert.deepEqual(dup.result.owns_widened[0].paths, ['p/1'], 'a repeat is one path');
});

for (const bad of [
  '/etc/passwd', '~/x', '~', '../x', 'a/../b', 'a/..', 'a..b', 'a\\b', 'src/*.rs', 'src/?.rs', 'src/[ab].rs', 'src/{a,b}.rs', '!x',
  // Spellings that would slip past a text match on the protected list and the same-wave check.
  './.github/x', './/.github/x', 'src//x', 'src/./x', 'src/', '.', '',
  // Text that would break out of a prompt line, a shell quote or plan.md's comma-separated Owns line.
  'a b', "a'b", 'a"b', 'a`b', 'a$b', 'a;b', 'a,b', 'a\nb', 'a|b', '-x', 'src/-x',
]) {
  test(`a path of the wrong shape is refused: ${JSON.stringify(bad)}`, async () => { await refusedBy([bad]); });
}

test('owns_add that is not a list of paths is refused', async () => {
  for (const owns_add of [undefined, [], 'x', [{ why: 'w' }], [null], [{ path: 7, why: 'w' }]]) {
    const { result, calls } = await run(widenArgs(), { 'impl:a': { status: 'needs_owns', branch: '', summary: '', owns_add } });
    assert.ok(!labels(calls).includes('widen:a'));
    assert.equal(result.blocked[0].cause, 'owns-refused', JSON.stringify(owns_add));
  }
});

for (const bad of [
  '.git/config', '.git', 'sub/.git/hooks/x', '.GIT/config', '.github/workflows/ci.yml', '.github', '.GitHub/x', '.temper/project.md', '.temper',
  '.claude/settings.json', '.gitattributes', 'docs/temper/e/plan.md', 'docs/temper/e', 'docs/temper', 'docs',
  'schema/api.md', 'schema', 'settings/a.sample.ini', 'x/keyring.rs', 'keyring_two.rs', 'x/keyring/mod.rs', 'packages/k/src/vault/m.rs', 'packages/k/src/vault', 'packages/k', 'packages',
]) {
  test(`a protected path is refused, or a directory holding one: ${bad}`, async () => { await refusedBy([bad]); });
}

for (const ok of ['settings/a.ini', 'packages/k/src/lib.rs', 'schemas/x', 'docs/guide.md', 'src/github', '.gitignore', 'x/.github/y', 'x/hooks.rs']) {
  test(`a path near a protected one is granted: ${ok}`, async () => {
    const { result } = await widenResult([ok]);
    assert.deepEqual(result.owns_widened[0].paths, [ok]);
  });
}

test('the epic dir, spec, plan and log are protected when spelled absolute or with ./ too', async () => {
  await refusedBy(['docs/temper/e/x.md'], { log: '/r/docs/temper/e/log.md' });
  await refusedBy(['docs/temper/e/x.md'], { log: './docs/temper/e/log.md' });
  await refusedBy(['notes/spec.md'], { spec: 'notes/spec.md' });
  await refusedBy(['log.md'], { log: 'log.md' });
  const rootLog = await widenResult(['src/x.rs'], { log: 'log.md' });
  assert.deepEqual(rootLog.result.owns_widened[0].paths, ['src/x.rs'], 'a log at the repo root does not protect the whole repo');
});

test('a path a same-wave task owns is refused, done or not, also through a directory or glob', async () => {
  await refusedBy(['src/c.rs']);
  await refusedBy(['src/SRC.rs'], { tasks: [task('a', 0), task('c', 0, { owns: ['src/src.rs'] })] });
  await refusedBy(['src/c.rs'], { done: ['c'] });
  await refusedBy(['lib/x.rs'], { tasks: [task('a', 0), task('c', 0, { owns: ['lib/**'] })] });
  await refusedBy(['lib/x.rs'], { tasks: [task('a', 0), task('c', 0, { owns: ['lib/'] })] });
  await refusedBy(['lib'], { tasks: [task('a', 0), task('c', 0, { owns: ['lib/x.rs'] })] });
  const other = await widenResult(['src/b.rs']);
  assert.deepEqual(other.result.owns_widened[0].paths, ['src/b.rs'], 'a later wave\'s path can be widened');
});

test('a path a same-wave task already widened is refused, this run or an earlier launch', async () => {
  const { result, calls } = await run(widenArgs(), { 'impl:a': ask('src/x.rs'), 'impl:c': ask('src/x.rs') });
  assert.ok(labels(calls).includes('widen:a'));
  assert.ok(!labels(calls).includes('widen:c'));
  assert.deepEqual(result.blocked.map((b) => [b.id, b.cause]), [['c', 'owns-refused']]);
  const earlier = await run(widenArgs({ owns_widened: [{ id: 'c', paths: ['src/x.rs'] }] }), { 'impl:a': ask('src/x.rs') });
  assert.equal(earlier.result.blocked[0].cause, 'owns-refused');
});

test('asking only for what the task already owns is refused: nothing to widen', async () => {
  await refusedBy(['src/a.rs']);
});

test('a second needs_owns blocks with cause owns: from the widen run, a retry, or a later launch', async () => {
  const again = await run(widenArgs(), { 'impl:a': ask('src/x.rs'), 'widen:a': ask('src/y.rs') });
  assert.deepEqual(labels(again.calls).filter((l) => l.startsWith('widen:')), ['widen:a']);
  assert.deepEqual(again.result.blocked.map((b) => [b.id, b.cause]), [['a', 'owns']]);
  assert.equal(again.result.owns_widened.length, 1, 'the first widening is still reported');

  const retry = await run(widenArgs(), {
    'impl:a': ask('src/x.rs'),
    'check:a': { status: 'done', pass: false, problems: ['no'] },
    'retry:a': ask('src/y.rs'),
  });
  assert.deepEqual(retry.result.blocked.map((b) => [b.id, b.cause]), [['a', 'owns']]);

  const later = await run(widenArgs({ owns_widened: [{ id: 'a', paths: ['src/x.rs'] }] }), { 'impl:a': ask('src/y.rs') });
  assert.ok(!labels(later.calls).includes('widen:a'));
  assert.deepEqual(later.result.blocked.map((b) => [b.id, b.cause]), [['a', 'owns']]);
});

test('a first needs_owns from a retry widens, keeps the report, and rechecks', async () => {
  const { calls, result } = await run(widenArgs(), {
    'check:a': { status: 'done', pass: false, problems: ['missing the helper'] },
    'retry:a': ask('src/x.rs'),
  });
  assert.deepEqual(labels(calls).slice(0, 5), ['impl:a', 'check:a', 'retry:a', 'widen:a', 'recheck:a']);
  assert.ok(calls[3].prompt.includes('missing the helper'));
  assert.ok(calls[4].prompt.includes('- src/x.rs'));
  assert.equal(result.status, 'mvp');
});

test('with task_checks none, a widen still reaches the merge check', async () => {
  const { calls } = await run(widenArgs({ task_checks: 'none' }), { 'impl:a': ask('src/x.rs') });
  assert.deepEqual(labels(calls).slice(0, 4), ['impl:a', 'widen:a', 'impl:c', 'merge:wave0']);
  assert.ok(calls[3].prompt.includes('ls-tree'));
});

test('a task widened in an earlier launch still gets the merge check', async () => {
  const tasks = [task('a', 0, { owns: ['src/a.rs', 'src/x.rs'] }), task('c', 0), task('b', 1)];
  const { calls } = await run(widenArgs({ tasks, owns_widened: [{ id: 'a', paths: ['src/x.rs'] }] }));
  const merge = calls.find((c) => c.opts.label === 'merge:wave0');
  assert.ok(merge.prompt.includes(`for p in 'src' 'src/x.rs'; do git ls-tree temper/e/a -- "$p"`));
});

test('a dead widen run blocks with cause nothing', async () => {
  const { result } = await run(widenArgs(), { 'impl:a': ask('src/x.rs'), 'widen:a': null });
  assert.deepEqual(result.blocked[0], { id: 'a', reason: 'agent returned nothing', cause: 'nothing' });
});

test('every result of a widening run carries owns_widened, and stopped carries it too', async () => {
  const stopped = await run(widenArgs({ stop_after: 'wave:0' }), { 'impl:a': ask('src/x.rs') });
  assert.equal(stopped.result.status, 'stopped');
  assert.equal(stopped.result.owns_widened.length, 1);
  const phase = await run(widenArgs(), { 'impl:a': ask('src/x.rs'), checkpoint: null });
  assert.equal(phase.result.blocked[0].id, 'checkpoint');
  assert.equal(phase.result.owns_widened.length, 1);
});

test('the why is kept to one line of data', async () => {
  const { result } = await run(widenArgs(), { 'impl:a': { status: 'needs_owns', branch: '', summary: '', owns_add: [{ path: 'src/x.rs', why: 'one\n\n  two' }] } });
  assert.deepEqual(result.owns_widened[0].why, ['one two']);
});

// ---- the skills, the template, the schema ----

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

test('the args schema names every new field', () => {
  const { properties } = JSON.parse(read('schemas/args.schema.json'));
  for (const k of ['stop_after', 'gate_slots', 'task_checks', 'impl_cause', 'baseline', 'tip', 'baseline_attempt', 'owns_widen', 'owns_widened']) assert.ok(properties[k], k);
  assert.ok(properties.gates.properties.baseline);
  assert.equal(properties.owns_widen.properties.max.maximum, 3);
});

test('templates/project.md shows each new line, generic and empty by default', () => {
  const text = read('templates/project.md');
  for (const key of ['baseline', 'gate_baseline', 'impl_cause', 'owns_widen', 'owns_protected']) {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    assert.ok(i > 0, key);
    assert.equal(lines[i].slice(key.length + 1).trim(), '', `${key} is empty by default`);
    assert.match(lines[i - 1], /^# \S/, `${key} has a comment`);
  }
  assert.match(text, /# .*e\.g\. .*\*\*/, 'owns_protected shows a generic example');
});

test('the plan skill copies the new project.md lines into args.json', () => {
  const s = flat(read('skills/plan/SKILL.md'));
  assert.match(s, /`baseline`: the `baseline:` line of `project\.md`/);
  assert.match(s, /`gates\.baseline`/);
  assert.match(s, /`impl_cause`/);
  assert.match(s, /`owns_widen`: [^;]*`owns_widen:` line[^;]*`owns_protected:` line/);
  assert.match(s, /`max` at most 3/);
});

test('the run skill routes large args through run_script.py', () => {
  const s = flat(read('skills/run/SKILL.md'));
  assert.ok(s.includes('32 KB'));
  assert.ok(s.includes('scripts/run_script.py'));
  assert.ok(s.includes('Workflow({scriptPath})') || s.includes('`scriptPath`'));
  assert.match(s, /`scriptPath` and `resumeFromRunId`/);
});

test('the run skill handles stopped, baseline, causes and widening', () => {
  const s = flat(read('skills/run/SKILL.md'));
  assert.match(s, /`stopped`: /);
  assert.match(s, /`baseline`: /);
  assert.match(s, /`baseline_attempt`/);
  assert.match(s, /set `tip`/i);
  assert.match(s, /blocked\[<cause>\] <id>/);
  assert.ok(s.includes('scripts/blocks_report.py'));
  assert.match(s, /`owns_widened`/);
  assert.match(s, /plan\.md`'s `Owns:` line, `args\.json` and `log\.md`/);
  assert.match(s, /before the next launch/);
  assert.match(s, /`owns-refused`[^.]*user/);
});

test('the changelog section for 0.4.0 lists task_checks and every new field', () => {
  const text = read('CHANGELOG.md');
  const i = text.indexOf('## 0.4.0 (');
  assert.ok(i > 0);
  const section = text.slice(i, text.indexOf('## 0.3.1'));
  for (const k of ['task_checks', 'stop_after', 'gate_slots', 'run_script.py', 'blocks_report.py', 'cause', 'baseline', 'owns_widen']) assert.ok(section.includes(k), k);
});

// ---- the fix wave's findings: the merge's git checks run against a real repo ----

// A repo in a scratch dir whose branches temper/e/a and epic/e hold what `files` says: a string is a
// file, {link} a symlink. Returns what a prompt's command prints there.
function inRepo(files, command) {
  const dir = mkdtempSync(join(tmpdir(), 'temper-widen-'));
  try {
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      if (typeof content === 'string') writeFileSync(join(dir, path), content);
      else symlinkSync(content.link, join(dir, path));
    }
    git('add', '-A');
    git('commit', '-qm', 'x');
    git('branch', 'temper/e/a');
    git('branch', 'epic/e');
    const r = spawnSync('sh', ['-c', command], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mergeOf = async (...paths) => (await run(widenArgs(), { 'impl:a': ask(...paths) })).calls.find((c) => c.opts.label === 'merge:wave0').prompt;
const commandAfter = (prompt, n) => {
  const line = prompt.split('\n').find((l) => l.startsWith(`${n}. `));
  assert.ok(line, `check ${n}:\n${prompt}`);
  return line.match(/`([^`]+)`/)[1];
};

test('the symlink check lists only the checked path and what is above it, never a symlink beside them', async () => {
  const cmd = commandAfter(await mergeOf('src/deep/x.rs'), 1);
  const beside = inRepo({ 'src/deep/x.rs': 'a', 'src/deep/y.rs': 'b', 'src/real': 'c', 'src/unrelated-link': { link: 'real' }, 'src/deep/near-link': { link: 'y.rs' } }, cmd);
  assert.ok(!beside.includes('120000'), beside);
  assert.ok(beside.includes('src/deep/x.rs'), beside);
});

test('the symlink check still finds a symlink at the path or above it', async () => {
  const cmd = commandAfter(await mergeOf('src/deep/x.rs'), 1);
  assert.match(inRepo({ 'src/deep/x.rs': { link: '../real' }, 'src/real': 'a' }, cmd), /^120000 .*src\/deep\/x\.rs$/m);
  assert.match(inRepo({ 'src/deep': { link: 'other' }, 'src/other/x.rs': 'a' }, cmd), /^120000 .*src\/deep$/m);
});

test('the merge refuses a widened path that is a directory on the branch', async () => {
  const prompt = await mergeOf('crates/foo/tests');
  const cmd = commandAfter(prompt, 2);
  assert.ok(cmd.includes('temper/e/a'));
  assert.ok(prompt.includes('040000'), prompt);
  assert.match(inRepo({ 'crates/foo/tests/test_hooks.rs': 'a' }, cmd), /^040000 .*crates\/foo\/tests$/m);
  const file = inRepo({ 'crates/foo/tests': 'a', 'crates/foo/other': 'b' }, cmd);
  assert.match(file, /^100644 /);
  assert.equal(file.trim().split('\n').length, 1, file);
  assert.equal(inRepo({ 'other.rs': 'a' }, cmd), '', 'a file not made yet prints nothing');
});

test('the diff check takes a file outside the planned owns only as an exact widened path, and names the protected globs', async () => {
  const prompt = await mergeOf('x/hooks.rs');
  const line = prompt.split('\n').find((l) => l.startsWith('3. '));
  assert.ok(line.includes('git diff --name-only --no-renames epic/e...temper/e/a'), prompt);
  assert.match(line, /exactly one of its widened paths/);
  assert.match(line, /file beneath a widened path/);
  assert.match(prompt, /planned owns:\n- src\/a\.rs\n/i);
  for (const g of ['**/keyring*', '.github/**', 'schema/**']) assert.ok(prompt.includes(`- ${g}`), g);
});

test('a later launch: the widened path in owns is not read as planned, and the implementer gets the on-disk check back', async () => {
  const tasks = [task('a', 0, { owns: ['src/a.rs', 'src/x.rs'] }), task('c', 0), task('b', 1)];
  const { calls } = await run(widenArgs({ tasks, owns_widened: [{ id: 'a', paths: ['src/x.rs'], why: ['w'] }] }));
  const impl = calls.find((c) => c.opts.label === 'impl:a').prompt;
  assert.match(impl, /before you change anything/i);
  assert.ok(impl.includes('realpath'));
  assert.match(impl, /now include:\n- src\/x\.rs/);
  assert.match(impl, /name each widened path/i);
  assert.ok(!calls.find((c) => c.opts.label === 'impl:c').prompt.match(/before you change anything/i), 'only the task that widened');
  const merge = calls.find((c) => c.opts.label === 'merge:wave0').prompt;
  assert.match(merge, /planned owns:\n- src\/a\.rs\n/i);
  assert.match(merge, /Widened paths:\n- src\/x\.rs/);
});

test('a retry after a grant in the same run keeps the on-disk check', async () => {
  const { calls } = await run(widenArgs(), {
    'impl:a': ask('src/x.rs'),
    'check:a': { status: 'done', pass: false, problems: ['no'] },
  });
  const retry = calls.find((c) => c.opts.label === 'retry:a').prompt;
  assert.match(retry, /before you change anything/i);
  assert.match(retry, /now include:\n- src\/x\.rs/);
});

test('an implementer without a widening gets no on-disk check text', async () => {
  const { calls } = await run(widenArgs());
  assert.ok(!/before you change anything/i.test(calls[0].prompt));
});

test('a widening refused for a symlink is marked refused on the result, by the widen run or the merge', async () => {
  const symlink = { status: 'blocked', branch: '', summary: '', question: 'owns symlink: src/link/x' };
  const atWiden = await run(widenArgs(), { 'impl:a': ask('src/link/x'), 'widen:a': symlink });
  assert.deepEqual(atWiden.result.owns_widened, [{ id: 'a', paths: ['src/link/x'], why: ['for src/link/x'], refused: true }]);
  const atRetry = await run(widenArgs(), { 'impl:a': ask('src/link/x'), 'check:a': { status: 'done', pass: false, problems: ['no'] }, 'retry:a': symlink });
  assert.equal(atRetry.result.owns_widened[0].refused, true);
  const atMerge = await run(widenArgs(), {
    'impl:a': ask('src/x.rs'),
    'merge:wave0': { status: 'blocked', merged: [], gate_passed: false, owns_refused: [{ task: 'a', path: 'src/x.rs', why: 'mode 120000' }] },
  });
  assert.equal(atMerge.result.owns_widened[0].refused, true);
  const gateFail = await run(widenArgs(), { 'impl:a': ask('src/x.rs'), 'widen:a': { status: 'blocked', branch: '', summary: '', question: 'how?' } });
  assert.ok(!('refused' in gateFail.result.owns_widened[0]), 'any other block is no refusal');
});

test('a refused entry stays out of the later launch: no grant in the prompts, no second ask, the diff still checked', async () => {
  const entry = { id: 'a', paths: ['src/link/x'], why: ['w'], refused: true };
  const { calls } = await run(widenArgs({ owns_widened: [entry] }));
  const impl = calls.find((c) => c.opts.label === 'impl:a').prompt;
  assert.ok(!impl.includes('src/link/x'), 'the implementer is not told it owns the path');
  const merge = calls.find((c) => c.opts.label === 'merge:wave0').prompt;
  assert.ok(!merge.includes('src/link/x'), 'nothing to check on disk, and nothing granted');
  assert.ok(merge.includes('git diff --name-only --no-renames epic/e...temper/e/a'), 'its diff is still held to its owns');
  assert.ok(!merge.includes('ls-tree temper/e/a'));
  const again = await run(widenArgs({ owns_widened: [entry] }), { 'impl:a': ask('src/link/x') });
  assert.deepEqual(again.result.blocked.map((b) => [b.id, b.cause]), [['a', 'owns']]);
});

test('args take a refused entry, and the schema names the field', () => {
  accepts({ owns_widened: [{ id: 'a', paths: ['p'], why: ['w'], refused: true }] });
  assert.ok(JSON.parse(read('schemas/args.schema.json')).properties.owns_widened.items.properties.refused);
});

test('the run skill keeps a refused widening out of Owns, says how to revoke one, and routes a baseline with no cause', () => {
  const s = flat(read('skills/run/SKILL.md'));
  assert.match(s, /`refused: true`[^.]*stay out of `plan\.md`'s `Owns:` line and `args\.json`'s `owns`/);
  assert.match(s, /`refused: true`[^.]*`args\.owns_widened`[^.]*\. /);
  assert.match(s, /take its paths out of the `Owns:` line and `owns`/);
  assert.match(s, /With no cause, [^.]*throwaway/);
  assert.match(s, /With no cause, .*?bump `baseline_attempt`/);
  assert.match(s, /a directory/);
});

test('the baseline saves its log outside its worktree, and earlier untracked output does not stop a relaunch', async () => {
  const { prompt } = (await run(launch())).calls[0];
  assert.ok(prompt.includes('`/r/.temper/worktrees/e.baseline.log`'), prompt);
  assert.ok(prompt.includes('status --porcelain --untracked-files=no'), prompt);
  assert.match(prompt, /untracked files/i);
  const host = { kind: 'ssh', name: 'h', clone: '/c', root: '/w/' };
  assert.ok((await run(launch({ host }))).calls[0].prompt.includes('`/w/e.baseline.log`'));
  const { calls } = await run(buildArgs());
  const check = calls.find((c) => c.opts.label === 'check:a').prompt;
  assert.ok(check.includes('status --porcelain` prints nothing'), 'every other throwaway stays as strict');
  assert.ok(!check.includes('--untracked-files=no'));
});

test('cleanup removes the baseline log, which lies outside the epic directory', () => {
  assert.ok(flat(read('skills/cleanup/SKILL.md')).includes('<epic>.baseline.log'));
});
