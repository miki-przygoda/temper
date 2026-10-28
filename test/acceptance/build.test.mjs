// Acceptance tests for the build group (docs/v1-behaviour.md, BUILD-01..34).
// They drive the bundled workflows/build.js through the harness with scripted agents, the way the
// head launches it with args.json. A test that fails because of the product is skipped with
// "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from '../harness.mjs';
import { ARGS_SCHEMA, namesField, schemaCases } from '../schema-cases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF = 'workflows/build.js';
const EPIC = 'e';

const task = (id, wave, extra = {}) => ({
  id,
  title: `Title ${id}`,
  wave,
  owns: [`src/${id}.rs`],
  uses: [],
  provides: [],
  text: `TASK-TEXT-${id}: build ${id}`,
  ...extra,
});

const GROUPS = [
  { key: 'g1', behaviours: [{ id: 'G1-01', text: 'given x then y' }, { id: 'G1-02', text: 'given p then q' }] },
  { key: 'g2', behaviours: [{ id: 'G2-01', text: 'given m then n' }] },
];

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
    tasks: [task('a', 0, { provides: ['A'] }), task('c', 0), task('b', 1, { uses: ['A'] })],
    behaviour_groups: [{ key: 'g1', title: 'Group 1' }, { key: 'g2', title: 'Group 2' }],
    done: [],
    answers: {},
    ...extra,
  };
}

const idOf = (label) => label.slice(label.indexOf(':') + 1);

// Every agent succeeds unless `over` has an entry for its label (a value, or a function of the call).
function responder(over = {}) {
  return (call) => {
    const { label } = call;
    if (Object.prototype.hasOwnProperty.call(over, label)) {
      const v = over[label];
      return typeof v === 'function' ? v(call) : v;
    }
    const id = idOf(label);
    if (label.startsWith('impl:') || label.startsWith('retry:')) {
      return { status: 'done', branch: `temper/e/${id}`, commit: 'abc', summary: `did ${id}` };
    }
    if (label.startsWith('check:') || label.startsWith('recheck:')) return { pass: true, problems: [] };
    if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
    if (label === 'checkpoint') {
      return {
        gate_passed: true,
        gate_log: 'logs/full.log',
        flows: [{ flow: 'flow one', result: 'ok', evidence: 'ran it' }, { flow: 'flow two', result: 'gap', evidence: 'missing' }],
        gaps: ['flow two prints nothing'],
      };
    }
    if (label === 'behaviour-spec') return { groups: GROUPS, commit: 'bbb' };
    if (label.startsWith('acceptance:')) {
      const g = GROUPS.find((x) => x.key === id);
      return { group: id, passing: g ? g.behaviours.map((b) => b.id) : [], failing: [], untestable: [], commit: 'ccc' };
    }
    if (label.startsWith('green:')) return { fixed: [], corrected: [], questions: [], still_failing: [] };
    return null;
  };
}

const run = (args, over) => runWorkflow(WF, { args, respond: responder(over) });
const labels = (calls) => calls.map((c) => c.opts.label);
const promptOf = (calls, label) => {
  const c = calls.find((x) => x.opts.label === label);
  assert.ok(c, `no agent call labelled ${label}; calls: ${labels(calls).join(', ')}`);
  return c.prompt;
};
const taskLabels = (calls, id) => labels(calls).filter((l) => /^(impl|check|retry|recheck):/.test(l) && idOf(l) === id);

// ---------------------------------------------------------------------------

test('BUILD-01 invalid args.json is refused naming the problem, before any agent', async () => {
  const base = buildArgs();
  const without = (field) => {
    const a = { ...base };
    delete a[field];
    return a;
  };
  const cases = [
    { name: 'tasks missing', args: without('tasks'), field: 'tasks' },
    { name: 'gates missing', args: without('gates'), field: 'gates' },
    { name: 'epic missing', args: without('epic'), field: 'epic' },
    { name: 'tasks of the wrong type', args: { ...base, tasks: 'a,b' }, field: 'tasks' },
    { name: 'gates of the wrong type', args: { ...base, gates: 'npm test' }, field: 'gates' },
    { name: 'epic of the wrong type', args: { ...base, epic: 7 }, field: 'epic' },
    { name: 'done of the wrong type', args: { ...base, done: 'a' }, field: 'done' },
    { name: 'a task wave of the wrong type', args: { ...base, tasks: [task('a', '0')] }, field: 'wave' },
  ];
  // Every required field and wrong type the args schema names (SECOND-TESTS-DOCS-4), from a full
  // base that holds every optional field and one entry in each list, once with a local host and
  // once with an ssh host.
  const full = buildArgs({
    default_branch: 'main',
    done: ['x1'],
    answers: { a: 'an answer' },
    behaviour: [{ key: 'g1', behaviours: [{ id: 'G1-01', text: 'given x then y' }] }],
  });
  const ssh = { ...full, host: { kind: 'ssh', name: 'beast', root: '/srv/temper', clone: '/srv/repo' } };
  for (const valid of [full, ssh]) {
    const { result } = await run(valid);
    assert.notEqual(result.status, 'invalid', `the base is valid: ${result.errors}`);
  }
  const fromSchema = [...schemaCases(full), ...schemaCases(ssh).filter((c) => c.name.startsWith('host'))];
  const names = fromSchema.map((c) => c.name);
  for (const required of ARGS_SCHEMA.required) assert.ok(names.includes(`${required} missing`), `no case for ${required} missing`);
  for (const f of ['tasks.0.wave a string', 'tasks.0.owns empty', 'host.clone missing', 'host.kind not its const',
    'gates.full missing', 'behaviour.0.behaviours.0.text missing', 'answers.a a number', 'done.0 a number']) {
    assert.ok(names.includes(f), `no case ${f}: ${names.join(', ')}`);
  }
  for (const c of [...cases, ...fromSchema]) {
    const { result, calls } = await run(c.args);
    assert.equal(calls.length, 0, `${c.name}: an agent was started`);
    assert.equal(result.status, 'invalid', `${c.name}: status`);
    assert.ok(Array.isArray(result.errors) && result.errors.length > 0, `${c.name}: no errors`);
    assert.ok(namesField(result.errors, c.field), `${c.name}: no error names ${c.field}: ${result.errors}`);
  }
});

