// Test harness for workflow scripts: runs a bundled workflow with fake agent, pipeline and parallel.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const toRoot = (p) => resolve(root, p);

export async function runWorkflow(filePath, { args, respond } = {}) {
  const source = readFileSync(toRoot(filePath), 'utf8').replace(/export\s+const\s+meta\b/, 'const meta');
  const calls = [];
  const logs = [];
  const phases = [];
  // The labels of the agents each parallel() call ran, one array per call, in call order.
  const batches = [];

  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts });
    const reply = await respond({ prompt, opts, label: opts?.label });
    return reply === undefined ? null : reply;
  };

  const parallel = async (thunks) => {
    const start = calls.length;
    const out = [];
    for (const thunk of thunks) {
      try {
        out.push(await thunk());
      } catch {
        out.push(null);
      }
    }
    batches.push(calls.slice(start).map((c) => c.opts?.label));
    return out;
  };

  const pipeline = async (items, ...stages) => {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let value = item;
      try {
        for (const stage of stages) value = await stage(value, item, i);
      } catch {
        value = null;
      }
      out.push(value);
    }
    return out;
  };

  const phase = (title) => { phases.push(title); };
  const log = (msg) => { logs.push(msg); };
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };

  const globals = { agent, pipeline, parallel, phase, log, args, budget };
  const names = Object.keys(globals);
  const run = new AsyncFunction(...names, source);
  const result = await run(...names.map((n) => globals[n]));
  return { result, calls, logs, phases, batches };
}

export function loadLib(libPath = 'src/lib.js') {
  const text = readFileSync(toRoot(libPath), 'utf8');
  const names = [];
  for (const m of text.matchAll(/^(?:async\s+)?function\s+(\w+)|^const\s+(\w+)/gm)) {
    names.push(m[1] ?? m[2]);
  }
  return new Function(`${text}\nreturn { ${names.join(', ')} };`)();
}
