// Acceptance tests for the publish group (docs/v1-behaviour.md, PUBLISH-01..08).
// They drive the bundled workflows/publish.js through the harness, the way the head launches it
// (args from args.json, per skills/run/SKILL.md stage 5), with scripted agents that do what their
// prompts say in a throwaway git repo that has a bare `origin`. What the head does with the result
// (push, ask, never merge) is read from the skills, the preferences template and the README.
// A test that fails because of the product is skipped with "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from '../harness.mjs';
import { namesField, schemaCases } from '../schema-cases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF = 'workflows/publish.js';
const EPIC = 'e';
const BRANCH = 'temper/e';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const RUN_SKILL = read('skills/run/SKILL.md');
const STAGE5 = RUN_SKILL.slice(RUN_SKILL.indexOf('## Stage 5'), RUN_SKILL.indexOf('## Status and the board'));

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// A stabilised epic branch in a throwaway repo, with a bare `origin` that has only the base branch.
function stabilisedRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'temper-publish-'));
  const origin = join(dir, 'origin.git');
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.invalid');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), '# app\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-q', '-b', BRANCH);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'app.js'), 'export const greet = (n) => `hello ${n}`;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'feat: greet\n\nTemper-Task: e/t1');
  mkdirSync(join(repo, 'docs', 'temper', EPIC), { recursive: true });
  writeFileSync(join(repo, 'docs', 'temper', EPIC, 'log.md'), '# log\n\n## Open items\n\n- a minor thing\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'docs: log\n\nTemper-Task: e/stabilise');
  return { dir, repo, origin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function args(repo, extra = {}) {
  return {
    epic: EPIC,
    repo,
    branch: BRANCH,
    base: 'main',
    log: 'docs/temper/e/log.md',
    spec: 'docs/temper/e/spec.md',
    host: { kind: 'local' },
    gates: { quick: 'true', full: 'test -f src/app.js' },
    done: [],
    ...extra,
  };
}

const ticked = (prompt, re) => {
  const m = prompt.match(re);
  assert.ok(m, `prompt names ${re}:\n${prompt}`);
  return m[1];
};

function commit(repo, files, message) {
  git(repo, 'add', ...files);
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

// Scripted agents that do what their prompts say, in `repo`.
function agents(repo, { gateResult } = {}) {
  return ({ prompt, label }) => {
    if (label === 'docs') {
      const body = ticked(prompt, /`([^`]*pr-body\.md)`/);
      writeFileSync(join(repo, body), '## What changed\n\ngreet()\n\n## Open items\n\n- a minor thing\n');
      writeFileSync(join(repo, 'README.md'), '# app\n\n`greet(name)` says hello.\n');
      const sha = commit(repo, [body, 'README.md'], `docs: greet\n\nTemper-Task: e/docs`);
      return { commit: sha, files: ['README.md', body], summary: 'Add greet\nwith more detail' };
    }
    if (label === 'evidence') {
      const script = ticked(prompt, /`([^`]*\.sh)`/);
      const checklist = ticked(prompt, /`([^`]*checklist[^`]*\.md)`/);
      writeFileSync(join(repo, script), '#!/bin/sh\n# run as root, by the owner\nsudo systemctl restart app\n');
      writeFileSync(join(repo, checklist), '- [ ] restart the app as root and check it greets\n');
      const sha = commit(repo, [script, checklist], `docs: owner evidence\n\nTemper-Task: e/evidence`);
      return { script, checklist, commit: sha };
    }
    if (label === 'gate') {
      if (gateResult) return gateResult;
      const cmd = ticked(prompt, /on `[^`]+`: `([^`]+)`/);
      const r = spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8' });
      const log = join(repo, '..', 'gate.log');
      writeFileSync(log, `${r.stdout}${r.stderr}`);
      return { passed: r.status === 0, exit_status: r.status, log_path: log };
    }
    throw new Error(`unexpected label ${label}`);
  };
}

const originRefs = (origin) => git(origin, 'for-each-ref', '--format=%(refname)').split('\n').filter(Boolean);

// Text that tells an agent to push or to open/create a PR. Negated rules ("never push") are removed first.
const PUSH_OR_PR = /\bgit push\b|\bgh pr\b|\bpush(?:es|ing)?\b|\b(?:open|create|raise|submit)(?:s|ing)?\s+(?:a|the|an)?\s*(?:pull request|PR)\b/i;
function withoutNegations(prompt) {
  return prompt
    .replace(/\bnever push, merge, or delete branches or worktrees;/g, '')
    .replace(/\bNever push from the host\./g, '');
}

async function allPublishPrompts() {
  const prompts = [];
  const scenarios = [
    { host: { kind: 'local' }, done: [] },
    { host: { kind: 'ssh', name: 'beast', root: '/srv/temper', clone: '/srv/repo' }, done: [] },
    { host: { kind: 'local' }, done: ['docs'] },
    { host: { kind: 'local' }, done: ['docs', 'evidence'] },
  ];
  for (const s of scenarios) {
    for (const gatePassed of [true, false]) {
      const { calls } = await runWorkflow(WF, {
        args: args('/r', { host: s.host, done: s.done }),
        respond: ({ label }) => ({
          docs: { commit: 'd', files: ['README.md'], summary: 'x' },
          evidence: { script: 's.sh', checklist: 'c.md', commit: 'v' },
          gate: { passed: gatePassed, exit_status: gatePassed ? 0 : 1, log_path: '/l' },
        })[label],
      });
      for (const c of calls) prompts.push({ label: c.opts.label, prompt: c.prompt });
    }
  }
  return prompts;
}

test('PUBLISH args: every common field the args schema names, and spec, are refused missing or of the wrong type, before any agent (SECOND-TESTS-DOCS-4)', async () => {
  const full = args('/r', { default_branch: 'main', done: ['x1'] });
  const ssh = { ...full, host: { kind: 'ssh', name: 'beast', root: '/srv/temper', clone: '/srv/repo' } };
  const only = [...['epic', 'repo', 'branch', 'base', 'default_branch', 'log', 'host', 'gates', 'done'], 'spec'];
  const cases = [...schemaCases(full, { only }), ...schemaCases(ssh, { only }).filter((c) => c.name.startsWith('host'))];
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

test('PUBLISH-01 on a stabilised branch publish writes docs against the final code, an evidence script and checklist, and a PR title and body file', async () => {
  const r = stabilisedRepo();
  try {
    const before = git(r.repo, 'rev-parse', 'HEAD');
    const { result, calls } = await runWorkflow(WF, { args: args(r.repo), respond: agents(r.repo) });
    assert.equal(result.status, 'ready');

    const docs = calls.find((c) => c.opts.label === 'docs');
    assert.ok(docs, 'a docs agent ran');
    assert.match(docs.prompt, /against the final code/);
    assert.match(docs.prompt, /read the code/);
    assert.ok(docs.prompt.includes(`\`${BRANCH}\``), 'docs are written on the epic branch');

    const evidence = calls.find((c) => c.opts.label === 'evidence');
    assert.ok(evidence, 'an evidence agent ran');
    assert.ok(existsSync(join(r.repo, result.evidence.script)), 'the evidence script is on disk');
    assert.ok(existsSync(join(r.repo, result.evidence.checklist)), 'the evidence checklist is on disk');

    assert.equal(typeof result.pr.title, 'string');
    assert.ok(result.pr.title.trim() !== '', 'a PR title');
    assert.ok(!result.pr.title.includes('\n'), 'a PR title is one line');
    assert.ok(existsSync(join(r.repo, result.pr.body_file)), 'the returned PR body file is the one the docs agent wrote');
    assert.match(readFileSync(join(r.repo, result.pr.body_file), 'utf8'), /What changed/);

    // All of it is committed on the epic branch, on top of the stabilised code.
    const changed = git(r.repo, 'diff', '--name-only', `${before}..HEAD`).split('\n');
    for (const f of [result.pr.body_file, result.evidence.script, result.evidence.checklist, 'README.md']) {
      assert.ok(changed.includes(f), `${f} committed on the branch`);
    }
    assert.equal(git(r.repo, 'status', '--porcelain'), '');
  } finally {
    r.cleanup();
  }
});

test('PUBLISH-02 publish returns ready with a PR title and the body file path, and has neither pushed nor opened a PR', async () => {
  const r = stabilisedRepo();
  try {
    const refsBefore = originRefs(r.origin);
    const { result, calls } = await runWorkflow(WF, { args: args(r.repo), respond: agents(r.repo) });
    assert.equal(result.status, 'ready');
    assert.equal(typeof result.pr.title, 'string');
    assert.ok(result.pr.title.trim() !== '');
    assert.equal(typeof result.pr.body_file, 'string');
    assert.ok(existsSync(join(r.repo, result.pr.body_file)), 'pr.body_file is a path to the body file');

    // Nothing reached the remote: origin still has only the base branch, and the branch has no upstream.
    assert.deepEqual(originRefs(r.origin), refsBefore);
    assert.deepEqual(refsBefore, ['refs/heads/main']);
    const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', `${BRANCH}@{upstream}`], { cwd: r.repo });
    assert.notEqual(upstream.status, 0, 'the epic branch has no upstream');

    // The script itself has no way to push or open a PR, and asks no agent to.
    const source = read(WF);
    assert.doesNotMatch(source, /\bgit push\b|\bgh pr\b/);
    for (const c of calls) assert.doesNotMatch(withoutNegations(c.prompt), PUSH_OR_PR, c.opts.label);
    assert.ok(!('pushed' in result) || result.pushed === false);
    assert.ok(!('pr_url' in result.pr));
  } finally {
    r.cleanup();
  }
});

test('PUBLISH-03 no prompt publish.js gives an agent tells it to push or open a PR', async () => {
  const prompts = await allPublishPrompts();
  const seen = new Set(prompts.map((p) => p.label));
  assert.deepEqual([...seen].sort(), ['docs', 'evidence', 'gate']);
  for (const { label, prompt } of prompts) {
    assert.doesNotMatch(withoutNegations(prompt), PUSH_OR_PR, `${label} prompt mentions pushing or opening a PR`);
    assert.match(prompt, /never push, merge/, `${label} prompt carries the rule against pushing`);
  }
});

test('PUBLISH-04 ready with a green gate and may_push yes: the head pushes the branch and opens the PR', () => {
  // The head's rule: push only when status is ready, gate.passed is true, and may_push is yes (or ask + yes).
  assert.match(STAGE5, /`ready`: it carries `pr\.title` and `pr\.body_file`\. Push and open the PR[^\n]*only when all of these hold/);
  assert.match(STAGE5, /`status` is `ready` and `gate\.passed` is true/);
  assert.match(STAGE5, /`may_push` is `yes` in `preferences\.md`/);
  assert.match(STAGE5, /git push -u origin <branch>/);
  assert.match(STAGE5, /gh pr create --base <base> --head <branch> --title <pr\.title_shell> --body-file <pr\.body_file>/);
  // `yes` is a value the user can choose, and the preferences file documents it.
  assert.match(read('skills/setup/SKILL.md'), /\| `may_push` \|[^\n]*`yes`/);
  assert.match(read('templates/preferences.md'), /may push branches and open PRs on a green full gate: ask, yes or no/);
  // The head does it, not a workflow: the run skill hands it pr.title and pr.body_file from a real ready result.
  assert.match(read('README.md'), /Only the head pushes; the workflows and their agents never do\./);
});

test('PUBLISH-05 may_push not yes: the head asks the user, and pushes and opens the PR only on a yes', async (t) => {
  await t.test('may_push: ask asks, and pushes only on yes', () => {
    assert.match(STAGE5, /or it is `ask` and the user says yes now/);
    assert.match(read('templates/preferences.md'), /^may_push: ask$/m);
  });
  await t.test('every value other than yes asks (spec 8: "Otherwise it asks"; A5: "or the user says yes")', () => {
    // The setup skill offers ask, yes and no. With `no` the behaviour still says the head asks.
    const noRule = STAGE5.match(/With `may_push: no`[^\n]*/);
    if (noRule) assert.match(noRule[0], /ask/i, `may_push: no does not ask: "${noRule[0]}"`);
    assert.doesNotMatch(STAGE5, /With `may_push: no`, don't push; tell the user the branch is ready\./);
  });
});

test('PUBLISH-06 the full gate is not green: nothing is pushed and no PR is opened, whatever the preferences say', async (t) => {
  await t.test('a red full gate ends publish with gate_failed, no PR, nothing on the remote', async () => {
    const r = stabilisedRepo();
    try {
      const { result } = await runWorkflow(WF, { args: args(r.repo, { gates: { quick: 'true', full: 'exit 3' } }), respond: agents(r.repo) });
      assert.equal(result.status, 'gate_failed');
      assert.equal(result.gate.passed, false);
      assert.equal(result.gate.exit_status, 3);
      assert.ok(!('pr' in result), 'no PR title or body is handed to the head');
      assert.deepEqual(originRefs(r.origin), ['refs/heads/main']);
    } finally {
      r.cleanup();
    }
  });
  await t.test('a gate agent that returns nothing is not green', async () => {
    const r = stabilisedRepo();
    try {
      const respond = agents(r.repo);
      const { result } = await runWorkflow(WF, { args: args(r.repo), respond: (q) => (q.label === 'gate' ? null : respond(q)) });
      assert.notEqual(result.status, 'ready');
      assert.ok(!('pr' in result));
    } finally {
      r.cleanup();
    }
  });
  await t.test('the head pushes only on ready with gate.passed true, and never on gate_failed, even with may_push yes', () => {
    assert.match(STAGE5, /`gate_failed`: don't push\./);
    assert.match(STAGE5, /only when all of these hold:\n\s*- `status` is `ready` and `gate\.passed` is true;\n\s*- `may_push` is `yes`/);
    assert.match(read('skills/setup/SKILL.md'), /it pushes and opens PRs only on a green full gate/);
  });
  await t.test('a gate result with a non-zero exit status is not green', async () => {
    const r = stabilisedRepo();
    try {
      const { result } = await runWorkflow(WF, {
        args: args(r.repo),
        respond: agents(r.repo, { gateResult: { passed: true, exit_status: 1, log_path: '/l' } }),
      });
      assert.notEqual(result.status, 'ready', 'a full gate that exited 1 was reported ready');
      assert.ok(!('pr' in result));
    } finally {
      r.cleanup();
    }
  });
});

test('PUBLISH-07 steps that need root go into a script and a checklist for the user, and no agent runs them', async () => {
  const r = stabilisedRepo();
  try {
    const { result, calls } = await runWorkflow(WF, { args: args(r.repo), respond: agents(r.repo) });
    const evidence = calls.find((c) => c.opts.label === 'evidence').prompt;
    assert.match(evidence, /Steps that need root[^\n]*go into `[^`]+\.sh` and `[^`]+\.md`/);
    assert.match(evidence, /Agents never run them: write them for the owner, and run none of them\./);
    // The steps reach the user as a script and a checklist on the branch.
    assert.equal(statSync(join(r.repo, result.evidence.script)).isFile(), true);
    assert.equal(statSync(join(r.repo, result.evidence.checklist)).isFile(), true);
    // No agent in publish may run privileged commands, and the gate runs only the full gate command.
    for (const c of calls) assert.match(c.prompt, /no privileged commands \(no sudo, not even `sudo -n`\)/, c.opts.label);
    const gate = calls.find((c) => c.opts.label === 'gate').prompt;
    assert.doesNotMatch(gate, /owner-steps|checklist/);
    // The fixed rule is stated to the user.
    assert.match(read('README.md'), /Steps that need root go into a script and a checklist for you\./);
  } finally {
    r.cleanup();
  }
});

test('PUBLISH-08 an open PR is never merged by temper', async () => {
  assert.match(STAGE5, /You never merge: merging is the user's, always\. Never merge a PR, never enable auto-merge, never push to `base`\./);
  // Nothing temper ships tells anyone to merge a PR or turn on auto-merge.
  const shipped = [];
  const walk = (d) => {
    for (const name of readdirSync(join(ROOT, d))) {
      const p = `${d}/${name}`;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (/\.(md|js|py|sh|json)$/.test(name)) shipped.push(p);
    }
  };
  for (const d of ['skills', 'workflows', 'scripts', 'hooks', 'statusline', 'templates']) if (existsSync(join(ROOT, d))) walk(d);
  for (const p of shipped) {
    const text = read(p).replace(/never enable auto-merge/gi, '');
    assert.doesNotMatch(text, /gh pr merge|--auto\b|enable[- ]auto[- ]merge/i, p);
  }
  // Every publish agent is told it never merges.
  for (const { label, prompt } of await allPublishPrompts()) assert.match(prompt, /never push, merge/, label);
  assert.match(read('README.md'), /^- temper never merges\.$/m);
  assert.match(read('templates/preferences.md'), /It never merges\./);
});

// ---- v0.2: commits that reach their branch (spec §3.1) ----

test('PUBLISH-09 publish returns commits for docs and evidence', async () => {
  const respond = (over = {}) => ({ label }) => {
    if (Object.prototype.hasOwnProperty.call(over, label)) return over[label];
    if (label === 'docs') return { commit: 'sha-docs', files: ['README.md'], summary: 'docs' };
    if (label === 'evidence') return { script: 's.sh', checklist: 'c.md', commit: 'sha-ev' };
    if (label === 'gate') return { passed: true, exit_status: 0, log_path: 'full.log' };
    throw new Error(`unexpected label ${label}`);
  };
  const ready = await runWorkflow(WF, { args: args('/r'), respond: respond() });
  assert.equal(ready.result.status, 'ready');
  assert.deepEqual(ready.result.commits, { docs: 'sha-docs', evidence: 'sha-ev' });

  // Every result after validation carries it, the failing ones too; an empty sha never goes in.
  const failed = await runWorkflow(WF, {
    args: args('/r'),
    respond: respond({ evidence: { script: 's.sh', checklist: 'c.md', commit: '' }, gate: { passed: false, exit_status: 1, log_path: 'l' } }),
  });
  assert.equal(failed.result.status, 'gate_failed');
  assert.deepEqual(failed.result.commits, { docs: 'sha-docs' });
  const blocked = await runWorkflow(WF, { args: args('/r'), respond: respond({ evidence: null }) });
  assert.equal(blocked.result.status, 'blocked');
  assert.deepEqual(blocked.result.commits, { docs: 'sha-docs' });
  const resumed = await runWorkflow(WF, { args: args('/r', { done: ['docs'] }), respond: respond() });
  assert.deepEqual(resumed.result.commits, { evidence: 'sha-ev' });
  const invalid = await runWorkflow(WF, { args: args('/r', { spec: '' }), respond: respond() });
  assert.equal(invalid.result.status, 'invalid');
  assert.ok(!('commits' in invalid.result));
});