test('BUILD-02 waves run in ascending order, each merged before the next starts', async () => {
  // Tasks listed out of wave order on purpose.
  const tasks = [task('z', 2), task('y', 1), task('x', 0), task('w', 1)];
  const { result, calls } = await run(buildArgs({ tasks }));
  const ls = labels(calls);
  const firstOfWave = (ids) => Math.min(...ls.map((l, i) => (/^(impl|check|retry|recheck):/.test(l) && ids.includes(idOf(l)) ? i : Infinity)));
  const lastOfWave = (ids) => Math.max(...ls.map((l, i) => (/^(impl|check|retry|recheck):/.test(l) && ids.includes(idOf(l)) ? i : -1)));
  const m0 = ls.indexOf('merge:wave0');
  const m1 = ls.indexOf('merge:wave1');
  const m2 = ls.indexOf('merge:wave2');
  assert.ok(m0 >= 0 && m1 >= 0 && m2 >= 0, ls.join(', '));
  assert.ok(lastOfWave(['x']) < m0 && m0 < firstOfWave(['y', 'w']), ls.join(', '));
  assert.ok(lastOfWave(['y', 'w']) < m1 && m1 < firstOfWave(['z']), ls.join(', '));
  assert.ok(lastOfWave(['z']) < m2, ls.join(', '));
  assert.equal(result.status, 'mvp');
});

test('BUILD-03 a pending task goes through an implementer, a separate checker, and a retry only on failure', async () => {
  const { calls } = await run(buildArgs({ tasks: [task('a', 0), task('c', 0)] }), {
    'check:c': { pass: false, problems: ['tests missing'] },
  });
  const a = taskLabels(calls, 'a');
  assert.deepEqual(a, ['impl:a', 'check:a'], 'a passing task gets no retry');
  const c = taskLabels(calls, 'c');
  assert.deepEqual(c, ['impl:c', 'check:c', 'retry:c', 'recheck:c']);
  // The checker is a separate agent with its own prompt, not the implementer told to check.
  const impl = calls.find((x) => x.opts.label === 'impl:a');
  const check = calls.find((x) => x.opts.label === 'check:a');
  assert.notEqual(impl.prompt, check.prompt);
  assert.match(check.prompt, /checker/i);
  assert.doesNotMatch(check.prompt, /You are the implementer/);
});

test('BUILD-04 the implementer works in its own worktree, follows the text, tests first, trailer, quick gate', async (t) => {
  const { calls } = await run(buildArgs());
  const p = promptOf(calls, 'impl:a');
  assert.match(p, /own worktree/i);
  assert.ok(p.includes('TASK-TEXT-a'), 'task text');
  assert.doesNotMatch(p, /TASK-TEXT-c/, 'another task\'s text');
  assert.match(p, /tests first/i);
  assert.ok(p.includes('Temper-Task: e/a'), 'trailer');
  assert.ok(p.includes('QUICK-GATE-CMD'), 'quick gate');
  // The other implementer gets its own trailer, not a's.
  assert.ok(promptOf(calls, 'impl:c').includes('Temper-Task: e/c'));

  await t.test('its branch and worktree can be made next to the plan\'s default epic branch', async () => {
    // The epic branch's default as skills/plan states it (`branch`: the epic branch (default `…`).
    const skill = readFileSync(join(ROOT, 'skills/plan/SKILL.md'), 'utf8');
    const d = /`branch`: the epic branch \(default `([^`]+)`/.exec(skill);
    assert.ok(d, 'skills/plan names a default epic branch');
    const epicBranch = d[1].replace('<epic>', EPIC);
    const g = gitRepo(epicBranch);
    try {
      const pd = promptOf((await run(buildArgs({ branch: epicBranch }))).calls, 'impl:a');
      const m = /branch `([^`]+)`, created from `([^`]+)` in its own worktree/.exec(pd);
      assert.ok(m, 'the prompt names the task branch and where it starts');
      assert.equal(m[2], epicBranch);
      g.git('worktree', 'add', '--quiet', '-b', m[1], join(g.dir, 'wt-a'), m[2]);
    } finally {
      g.cleanup();
    }
  });
});

test('BUILD-05 the checker confirms owns[], tests present and not weakened, quick gate, and a break spot-check', async () => {
  const { calls } = await run(buildArgs());
  const p = promptOf(calls, 'check:a');
  assert.ok(p.includes('src/a.rs'), 'owns path');
  assert.match(p, /diff touches only/i);
  assert.match(p, /tests are present and not weakened/i);
  assert.ok(p.includes('QUICK-GATE-CMD') && /quick gate passes/i.test(p), 'quick gate');
  assert.match(p, /breaking the code makes the tests fail/i);
  assert.match(p, /pass false/i);
});

test('BUILD-06 a first checker failure gives exactly one retry, with the checker\'s report', async () => {
  const report = 'PROBLEM-UNIQUE-42: the diff touches src/other.rs';
  const { result, calls } = await run(buildArgs(), {
    'check:a': { pass: false, problems: [report] },
  });
  const a = taskLabels(calls, 'a');
  assert.equal(a.filter((l) => l.startsWith('retry:')).length, 1, a.join(', '));
  assert.equal(a.filter((l) => l.startsWith('impl:')).length, 1, a.join(', '));
  assert.ok(promptOf(calls, 'retry:a').includes(report), 'retry prompt carries the report');
  assert.ok(!promptOf(calls, 'impl:a').includes(report));
  assert.equal(result.status, 'mvp');
});

test('BUILD-07 a second checker failure blocks the task with no third attempt', async () => {
  const { result, calls } = await run(buildArgs(), {
    'check:a': { pass: false, problems: ['first'] },
    'recheck:a': { pass: false, problems: ['second'] },
  });
  const attempts = taskLabels(calls, 'a').filter((l) => /^(impl|retry):/.test(l));
  assert.equal(attempts.length, 2, attempts.join(', '));
  assert.equal(result.status, 'blocked');
  assert.ok(result.blocked.some((b) => b.id === 'a'), JSON.stringify(result.blocked));
  assert.ok(!labels(calls).includes('impl:b'), 'next wave started');
});

test('BUILD-08 a blocked agent lets its wave finish, then the run ends with the blocked list', async () => {
  const tasks = [task('c', 0), task('a', 0), task('d', 0), task('b', 1)];
  const { result, calls } = await run(buildArgs({ tasks }), {
    'impl:c': { status: 'blocked', question: 'QUESTION-C: which format?', context: 'the spec names two' },
    'retry:d': { status: 'blocked', question: 'QUESTION-D: may I add a dep?', context: 'needs serde' },
    'check:d': { pass: false, problems: ['missing test'] },
  });
  const ls = labels(calls);
  assert.ok(ls.includes('impl:a') && ls.includes('check:a'), 'a finished');
  assert.ok(ls.includes('impl:d') && ls.includes('retry:d'), 'd finished');
  assert.equal(result.status, 'blocked');
  const byId = Object.fromEntries(result.blocked.map((b) => [b.id, b]));
  assert.ok(byId.c && JSON.stringify(byId.c).includes('QUESTION-C'), JSON.stringify(result.blocked));
  assert.ok(byId.d && JSON.stringify(byId.d).includes('QUESTION-D'), JSON.stringify(result.blocked));
  assert.ok(!byId.a, 'a was not blocked');
  assert.ok(!ls.some((l) => idOf(l) === 'b'), `next wave started: ${ls.join(', ')}`);
  assert.ok(!ls.includes('checkpoint'));
});

test('BUILD-09 a task its checker did not confirm is never reported as done', async () => {
  const tasks = [task('t1', 0), task('t2', 0), task('t3', 0), task('t4', 0), task('t5', 0), task('ok', 0)];
  const { result } = await run(buildArgs({ tasks, behaviour_groups: [] }), {
    'check:t1': { pass: false, problems: ['p1'] }, // failed twice
    'recheck:t1': { pass: false, problems: ['p2'] },
    'impl:t2': { status: 'blocked', question: 'q?', context: 'c' }, // blocked
    'impl:t3': null, // implementer returned nothing
    'check:t4': null, // checker returned nothing
    'check:t5': { pass: false, problems: ['p'] }, // retry returned nothing
    'retry:t5': null,
  });
  const unconfirmed = ['t1', 't2', 't3', 't4', 't5'];
  assert.notEqual(result.status, 'mvp');
  for (const id of unconfirmed) {
    assert.ok(!(result.done_now || []).includes(id), `${id} reported done`);
    assert.ok(result.blocked.some((b) => b.id === id), `${id} not in blocked: ${JSON.stringify(result.blocked)}`);
  }
  // No field of the report lists them as done.
  for (const [k, v] of Object.entries(result)) {
    if (/done|passed|merged/i.test(k) && Array.isArray(v)) {
      for (const id of unconfirmed) assert.ok(!v.includes(id), `${id} in ${k}`);
    }
  }
});

test('BUILD-10 a task in args.done starts no agent and is not redone', async () => {
  // Launch: a is done, c in the same wave is not.
  const first = await run(buildArgs({ done: ['a'] }));
  assert.deepEqual(taskLabels(first.calls, 'a'), []);
  for (const c of first.calls) {
    assert.ok(!c.prompt.includes('TASK-TEXT-a'), `${c.opts.label} carries a's task text`);
  }
  const merge0 = promptOf(first.calls, 'merge:wave0');
  assert.ok(!merge0.includes('temper/e/a`'), 'a merged again');
  assert.ok(merge0.includes('temper/e/c'));
  assert.equal(first.result.status, 'mvp');

  // Resume: every task of wave 0 done, so wave 0 starts nothing at all.
  const second = await run(buildArgs({ done: ['a', 'c'] }));
  const ls = labels(second.calls);
  assert.ok(!ls.some((l) => ['a', 'c'].includes(idOf(l))), ls.join(', '));
  assert.ok(!ls.includes('merge:wave0'), ls.join(', '));
  assert.ok(ls.includes('impl:b'));
});

