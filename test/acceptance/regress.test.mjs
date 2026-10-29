// Acceptance tests for the regress group (docs/temper/v0-3/behaviour.md, REGRESS-01..03).
// They drive the bundled workflows/stabilise.js through the harness with scripted agents, the way the
// head launches a part-fix run with args.json, and read each `regress:fix:<id>` prompt from the agent
// calls the workflow makes, never from src/lib.js. A test that fails because of the product is
// skipped with "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from '../harness.mjs';

const WF = 'workflows/stabilise.js';
const BRANCH = 'temper/e';

// A hex sha for a fix id, as a fix agent reports one.
const shaFor = (id) => Buffer.from(id).toString('hex').padEnd(8, '0').slice(0, 40);

function fixArgs(extra = {}) {
  return {
    epic: 'e',
    repo: '/r',
    branch: BRANCH,
    base: 'main',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'QUICK-GATE-CMD', full: 'FULL-GATE-CMD' },
    part: 'fix',
    lenses: [],
    severity_notes: '',
    done: [],
    sweeps: 1,
    selected: [{
      id: 'f1', lens: 'security', file: 'src/a.rs', line: 10, summary: 'summary of f1',
      input: 'INPUT-f1', wrong_result: 'WRONG-f1', severity: 'critical', kind: 'fix',
    }],
    ...extra,
  };
}

// Every fix lands; every regression check is clean.
function respond({ label }) {
  if (label.startsWith('fix:')) return { status: 'fixed', commit: shaFor(label.slice(4)), note: 'done' };
  if (label.startsWith('regress:fix:')) return { status: 'done', regressions: [] };
  if (label.startsWith('review:') || label.startsWith('second:review:')) return { status: 'done', findings: [] };
  throw new Error(`unexpected label ${label}`);
}

async function regressPromptFor(extra = {}) {
  const { calls } = await runWorkflow(WF, { args: fixArgs(extra), respond });
  const c = calls.find((x) => x.opts?.label === 'regress:fix:f1');
  assert.ok(c, `no regress:fix:f1 call among ${calls.map((x) => x.opts?.label).join(', ')}`);
  return c.prompt;
}

test('REGRESS-01 the regress:fix:<id> prompt names the branch\'s current tip', async () => {
  const p = await regressPromptFor();
  assert.ok(p.includes(`current tip of \`${BRANCH}\``), p);
  assert.ok(p.includes(`git rev-parse ${BRANCH}`), 'the prompt says how to read the tip');
});

test('REGRESS-02 the regress:fix:<id> prompt states the reproduce-on-tip rule', async () => {
  const p = await regressPromptFor();
  assert.ok(
    p.includes(`A regression counts only when it reproduces on the current tip of \`${BRANCH}\` as well; give both reproductions.`),
    p,
  );
});

test('REGRESS-03 the regress:fix:<id> prompt built with attempt n still ends with "Run attempt <n>."', async () => {
  for (const n of [0, 3]) {
    const p = await regressPromptFor({ attempt: n });
    assert.ok(p.endsWith(`Run attempt ${n}.`), `attempt ${n}: ...${p.slice(-80)}`);
  }
});
