import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bundleText } from '../scripts/bundle.mjs';
import { runWorkflow, loadLib } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');
const LIB = 'function libHelper(x) { return x; }\n';

// Bundles the echo meta with a body into a temporary workflow file, runs it, and cleans up.
async function runBody(body, opts) {
  const dir = mkdtempSync(join(tmpdir(), 'temper-harness-'));
  try {
    const file = join(dir, 'wf.js');
    writeFileSync(file, bundleText(fixture('echo.meta.js'), LIB, body));
    return await runWorkflow(file, opts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const echo = () => runBody(fixture('echo.js'), { args: { x: 1 }, respond: () => 'r1' });

test('runWorkflow returns the body result with the agent reply and args', async () => {
  const { result } = await echo();
  assert.deepEqual(result, { a: 'r1', args: { x: 1 } });
});

test('agent calls are recorded with prompt and opts', async () => {
  const { calls } = await echo();
  assert.deepEqual(calls[0], { prompt: 'p1', opts: { label: 'l1' } });
});

test('log lines are collected', async () => {
  const { logs } = await echo();
  assert.deepEqual(logs, ['hi']);
});

test('respond gets the prompt, opts and label; undefined counts as null', async () => {
  const seen = [];
  const { result } = await runBody(fixture('echo.js'), {
    args: {},
    respond: (r) => { seen.push(r); },
  });
  assert.deepEqual(seen, [{ prompt: 'p1', opts: { label: 'l1' }, label: 'l1' }]);
  assert.equal(result.a, null);
});

test('phase titles are collected and budget is unlimited', async () => {
  const { result, phases } = await runBody(
    "phase('One'); phase('Two'); return [budget.total, budget.spent(), budget.remaining()]",
    { args: {}, respond: () => null },
  );
  assert.deepEqual(phases, ['One', 'Two']);
  assert.deepEqual(result, [null, 0, Infinity]);
});

test('parallel turns a throwing thunk into null', async () => {
  const { result } = await runBody(
    'return await parallel([()=>{throw 1}, async()=>2])',
    { args: {}, respond: () => null },
  );
  assert.deepEqual(result, [null, 2]);
});

test('pipeline: a throwing stage makes that item null and skips its later stages', async () => {
  const body = `
    const later = [];
    const out = await pipeline(
      ['a', 'b'],
      (item, orig, i) => { if (i === 0) throw new Error('boom'); return item + '1'; },
      (prev, orig, i) => { later.push(orig); return prev + '2:' + orig + ':' + i; },
    );
    return { out, later };
  `;
  const { result } = await runBody(body, { args: {}, respond: () => null });
  assert.deepEqual(result, { out: [null, 'b12:b:1'], later: ['b'] });
});

test('pipeline runs item by item, stage by stage', async () => {
  const body = `
    return await pipeline(
      ['x', 'y'],
      (item) => agent('s1:' + item, { label: 's1:' + item }),
      (prev, item) => agent('s2:' + item, { label: 's2:' + item }),
    );
  `;
  const { result, calls } = await runBody(body, { args: {}, respond: ({ label }) => label });
  assert.deepEqual(result, ['s2:x', 's2:y']);
  assert.deepEqual(calls.map((c) => c.opts.label), ['s1:x', 's2:x', 's1:y', 's2:y']);
});

test('loadLib returns the top-level functions and consts of a lib file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'temper-lib-'));
  try {
    const file = join(dir, 'lib.js');
    writeFileSync(file, [
      'const ANSWER = 42;',
      'function double(x) { return x * 2; }',
      'async function later() { const inner = 1; return inner; }',
      '',
    ].join('\n'));
    const lib = loadLib(file);
    assert.deepEqual(Object.keys(lib).sort(), ['ANSWER', 'double', 'later']);
    assert.equal(lib.ANSWER, 42);
    assert.equal(lib.double(3), 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