test('BUILD-11 a phase id in args.done is skipped when the run reaches it', async (t) => {
  const tasksDone = ['a', 'c', 'b'];

  await t.test('checkpoint', async () => {
    const { calls } = await run(buildArgs({ done: [...tasksDone, 'checkpoint'] }));
    assert.ok(!labels(calls).includes('checkpoint'));
    assert.ok(labels(calls).includes('behaviour-spec'));
  });

  await t.test('behaviour spec', async () => {
    const { calls, result } = await run(buildArgs({ done: [...tasksDone, 'checkpoint', 'behaviour-spec'], behaviour: GROUPS }));
    assert.ok(!labels(calls).includes('behaviour-spec'));
    assert.ok(labels(calls).includes('acceptance:g1'));
    assert.equal(result.status, 'mvp');
  });

  await t.test('an acceptance group', async () => {
    const { calls } = await run(buildArgs({ done: [...tasksDone, 'checkpoint', 'acceptance:g1'] }));
    assert.ok(!labels(calls).includes('acceptance:g1'));
    assert.ok(labels(calls).includes('acceptance:g2'));
  });

  await t.test('a to-green round', async () => {
    // green:1 committed in an earlier run; the run reaches to-green again with a failure.
    const { calls } = await run(buildArgs({ done: [...tasksDone, 'checkpoint', 'green:1'] }), {
      'acceptance:g1': { group: 'g1', passing: ['G1-02'], failing: [{ id: 'G1-01', observed: 'x' }], untestable: [], commit: 'c' },
      'green:2': { fixed: ['G1-01'], corrected: [], questions: [], still_failing: [] },
    });
    assert.ok(!labels(calls).includes('green:1'), labels(calls).join(', '));
  });
});

test('BUILD-12 the phases after the waves commit with Temper-Task: <epic>/<phase id>', async () => {
  const { calls } = await run(buildArgs(), {
    'acceptance:g1': { group: 'g1', passing: [], failing: [{ id: 'G1-01', observed: 'x' }, { id: 'G1-02', observed: 'y' }], untestable: [], commit: 'c' },
    'green:1': { fixed: ['G1-02'], corrected: [], questions: [], still_failing: ['G1-01'] },
    'green:2': { fixed: ['G1-01'], corrected: [], questions: [], still_failing: [] },
  });
  for (const id of ['checkpoint', 'behaviour-spec', 'acceptance:g1', 'acceptance:g2', 'green:1', 'green:2']) {
    assert.ok(promptOf(calls, id).includes(`Temper-Task: ${EPIC}/${id}`), `${id} prompt lacks its trailer`);
  }

  // Fixes (stage 4b) commit with their own phase id.
  const finding = {
    id: 'security-01', lens: 'security', file: 'src/a.rs', line: 3, summary: 's', input: 'i', wrong_result: 'w',
    severity: 'critical', kind: 'fix',
  };
  const stab = await runWorkflow('workflows/stabilise.js', {
    args: {
      epic: EPIC, repo: '/r', branch: 'temper/e', base: 'main', log: 'docs/temper/e/log.md', host: { kind: 'local' },
      gates: { quick: 'q', full: 'f' }, part: 'fix', lenses: [], severity_notes: '', done: [], selected: [finding],
    },
    respond: ({ label }) => {
      if (label.startsWith('fix:')) return { status: 'fixed', commit: 'f1', note: 'n' };
      if (label.includes('review:')) return { findings: [] };
      return null;
    },
  });
  assert.ok(promptOf(stab.calls, 'fix:security-01').includes(`Temper-Task: ${EPIC}/fix:security-01`));
});

