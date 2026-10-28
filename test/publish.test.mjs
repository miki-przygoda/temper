import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from './harness.mjs';

const WF = 'workflows/publish.js';

function args(extra = {}) {
  return {
    epic: 'e',
    repo: '/r',
    branch: 'temper/e',
    base: 'main',
    log: 'docs/temper/e/log.md',
    spec: 'docs/temper/e/spec.md',
    host: { kind: 'local' },
    gates: { quick: 'npm test', full: 'npm test && npm run e2e' },
    done: [],
    ...extra,
  };
}

const REPLIES = {
  docs: { commit: 'd1d1d1d1', files: ['README.md', 'docs/temper/e/pr-body.md'], summary: 'Add the auth flow\nmore detail' },
  evidence: { script: 'docs/temper/e/owner-steps.sh', checklist: 'docs/temper/e/owner-checklist.md', commit: 'e1e1e1e1' },
  gate: { passed: true, exit_status: 0, log_path: '/tmp/gate.log' },
};

function responder(overrides = {}) {
  return ({ label }) => (label in overrides ? overrides[label] : REPLIES[label]);
}

const labels = (calls) => calls.map((c) => c.opts?.label);

test('everything passes: ready, with the PR title and body file', async () => {
  const { result, calls } = await runWorkflow(WF, { args: args(), respond: responder() });
  assert.equal(result.status, 'ready');
  assert.equal(result.pr.body_file, 'docs/temper/e/pr-body.md');
  assert.equal(result.pr.title, 'e: Add the auth flow');
  assert.deepEqual(result.docs, REPLIES.docs);
  assert.deepEqual(result.evidence, REPLIES.evidence);
  assert.deepEqual(result.gate, REPLIES.gate);
  assert.deepEqual(labels(calls), ['docs', 'evidence', 'gate']);
});

test('the PR title comes with a shell-quoted form that sh never expands (SECOND-SAFETY-1)', async () => {
  const summary = "Count `touch PWNED` ignored files, $(touch PWNED2) and it's $HOME";
  const docs = { ...REPLIES.docs, summary };
  const { result } = await runWorkflow(WF, { args: args(), respond: responder({ docs }) });
  assert.equal(result.status, 'ready');
  assert.equal(result.pr.title, `e: ${summary}`);
  const dir = mkdtempSync(join(tmpdir(), 'temper-title-'));
  const out = execFileSync('sh', ['-c', `printf '%s' ${result.pr.title_shell}`], { cwd: dir, encoding: 'utf8' });
  assert.equal(out, result.pr.title);
  assert.equal(existsSync(join(dir, 'PWNED')), false);
  assert.equal(existsSync(join(dir, 'PWNED2')), false);
});

test('the run skill passes the shell-quoted title, never the raw title in double quotes', () => {
  const skill = readFileSync(fileURLToPath(new URL('../skills/run/SKILL.md', import.meta.url)), 'utf8');
  assert.ok(!skill.includes('--title "<pr.title>"'), 'the skill puts <pr.title> inside double quotes');
  assert.ok(skill.includes('--title <pr.title_shell>'), 'the skill lacks --title <pr.title_shell>');
});

test('the agents get their schemas', async () => {
  const { calls } = await runWorkflow(WF, { args: args(), respond: responder() });
  for (const c of calls) {
    assert.equal(c.opts.schema.type, 'object', `schema for ${c.opts.label}`);
  }
  assert.ok(calls[0].opts.schema.required.includes('summary'));
  assert.ok(calls[2].opts.schema.required.includes('exit_status'));
});

test('a failing gate gives gate_failed', async () => {
  const { result } = await runWorkflow(WF, { args: args(), respond: responder({ gate: { passed: false } }) });
  assert.equal(result.status, 'gate_failed');
  assert.deepEqual(result.gate, { passed: false });
});

test('a gate agent that returns nothing is a failed gate, not ready', async () => {
  const { result } = await runWorkflow(WF, { args: args(), respond: responder({ gate: null }) });
  assert.equal(result.status, 'gate_failed');
});

test('done docs and evidence: only the gate runs', async () => {
  const { result, calls } = await runWorkflow(WF, { args: args({ done: ['docs', 'evidence'] }), respond: responder() });
  assert.deepEqual(labels(calls), ['gate']);
  assert.equal(result.status, 'ready');
  assert.equal(result.pr.body_file, 'docs/temper/e/pr-body.md');
});

test('a docs or evidence agent that returns nothing blocks the run before the gate', async () => {
  for (const id of ['docs', 'evidence']) {
    const { result, calls } = await runWorkflow(WF, { args: args(), respond: responder({ [id]: null }) });
    assert.equal(result.status, 'blocked', id);
    assert.deepEqual(result.blocked, [{ id, reason: 'agent returned nothing' }]);
    assert.ok(!labels(calls).includes('gate'), id);
  }
});

test('invalid args: no agent calls', async () => {
  const bad = args();
  delete bad.spec;
  const { result, calls } = await runWorkflow(WF, { args: bad, respond: responder() });
  assert.equal(result.status, 'invalid');
  assert.ok(result.errors.length > 0);
  assert.equal(calls.length, 0);
});

test('no recorded prompt tells the agent to push', async () => {
  const { calls } = await runWorkflow(WF, { args: args(), respond: responder() });
  assert.equal(calls.length, 3);
  for (const c of calls) {
    for (const line of c.prompt.split('\n')) {
      if (/\bgit push\b/.test(line)) assert.match(line, /\bnever\b/i, `${c.opts.label}: ${line}`);
    }
    assert.match(c.prompt, /never push/, `${c.opts.label} carries the fixed rules`);
  }
});

test('a non-default specs_dir: the PR body file is in the epic folder (TESTS-DOCS-7)', async () => {
  const moved = args({ log: 'design/temper/e/log.md', spec: 'design/temper/e/spec.md' });
  const { result, calls } = await runWorkflow(WF, { args: moved, respond: responder() });
  assert.equal(result.status, 'ready');
  assert.equal(result.pr.body_file, 'design/temper/e/pr-body.md');
  for (const c of calls) assert.ok(!c.prompt.includes('docs/temper'), c.opts?.label);
});
