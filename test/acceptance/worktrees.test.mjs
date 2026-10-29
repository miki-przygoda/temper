// Acceptance tests for the worktrees group (docs/temper/v0-3/behaviour.md, WORKTREES-01..08).
// throwawayText and tmpLabel are the API the spec names, called from src/lib.js; the prompts are
// read from the agent calls the bundled workflows/*.js make through the harness, the way the head
// launches them. WORKTREES-09..19 (cleanup_check.py --detached and host_sync.py fetch --prune) are
// in tests_py/acceptance/test_worktrees.py. A test that fails because of the product is skipped
// with "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib, runWorkflow } from '../harness.mjs';

const lib = loadLib();
const EPIC = 'e';

const LOCAL = { kind: 'local' };
const SSH = { kind: 'ssh', name: 'buildhost', root: '/srv/wt/', clone: '/srv/clone' };

const common = (host) => ({
  epic: EPIC,
  repo: '/r',
  branch: 'temper/e',
  base: 'main',
  log: 'docs/temper/e/log.md',
  spec: 'docs/temper/e/spec.md',
  plan: 'docs/temper/e/plan.md',
  host,
  gates: { quick: 'QUICK-GATE-CMD', full: 'FULL-GATE-CMD' },
  done: [],
});

const buildArgs = (host) => ({
  ...common(host),
  tasks: [{ id: 'a', title: 'Title a', wave: 0, owns: ['src/a.rs'], uses: [], provides: [], text: 'build a' }],
  behaviour_groups: [],
  answers: {},
});

const stabiliseArgs = (host, extra = {}) => ({
  ...common(host), part: 'sweep', lenses: [], severity_notes: '', ...extra,
});

const finding = (id) => ({
  id, lens: 'security', file: 'src/a.rs', line: 7, summary: `summary ${id}`,
  input: `INPUT-${id}`, wrong_result: `WRONG-${id}`, severity: 'critical', kind: 'fix',
});

// Every agent succeeds; the checker passes, reviewers report one finding the verifier confirms.
function respond({ label }) {
  if (label.startsWith('impl:') || label.startsWith('retry:')) {
    return { status: 'done', branch: 'temper/e/a', commit: 'abcabc01', summary: 'did a' };
  }
  if (label.startsWith('check:') || label.startsWith('recheck:')) return { pass: true, problems: [] };
  if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
  if (label === 'checkpoint') return { status: 'done', gate_passed: true, gate_log: 'l', flows: [], gaps: [], commit: 'aaaaaa01' };
  if (label === 'behaviour-spec') return { status: 'done', groups: [], commit: 'bbbbbb02' };
  if (label.startsWith('second:review:')) return { findings: [] };
  if (label.startsWith('review:security')) return { findings: [finding('security-01')] };
  if (label.startsWith('review:')) return { findings: [] };
  if (/^(second:)?verify:/.test(label)) return { real: true, severity: 'critical', reason: 'reproduced' };
  if (label.startsWith('fix:')) return { status: 'fixed', commit: 'f1f1f1f1', note: 'n' };
  if (label.startsWith('regress:fix:')) return { regressions: [] };
  if (label === 'docs') return { status: 'done', commit: 'eeeeee05', files: ['README.md'], summary: 'docs' };
  if (label === 'evidence') return { status: 'done', script: 's.sh', checklist: 'c.md', commit: 'ffffff06' };
  if (label === 'gate') return { passed: true, exit_status: 0, log: 'full.log' };
  return null;
}

// Every prompt the checker, reviewer, verifier, regression and gate agents get, with the args used.
async function throwawayPrompts(host) {
  const out = [];
  const b = buildArgs(host);
  for (const c of (await runWorkflow('workflows/build.js', { args: b, respond })).calls) out.push({ args: b, c });
  const s = stabiliseArgs(host);
  for (const c of (await runWorkflow('workflows/stabilise.js', { args: s, respond })).calls) out.push({ args: s, c });
  const f = stabiliseArgs(host, { part: 'fix', selected: [finding('security-01')] });
  for (const c of (await runWorkflow('workflows/stabilise.js', { args: f, respond })).calls) out.push({ args: f, c });
  const p = common(host);
  for (const c of (await runWorkflow('workflows/publish.js', { args: p, respond })).calls) out.push({ args: p, c });
  return out.filter(({ c }) => /^(check|recheck|review|second:review|verify|second:verify|regress|gate)(:|$)/.test(c.opts.label));
}