test('BUILD-13 an answer goes into its own task\'s prompt and no other task\'s', async () => {
  const answer = 'ANSWER-FOR-C-7731: use the v2 format';
  const tasks = [task('a', 0, { provides: ['A'] }), task('c', 0), task('b', 1, { uses: ['A'] })];
  const { calls } = await run(buildArgs({ tasks, answers: { c: answer } }));
  assert.ok(promptOf(calls, 'impl:c').includes(answer));
  for (const call of calls) {
    const l = call.opts.label;
    if (/^(impl|retry|check|recheck):/.test(l) && idOf(l) === 'c') continue;
    assert.ok(!call.prompt.includes(answer), `the answer leaked into ${l}`);
  }
});

// A temp git repo where scripted agents really commit and merge, so args.done comes from
// scripts/done_tasks.py exactly as the head computes it before a resume.
function gitRepo(epicBranch) {
  const dir = mkdtempSync(join(tmpdir(), 'temper-acc-build-'));
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
  git('branch', epicBranch, 'main');
  const doneIds = () => JSON.parse(execFileSync('python3', [join(ROOT, 'scripts/done_tasks.py'), repo, epicBranch, 'main', EPIC], { env, encoding: 'utf8' }));
  return { dir, repo, git, doneIds, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('BUILD-14 a resume with done and answers skips finished tasks and reruns blocked ones with their answers', async () => {
  // An epic branch outside temper/<epic>/, so the task branches temper/e/<id> can exist beside it
  // (BUILD-04 covers the plan's default name).
  const EPIC_BRANCH = 'epic/e';
  const g = gitRepo(EPIC_BRANCH);
  try {
    const tasks = [task('a', 0, { provides: ['A'] }), task('b', 1, { uses: ['A'] }), task('d', 1, { uses: ['A'] })];
    const answer = 'ANSWER-B-9001: keep the old name';
    // Agents that commit on their task branch with the trailer, and a merge agent that merges.
    const commitTask = (id) => {
      const branches = g.git('branch', '--list', `temper/e/${id}`).trim();
      if (branches === '') g.git('branch', `temper/e/${id}`, EPIC_BRANCH);
      g.git('checkout', '--quiet', `temper/e/${id}`);
      g.git('commit', '--quiet', '--allow-empty', '-m', `feat: ${id}`, '-m', `Temper-Task: ${EPIC}/${id}`);
      g.git('checkout', '--quiet', 'main');
      return { status: 'done', branch: `temper/e/${id}`, commit: 'x', summary: `did ${id}` };
    };
    // The merge agent merges the task branches its prompt names (A9: only the tasks that passed).
    const mergeWave = (ids) => (call) => {
      ids = ids.filter((id) => call.prompt.includes(`temper/e/${id}\``));
      g.git('checkout', '--quiet', EPIC_BRANCH);
      for (const id of ids) g.git('merge', '--quiet', '--no-ff', '-m', `merge ${id}`, `temper/e/${id}`);
      g.git('checkout', '--quiet', 'main');
      return { status: 'merged', merged: ids, gate_passed: true };
    };
    const over = (bBlocked) => ({
      'impl:a': () => commitTask('a'),
      'impl:b': bBlocked ? { status: 'blocked', question: 'QUESTION-B: rename?', context: 'c' } : () => commitTask('b'),
      'impl:d': () => commitTask('d'),
      'merge:wave0': mergeWave(['a']),
      'merge:wave1': mergeWave(['b', 'd']),
    });

    const args = { ...buildArgs({ tasks }), repo: g.repo, branch: EPIC_BRANCH };
    const first = await run(args, over(true));
    assert.equal(first.result.status, 'blocked');
    assert.ok(first.result.blocked.some((b) => b.id === 'b'));

    // A9: d passed in the blocked wave, so it was merged and reported before the run returned.
    assert.deepEqual(first.result.done_now, ['a', 'd']);

    // The head refreshes args.done from the trailers and writes the answer.
    const done = g.doneIds();
    assert.deepEqual(done, ['a', 'd']);
    const second = await run({ ...args, done, answers: { b: answer } }, over(false));
    assert.deepEqual(taskLabels(second.calls, 'a'), [], 'a ran again');
    assert.deepEqual(taskLabels(second.calls, 'd'), [], 'd ran again: only the blocked task reruns');
    assert.ok(!second.calls.some((c) => c.prompt.includes('TASK-TEXT-a')), 'a\'s work was redone');
    assert.ok(promptOf(second.calls, 'impl:b').includes(answer), 'b ran without its answer');
    assert.equal(second.result.status, 'mvp');
    assert.deepEqual(g.doneIds(), ['a', 'b', 'd']);
  } finally {
    g.cleanup();
  }
});

test('BUILD-15 a passed wave is merged by a merge agent in order, with the quick gate after each merge', async () => {
  const tasks = [task('a', 0, { provides: ['A'] }), task('c', 0, { provides: ['C'] }), task('b', 1, { uses: ['A', 'C'] })];
  const { calls } = await run(buildArgs({ tasks }));
  const ls = labels(calls);
  assert.equal(ls.filter((l) => l === 'merge:wave0').length, 1);
  // The merge agent starts only after every task of the wave passed its check.
  assert.ok(ls.indexOf('check:a') < ls.indexOf('merge:wave0') && ls.indexOf('check:c') < ls.indexOf('merge:wave0'));
  const p = promptOf(calls, 'merge:wave0');
  assert.match(p, /merge agent/i);
  assert.ok(p.includes('`temper/e`'), 'the epic branch');
  const ia = p.indexOf('temper/e/a');
  const ic = p.indexOf('temper/e/c');
  assert.ok(ia >= 0 && ic >= 0, 'every task branch of the wave');
  assert.match(p, /in this order/i);
  assert.ok(p.includes('QUICK-GATE-CMD') && /after each merge/i.test(p), 'quick gate after each merge');
  // Dependants come after what they use: b (wave 1) is merged in a later merge.
  assert.ok(!p.includes('temper/e/b'));
  assert.ok(promptOf(calls, 'merge:wave1').includes('temper/e/b'));
});

test('BUILD-16 a merge conflict blocks the run and the next wave does not start', async () => {
  const { result, calls } = await run(buildArgs(), {
    'merge:wave0': { status: 'blocked', merged: ['a'], conflict: { task: 'c', files: ['src/shared.rs'] }, gate_passed: false },
  });
  assert.equal(result.status, 'blocked');
  assert.ok(result.blocked.length > 0);
  assert.ok(JSON.stringify(result.blocked).includes('src/shared.rs'), JSON.stringify(result.blocked));
  assert.ok(result.blocked.some((b) => /merge|conflict/i.test(`${b.id} ${b.reason}`)));
  const ls = labels(calls);
  assert.ok(!ls.some((l) => idOf(l) === 'b'), ls.join(', '));
  assert.ok(!ls.includes('checkpoint'));
  // The conflict is never resolved by the merge agent.
  assert.match(promptOf(calls, 'merge:wave0'), /never resolve a conflict/i);
});

test('BUILD-17 the MVP checkpoint runs the full gate and every user flow, records gaps, changes no code', async () => {
  const { result, calls } = await run(buildArgs());
  const ls = labels(calls);
  assert.ok(ls.indexOf('checkpoint') > ls.indexOf('merge:wave1'), 'after all waves merged');
  const p = promptOf(calls, 'checkpoint');
  assert.ok(p.includes('FULL-GATE-CMD'), 'full gate');
  assert.match(p, /each user flow/i);
  assert.ok(p.includes('docs/temper/e/spec.md'), 'the spec');
  assert.match(p, /by hand/i);
  assert.match(p, /record gaps/i);
  assert.match(p, /change no product code/i);
  // The gaps are recorded, and the run goes on.
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.checkpoint.gaps, ['flow two prints nothing']);
});

test('BUILD-18 a separate agent writes the behaviour spec from spec.md only, in the plan\'s groups', async () => {
  const { calls } = await run(buildArgs());
  const ls = labels(calls);
  assert.ok(ls.indexOf('behaviour-spec') > ls.indexOf('checkpoint'));
  const p = promptOf(calls, 'behaviour-spec');
  assert.notEqual(p, promptOf(calls, 'checkpoint'));
  assert.ok(p.includes('docs/temper/e/spec.md'));
  assert.match(p, /spec\.md only/i);
  assert.match(p, /do not read product code/i);
  assert.ok(!p.includes('docs/temper/e/plan.md'), 'the plan path is offered as a source');
  assert.ok(p.includes('g1: Group 1') && p.includes('g2: Group 2'), 'the plan\'s groups');
});

test('BUILD-19 one acceptance agent per behaviour group, none touching product code', async () => {
  const { calls } = await run(buildArgs());
  const acc = calls.filter((c) => c.opts.label.startsWith('acceptance:'));
  assert.deepEqual(acc.map((c) => c.opts.label), ['acceptance:g1', 'acceptance:g2']);
  for (const c of acc) assert.match(c.prompt, /never change product code/i, c.opts.label);
  const g1 = promptOf(calls, 'acceptance:g1');
  assert.ok(g1.includes('G1-01') && g1.includes('G1-02') && !g1.includes('G2-01'));
  assert.ok(promptOf(calls, 'acceptance:g2').includes('G2-01'));
});

test('BUILD-20 an acceptance test failing because of the product stays, marked ignored with its id', async () => {
  const { calls, result } = await run(buildArgs(), {
    'acceptance:g1': { group: 'g1', passing: ['G1-02'], failing: [{ id: 'G1-01', observed: 'prints 2' }], untestable: [], commit: 'c' },
    'green:1': { fixed: [], corrected: [], questions: [], still_failing: ['G1-01'] },
    'green:2': { fixed: [], corrected: [], questions: [], still_failing: ['G1-01'] },
  });
  const p = promptOf(calls, 'acceptance:g1');
  assert.match(p, /fails because of the product stays/i);
  assert.match(p, /marked ignored/i);
  assert.ok(p.includes('acceptance-failing: <id>'));
  assert.ok(result.acceptance.failing.includes('G1-01'), 'the failing test is still counted');
});

test('BUILD-21 each failure is a product fix, a test correction citing the spec, or a question in the report', async () => {
  const { calls, result } = await run(buildArgs(), {
    'acceptance:g1': {
      group: 'g1', passing: [], untestable: [], commit: 'c',
      failing: [{ id: 'G1-01', observed: 'a' }, { id: 'G1-02', observed: 'b' }],
    },
    'acceptance:g2': { group: 'g2', passing: [], untestable: [], commit: 'c', failing: [{ id: 'G2-01', observed: 'c' }] },
    'green:1': { fixed: ['G1-01'], corrected: ['G1-02'], questions: [{ id: 'G2-01', question: 'QUESTION-G2: which order?' }], still_failing: [] },
  });
  const p = promptOf(calls, 'green:1');
  assert.ok(p.includes('G1-01') && p.includes('G1-02') && p.includes('G2-01'));
  assert.match(p, /product is wrong[^\n]*smallest fix/i);
  assert.match(p, /test is wrong[^\n]*citing the spec line/i);
  assert.match(p, /spec doesn't decide[^\n]*question/i);
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.green.fixed, ['G1-01']);
  assert.deepEqual(result.green.corrected, ['G1-02']);
  assert.ok(result.questions.some((q) => q.id === 'G2-01' && q.question.includes('QUESTION-G2')));
  assert.ok(!labels(calls).includes('green:2'), 'a question is not retried');
});

test('BUILD-22 a to-green fix that breaks anything else is reverted, never patched on top', async () => {
  const { calls } = await run(buildArgs(), {
    'acceptance:g1': { group: 'g1', passing: [], untestable: [], commit: 'c', failing: [{ id: 'G1-01', observed: 'a' }] },
  });
  const p = promptOf(calls, 'green:1');
  assert.match(p, /whole acceptance suite/i);
  assert.match(p, /reverted/i);
  assert.match(p, /never patched on top/i);
});

test('BUILD-23 no third to-green round; what still fails goes into the report', async () => {
  const { calls, result } = await run(buildArgs(), {
    'acceptance:g1': { group: 'g1', passing: [], untestable: [], commit: 'c', failing: [{ id: 'G1-01', observed: 'a' }, { id: 'G1-02', observed: 'b' }] },
    'green:1': { fixed: ['G1-02'], corrected: [], questions: [], still_failing: ['G1-01'] },
    'green:2': { fixed: [], corrected: [], questions: [], still_failing: ['G1-01'] },
    'green:3': () => { throw new Error('a third round ran'); },
  });
  const rounds = labels(calls).filter((l) => l.startsWith('green:'));
  assert.deepEqual(rounds, ['green:1', 'green:2']);
  assert.ok(promptOf(calls, 'green:2').includes('G1-01'));
  assert.equal(result.green.rounds, 2);
  assert.ok(result.questions.some((q) => q.id === 'G1-01'), JSON.stringify(result.questions));
});

test('BUILD-24 a finished run returns a build report with tasks, gates, flows, counts, questions and blocked items', async () => {
  const { result } = await run(buildArgs(), {
    'acceptance:g1': { group: 'g1', passing: ['G1-02'], failing: [{ id: 'G1-01', observed: 'a' }], untestable: [], commit: 'c' },
    'green:1': { fixed: [], corrected: [], questions: [{ id: 'G1-01', question: 'q?' }], still_failing: [] },
  });
  assert.equal(result.status, 'mvp');
  // tasks: every task of the epic appears in the report.
  const tasksField = result.tasks ?? result.done_now;
  assert.ok(Array.isArray(tasksField), 'no tasks in the report');
  for (const id of ['a', 'c', 'b']) assert.ok(JSON.stringify(tasksField).includes(`"${id}"`), `task ${id} missing`);
  // gates
  assert.ok(result.checkpoint && typeof result.checkpoint.gate_passed === 'boolean', 'no gate result');
  // checkpoint flows
  assert.equal(result.checkpoint.flows.length, 2);
  // acceptance pass and fail counts
  const count = (v) => (Array.isArray(v) ? v.length : v);
  assert.equal(count(result.acceptance.passing), 2); // G1-02 + G2-01
  assert.equal(count(result.acceptance.failing), 1);
  // questions
  assert.ok(Array.isArray(result.questions) && result.questions.length === 1);
  // blocked items (empty on a finished run, but part of the report)
  assert.ok(Array.isArray(result.blocked), `no blocked items in the report: keys ${Object.keys(result).join(', ')}`);
});

test('BUILD-25 the implementer stops and returns blocked for contracts, deps, files outside owns, its tests, privileged work', async () => {
  const { calls, result } = await run(buildArgs(), {
    'impl:a': { status: 'blocked', question: 'QUESTION-A: needs a new dependency', context: 'serde' },
  });
  const p = promptOf(calls, 'impl:a');
  assert.match(p, /stop and return status "blocked"/i);
  assert.match(p, /change a contract/i);
  assert.match(p, /add a dependency/i);
  assert.match(p, /touch a file outside `owns\[\]`/i);
  assert.match(p, /edit the tests it is judged by/i);
  assert.match(p, /privileged or outside the project/i);
  // And a blocked return is taken as blocked, with its question.
  assert.equal(result.status, 'blocked');
  assert.ok(result.blocked.some((b) => b.id === 'a' && b.reason.includes('QUESTION-A')));
  assert.ok(!labels(calls).includes('check:a'), 'a blocked task went on to the checker');
});

test('BUILD-26 what the task text, contracts and tests settle, the implementer decides itself', async () => {
  const { calls } = await run(buildArgs());
  for (const id of ['a', 'c', 'b']) {
    const p = promptOf(calls, `impl:${id}`);
    assert.match(p, /anything the task text, the contracts and the tests settle is yours to decide/i, id);
  }
});

test('BUILD-27 local tasks use git worktrees under a temper-owned directory; ssh tasks run on the host per epic', async () => {
  const local = await run(buildArgs({ repo: '/home/u/proj' }));
  for (const l of ['impl:a', 'check:a', 'merge:wave0']) {
    const p = promptOf(local.calls, l);
    assert.ok(p.includes('git worktrees under /home/u/proj/.temper/worktrees/'), `${l}: ${p}`);
    assert.match(p, /run commands locally/i, l);
  }

  const ssh = await run(buildArgs({ epic: 'hard-1', branch: 'temper/hard-1', host: { kind: 'ssh', name: 'beast', root: '/srv/temper', clone: '/srv/repo' } }));
  for (const l of ['impl:a', 'check:a', 'merge:wave0', 'checkpoint']) {
    const p = promptOf(ssh.calls, l);
    assert.ok(p.includes('build host beast'), `${l}: on the host`);
    assert.ok(p.includes("ssh beast '"), `${l}: commands over ssh`);
    assert.doesNotMatch(p, /run commands locally/i, l);
    // A per-epic build directory: named outright, or as <epic> in a prompt that names the epic.
    const perEpic = p.includes('/srv/temper/hard-1') || (p.includes('/srv/temper/<epic>/') && p.includes('epic hard-1'));
    assert.ok(perEpic, `${l}: no per-epic build directory`);
    assert.ok(!p.includes('.temper/worktrees'), `${l}: local worktree path on an ssh host`);
  }
});

// ---- v0.2: the build rule and the gate wait reach every agent (spec §3.2, §3.5) ----

const RULE = 'Use `make test` only.';
const HOST_LOCAL = 'Work in git worktrees under /r/.temper/worktrees/';
const FIXED = 'Fixed rules (no exception):';

function stabiliseArgs(extra = {}) {
  return {
    epic: EPIC,
    repo: '/r',
    branch: 'temper/e',
    base: 'main',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'QUICK-GATE-CMD', full: 'FULL-GATE-CMD' },
    lenses: [],
    severity_notes: '',
    done: [],
    ...extra,
  };
}

