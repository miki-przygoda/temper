// The v0.3 CI matrix (docs/temper/v0-3/plan.md, task ci-py310): the oldest job runs Node 20 with
// Python 3.10 on ubuntu-latest. The workflow is read as text, so no YAML package is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ci = readFileSync(fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)), 'utf8');

// The matrix include items, each as a map of its keys to their raw (quoted) values.
function includeItems(text) {
  const items = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const start = line.match(/^\s*-\s+(\w+):\s*(.+?)\s*$/);
    const cont = line.match(/^\s+(\w+):\s*(.+?)\s*$/);
    if (start) {
      cur = { [start[1]]: start[2] };
      items.push(cur);
    } else if (cur && cont && !line.trimStart().startsWith('-')) {
      cur[cont[1]] = cont[2];
    } else if (!/^\s*(#.*)?$/.test(line)) {
      cur = null;
    }
  }
  return items;
}

test("ci's oldest job is node 20 with python 3.10 on ubuntu-latest", () => {
  // The quotes matter: YAML reads a bare 3.10 as 3.1.
  const found = includeItems(ci).some(
    (it) => it.os === 'ubuntu-latest' && it.node === "'20'" && it.python === "'3.10'",
  );
  assert.ok(found, 'an include item with os: ubuntu-latest, node: \'20\', python: \'3.10\'');
});

test('ci pins no ubuntu-24.04 and no python 3.9', () => {
  assert.ok(!ci.includes('ubuntu-24.04'), 'no ubuntu-24.04');
  assert.ok(!ci.includes("'3.9'"), "no '3.9'");
});

test('ci still runs node 24 with python 3.13, the bundle check and npm test', () => {
  for (const s of ["node: '24'", "python: '3.13'", 'node scripts/bundle.mjs --check', 'run: npm test']) {
    assert.ok(ci.includes(s), s);
  }
});