const kindOf = (label) => label.match(/^(check|recheck|review|second:review|verify|second:verify|regress|gate)/)[1];

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (const ch of s) {
    // The labels used here are ASCII, so a code unit is a byte.
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

test('WORKTREES-01 a local throwaway is <repo>/.temper/worktrees/<epic>/tmp/<tmpLabel(label)>', () => {
  for (const label of ['check:a', 'gate', 'review:failure paths and lifecycle']) {
    const t = lib.throwawayText(buildArgs(LOCAL), label);
    assert.ok(t.includes(`\`/r/.temper/worktrees/e/tmp/${lib.tmpLabel(label)}\``), t);
  }
});

test('WORKTREES-02 an ssh throwaway is <root>/<epic>/tmp/<tmpLabel(label)>', () => {
  for (const label of ['check:a', 'gate', 'regress:fix:f1']) {
    const t = lib.throwawayText(buildArgs(SSH), label);
    assert.ok(t.includes(`\`/srv/wt/e/tmp/${lib.tmpLabel(label)}\``), t);
    assert.ok(!t.includes('/r/.temper'), t);
  }
});

test('WORKTREES-03 the throwaway is created detached and left in place for cleanup', () => {
  for (const host of [LOCAL, SSH]) {
    const a = buildArgs(host);
    const t = lib.throwawayText(a, 'check:a');
    const path = `${host.kind === 'ssh' ? '/srv/wt' : '/r/.temper/worktrees'}/e/tmp/${lib.tmpLabel('check:a')}`;
    assert.ok(t.includes(`git worktree add --detach ${path} `), t);
    assert.match(t, /Leave the worktree in place when you finish/, t);
    assert.match(t, /you never delete a worktree/, t);
    assert.match(t, /cleanup removes it/, t);
  }
});

test('WORKTREES-04 checker, reviewer, verifier, regression and gate prompts name their throwaway under tmp/', async () => {
  for (const host of [LOCAL, SSH]) {
    const seen = new Set();
    for (const { args, c } of await throwawayPrompts(host)) {
      const label = c.opts.label;
      seen.add(kindOf(label));
      const text = lib.throwawayText(args, label);
      const dir = host.kind === 'ssh' ? '/srv/wt/e/tmp/' : '/r/.temper/worktrees/e/tmp/';
      assert.ok(text.includes(`${dir}${lib.tmpLabel(label)}`), text);
      assert.ok(c.prompt.includes(text), `${label}: ${c.prompt}`);
    }
    for (const k of ['check', 'review', 'verify', 'regress', 'gate']) assert.ok(seen.has(k), `${host.kind}: no ${k} prompt; saw ${[...seen]}`);
  }
});

test('WORKTREES-05 no throwaway prompt tells the agent to remove a worktree; the fixed rule stays', async () => {
  for (const host of [LOCAL, SSH]) {
    const prompts = await throwawayPrompts(host);
    assert.ok(prompts.length >= 5);
    for (const { c } of prompts) {
      const label = c.opts.label;
      assert.ok(!/git\s+worktree\s+remove/.test(c.prompt), `${label}: ${c.prompt}`);
      assert.ok(!/worktree\s+prune/.test(c.prompt), `${label}: ${c.prompt}`);
      assert.ok(!/\brm\s+-r/.test(c.prompt), `${label}: ${c.prompt}`);
      assert.ok(!/\b(remove|delete) (it|the worktree|your worktree|the throwaway)\b/i.test(c.prompt), `${label}: ${c.prompt}`);
      assert.ok(c.prompt.includes('- never push, merge, or delete branches or worktrees;'), `${label}: ${c.prompt}`);
    }
  }
});

test('WORKTREES-06 tmpLabel lowercases, sanitises to [a-z0-9-] and appends the FNV-1a hash of the raw label', () => {
  const labels = ['check:t1', 'gate', 'review:Failure Paths and Lifecycle', 'regress:fix:f1',
    'verify:../../etc', 'second:verify:second:security-02', 'A_B/c d', '-x-'];
  for (const label of labels) {
    const want = `${label.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${fnv1a(label)}`;
    const got = lib.tmpLabel(label);
    assert.equal(got, want, label);
    assert.match(got, /^[a-z0-9-]+$/, label);
    assert.ok(!got.includes('/') && !got.includes('.'), label);
  }
  // The hash is of the raw label, before lowercasing.
  assert.notEqual(lib.tmpLabel('Gate'), lib.tmpLabel('gate'));
  assert.equal(lib.tmpLabel('gate'), 'gate-1660eb12');
});

test('WORKTREES-07 a:b and a-b get different throwaway names', () => {
  assert.notEqual(lib.tmpLabel('a:b'), lib.tmpLabel('a-b'));
  assert.ok(lib.tmpLabel('a:b').startsWith('a-b-'));
  assert.ok(lib.tmpLabel('a-b').startsWith('a-b-'));
  const a = buildArgs(LOCAL);
  assert.notEqual(lib.throwawayText(a, 'a:b'), lib.throwawayText(a, 'a-b'));
});

test('WORKTREES-08 an existing throwaway is reused with checkout --detach, never removed, else blocked', async () => {
  for (const host of [LOCAL, SSH]) {
    for (const { c } of await throwawayPrompts(host)) {
      const label = c.opts.label;
      const dir = host.kind === 'ssh' ? '/srv/wt/e/tmp/' : '/r/.temper/worktrees/e/tmp/';
      const path = `${dir}${lib.tmpLabel(label)}`;
      assert.match(c.prompt, /If it already exists[^\n]*reuse it/, label);
      assert.ok(c.prompt.includes(`\`git -C ${path} checkout --detach <the branch or commit you check>\``), `${label}: ${c.prompt}`);
      // failure-paths-and-lifecycle-01: checkout --detach keeps a dead agent's dirty files, and a plain
      // directory at the path is inside the main checkout, so both are checked before the checkout.
      const top = c.prompt.indexOf(`\`git -C ${path} rev-parse --show-toplevel\` prints the same directory as \`cd ${path} && pwd -P\``);
      const clean = c.prompt.indexOf(`\`git -C ${path} status --porcelain\` prints nothing`);
      const co = c.prompt.indexOf(`\`git -C ${path} checkout --detach `);
      assert.ok(top >= 0 && clean >= 0 && top < co && clean < co, `${label}: ${c.prompt}`);
      assert.match(c.prompt, /never delete or clean the path/, label);
      assert.match(c.prompt, /If either check or the checkout fails, stop and report the reason in your result as blocked/, label);
      assert.match(c.prompt, /you never delete a worktree/, label);
    }
  }
});