const ruleFinding = {
  id: 'security-01',
  lens: 'security',
  file: 'src/a.rs',
  line: 7,
  summary: 'a summary',
  input: 'an input',
  wrong_result: 'a wrong result',
  severity: 'critical',
  kind: 'fix',
};

function stabiliseResponder({ label }) {
  if (label.startsWith('second:review:')) return { findings: [] };
  if (label.startsWith('review:')) return { findings: label === 'review:security' ? [ruleFinding] : [] };
  if (/^(second:)?verify:/.test(label)) return { real: true, severity: 'critical', reason: 'reproduced' };
  if (label.startsWith('fix:')) return { status: 'fixed', commit: 'sha-fix', note: 'done' };
  if (label.startsWith('regress')) return { regressions: [] };
  throw new Error(`unexpected label ${label}`);
}

function publishResponder({ label }) {
  if (label === 'docs') return { commit: 'ddd', files: ['README.md'], summary: 'docs' };
  if (label === 'evidence') return { script: 's.sh', checklist: 'c.md', commit: 'eee' };
  if (label === 'gate') return { passed: true, exit_status: 0, log: 'full.log' };
  throw new Error(`unexpected label ${label}`);
}

// Every agent call of build, stabilise sweep and fix, and publish, with the given extra args.
async function allStageCalls(extra) {
  const b = await run(buildArgs(extra));
  const sweep = await runWorkflow('workflows/stabilise.js', {
    args: stabiliseArgs({ part: 'sweep', lenses: ['security'], ...extra }),
    respond: stabiliseResponder,
  });
  const fix = await runWorkflow('workflows/stabilise.js', {
    args: stabiliseArgs({ part: 'fix', selected: [ruleFinding], ...extra }),
    respond: stabiliseResponder,
  });
  const pub = await runWorkflow('workflows/publish.js', {
    args: { ...stabiliseArgs(), spec: 'docs/temper/e/spec.md', ...extra },
    respond: publishResponder,
  });
  const stages = { build: b.calls, sweep: sweep.calls, fix: fix.calls, publish: pub.calls };
  for (const [name, calls] of Object.entries(stages)) assert.ok(calls.length > 0, `${name}: no agent calls`);
  assert.ok(labels(fix.calls).some((l) => l.startsWith('fix:')), 'the fix part ran a fix agent');
  return Object.entries(stages).flatMap(([name, calls]) => calls.map((c) => ({ stage: name, label: c.opts.label, prompt: c.prompt })));
}

test('BUILD-31 the project build rule is in every agent prompt of all three stages, after the host text and before the fixed rules', async () => {
  const calls = await allStageCalls({ build_rule: RULE });
  for (const { stage, label, prompt } of calls) {
    const where = `${stage} ${label}`;
    assert.ok(prompt.includes(RULE), `${where}: no build rule`);
    const h = prompt.indexOf(HOST_LOCAL);
    const r = prompt.indexOf(RULE);
    const f = prompt.indexOf(FIXED);
    assert.ok(h >= 0, `${where}: no host text`);
    assert.ok(h < r && r < f, `${where}: order host ${h}, rule ${r}, fixed ${f}`);
  }
});

test('BUILD-32 every agent prompt says a gate waiting for a slot is normal and never a failure', async () => {
  const calls = await allStageCalls({});
  for (const { stage, label, prompt } of calls) {
    assert.ok(prompt.includes('that wait is normal and is not a failure'), `${stage} ${label}`);
  }
});

// ---- v0.2: commits that reach their branch (spec §3.1) ----

test('BUILD-28 every agent that commits is told to commit on its branch and check it moved', async () => {
  const failingG1 = {
    'acceptance:g1': { group: 'g1', passing: [], failing: [{ id: 'G1-01', observed: 'x' }], untestable: [], commit: 'c' },
  };
  const local = await run(buildArgs(), failingG1);
  const fix = await runWorkflow('workflows/stabilise.js', {
    args: stabiliseArgs({ part: 'fix', selected: [ruleFinding] }),
    respond: stabiliseResponder,
  });
  const pub = await runWorkflow('workflows/publish.js', {
    args: { ...stabiliseArgs(), spec: 'docs/temper/e/spec.md' },
    respond: publishResponder,
  });
  const committing = [
    ...['impl:a', 'merge:wave0', 'checkpoint', 'behaviour-spec', 'acceptance:g1', 'green:1'].map((l) => [l, promptOf(local.calls, l)]),
    ['fix:security-01', promptOf(fix.calls, 'fix:security-01')],
    ['docs', promptOf(pub.calls, 'docs')],
    ['evidence', promptOf(pub.calls, 'evidence')],
  ];
  for (const [l, p] of committing) {
    assert.ok(p.includes('git symbolic-ref --short HEAD'), `${l}: no branch check before committing`);
    assert.ok(p.includes('git rev-parse'), `${l}: no tip check after committing`);
    assert.match(p, /never repair a branch by hand/i, l);
  }
  const impl = promptOf(local.calls, 'impl:a');
  assert.ok(impl.includes('git worktree add -b temper/e/a'), impl);
  assert.ok(impl.includes('git rev-parse temper/e/a'));
  for (const [l, p] of committing.slice(1)) {
    assert.ok(p.includes('.temper/worktrees/e/epic'), `${l}: no shared epic worktree`);
    assert.ok(p.includes('git rev-parse temper/e'), l);
  }

  // On an ssh host: the shared epic worktree is under <root>/<epic>/, and detaching comes after the check.
  const ssh = await run(
    buildArgs({ epic: 'hard-1', branch: 'temper/hard-1', host: { kind: 'ssh', name: 'buildhost', root: '/srv/temper', clone: '/srv/repo' } }),
    failingG1,
  );
  for (const l of ['merge:wave0', 'checkpoint', 'behaviour-spec', 'acceptance:g1', 'green:1']) {
    const p = promptOf(ssh.calls, l);
    assert.ok(p.includes('/srv/temper/hard-1/epic'), `${l}: no shared epic worktree on the host`);
    assert.ok(p.includes('after the commit check'), l);
  }
});

test('BUILD-29 the checker fails a task whose branch tip is not the reported commit, or is already on the epic branch', async () => {
  const { calls } = await run(buildArgs(), {
    'impl:a': { status: 'done', branch: 'temper/e/a', commit: 'deadbeef1', summary: 'did a' },
  });
  const p = promptOf(calls, 'check:a');
  assert.ok(p.includes('deadbeef1'), 'the checker is not given the reported sha');
  assert.ok(p.includes('git rev-parse temper/e/a'));
  assert.ok(p.includes('git merge-base --is-ancestor deadbeef1 temper/e'));
  assert.ok(p.includes("A tip that didn't move fails the check."));
});

test('BUILD-30 build returns commits: the sha each phase reported, never an empty one', async () => {
  const over = {
    checkpoint: {
      gate_passed: true, gate_log: 'l', flows: [], gaps: [], commit: 'c1',
    },
    'behaviour-spec': { groups: GROUPS, commit: 'b1' },
    'acceptance:g1': { group: 'g1', passing: [], failing: [{ id: 'G1-01', observed: 'x' }], untestable: [], commit: 'a1' },
    'acceptance:g2': { group: 'g2', passing: ['G2-01'], failing: [], untestable: [] },
    'green:1': { fixed: ['G1-01'], corrected: [], questions: [], still_failing: [], commit: '' },
  };
  const { result } = await run(buildArgs(), over);
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.commits, { checkpoint: 'c1', 'behaviour-spec': 'b1', 'acceptance:g1': 'a1' });

  // A run blocked at acceptance still carries what was committed before it.
  const blocked = await run(buildArgs(), { ...over, 'acceptance:g1': null });
  assert.equal(blocked.result.status, 'blocked');
  assert.deepEqual(blocked.result.commits, { checkpoint: 'c1', 'behaviour-spec': 'b1' });

  // A checkpoint whose full gate failed still committed its log section: its sha is returned.
  const red = await run(buildArgs(), { ...over, checkpoint: { ...over.checkpoint, gate_passed: false, commit: 'c0' } });
  assert.equal(red.result.status, 'blocked');
  assert.deepEqual(red.result.commits, { checkpoint: 'c0' });

  // A run blocked in the waves carries an empty map; a refused args.json carries none.
  const waves = await run(buildArgs(), { 'impl:a': null });
  assert.equal(waves.result.status, 'blocked');
  assert.deepEqual(waves.result.commits, {});
  const invalid = await run({ ...buildArgs(), tasks: 'x' });
  assert.equal(invalid.result.status, 'invalid');
  assert.ok(!('commits' in invalid.result));
});

// ---- v0.2: known flaky tests in quick gates (spec §3.6) ----

test('BUILD-33 quick-gate prompts carry the flaky list and the rerun-once rule; full-gate prompts say never rerun', async () => {
  const failingG1 = {
    'acceptance:g1': { group: 'g1', passing: [], failing: [{ id: 'G1-01', observed: 'x' }], untestable: [], commit: 'c' },
  };
  const b = await run(buildArgs({ flaky: ['t::a'] }), failingG1);
  const fix = await runWorkflow('workflows/stabilise.js', {
    args: stabiliseArgs({ part: 'fix', selected: [ruleFinding], flaky: ['t::a'] }),
    respond: stabiliseResponder,
  });
  const pub = await runWorkflow('workflows/publish.js', {
    args: { ...stabiliseArgs(), spec: 'docs/temper/e/spec.md', flaky: ['t::a'] },
    respond: publishResponder,
  });
  const quick = [
    ...['impl:a', 'check:a', 'merge:wave0', 'green:1'].map((l) => [l, promptOf(b.calls, l)]),
    ['fix:security-01', promptOf(fix.calls, 'fix:security-01')],
  ];
  for (const [l, p] of quick) {
    assert.ok(p.includes('t::a'), `${l}: no flaky list`);
    assert.ok(p.includes('rerun it once'), `${l}: no rerun-once rule`);
  }
  for (const [l, p] of [['checkpoint', promptOf(b.calls, 'checkpoint')], ['gate', promptOf(pub.calls, 'gate')]]) {
    assert.ok(p.includes('it is never rerun'), `${l}: does not say the full gate is never rerun`);
    assert.ok(!p.includes('t::a'), `${l}: carries the flaky list`);
    assert.ok(!p.includes('rerun it once'), `${l}: carries the rerun-once rule`);
  }

  const none = await allStageCalls({});
  for (const { stage, label, prompt } of none) {
    assert.ok(!prompt.includes('rerun it once'), `${stage} ${label}: carries the rerun-once rule with no list`);
    assert.ok(!prompt.includes('Known flaky tests'), `${stage} ${label}: carries a flaky list with no list`);
  }
  // With no list the full-gate prompts still say the full gate is never rerun.
  const fullNone = none.filter(({ stage, label }) => (stage === 'build' && label === 'checkpoint') || (stage === 'publish' && label === 'gate'));
  assert.equal(fullNone.length, 2, 'the checkpoint and publish gate ran with no list');
  for (const { stage, label, prompt } of fullNone) assert.ok(prompt.includes('it is never rerun'), `${stage} ${label}: no NO_RERUN with no list`);
});

test('BUILD-34 build collects flaky_reruns from every agent that reports them', async () => {
  const reruns = [{ test: 't::a', gate: 'quick' }];
  const { result } = await run(buildArgs({ tasks: [task('t1', 0)], flaky: ['t::a'] }), {
    'impl:t1': { status: 'done', branch: 'temper/e/t1', commit: 'abc', summary: 'did t1', flaky_reruns: reruns },
    'check:t1': { pass: true, problems: [], flaky_reruns: reruns },
    'merge:wave0': { status: 'merged', merged: ['t1'], gate_passed: true, flaky_reruns: reruns },
    // One failing acceptance test sends the run to green, whose round reports a rerun too.
    'acceptance:g1': { group: 'g1', passing: [], failing: [{ id: 'G1-01', observed: 'x' }], untestable: [], commit: 'c' },
    'green:1': { fixed: ['G1-01'], corrected: [], questions: [], still_failing: [], flaky_reruns: reruns },
  });
  assert.equal(result.status, 'mvp');
  assert.deepEqual(result.flaky_reruns, [
    { id: 'impl:t1', test: 't::a', gate: 'quick' },
    { id: 'check:t1', test: 't::a', gate: 'quick' },
    { id: 'merge:wave0', test: 't::a', gate: 'quick' },
    { id: 'green:1', test: 't::a', gate: 'quick' },
  ]);

  // A blocked run still carries the reruns reported before it; a run with none carries [].
  const blocked = await run(buildArgs({ tasks: [task('t1', 0)] }), {
    'check:t1': { pass: true, problems: [], flaky_reruns: reruns },
    'merge:wave0': { status: 'blocked', merged: [], gate_passed: false },
  });
  assert.equal(blocked.result.status, 'blocked');
  assert.deepEqual(blocked.result.flaky_reruns, [{ id: 'check:t1', test: 't::a', gate: 'quick' }]);
  const plain = await run(buildArgs());
  assert.deepEqual(plain.result.flaky_reruns, []);
});
