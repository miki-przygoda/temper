// The v0.3 docs (docs/temper/v0-3/spec.md, "Contracts between parts", "Non-goals"): the README's
// known issues, Python minimum and version, the design spec's amendments A22 to A29, the v0.3
// behaviour lines and the v1 log's reopened items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const section = (text, start, end) => {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `section ${start}`);
  const j = text.indexOf(end, i + start.length);
  return text.slice(i, j >= 0 ? j : undefined);
};

const README = read('README.md');
const DESIGN = read('docs/specs/2026-10-24-temper-design.md');
const BEHAVIOUR = read('docs/v1-behaviour.md');
const SPEC = read('docs/temper/v0-3/spec.md');

test("the README's known issues list only what v0.3 left open", () => {
  const known = flat(section(README, '## Known issues', '\n## '));
  for (const gone of ['CONTROL-FLOW-6', 'never pruned', 'no `blocked` status', 'against that fix\'s parent', 'doesn\'t make a task own']) {
    assert.ok(!known.includes(gone), `known issues still name "${gone}"`);
  }
  assert.match(known, /A run stops when the head's Claude Code session closes/);
  assert.match(known, /`args` and `resumeFromRunId`, never by editing a generated script/);
  assert.match(known, /TESTS-DOCS-5[^.]*deferred/);
  assert.match(known, /no safe way for the head to refresh the permission mode without a new prompt/);
});

test('the README requires Python 3.10', () => {
  assert.match(flat(section(README, '## Requirements', '\n## ')), /Python 3\.10 or later/);
  assert.match(flat(section(README, '## Development', '\n## ')), /Python 3\.10 or later/);
  for (const line of README.split('\n')) assert.ok(!/Python 3\.9\b/.test(line), `a line says Python 3.9: ${line}`);
  const ci = README.split('\n').find((l) => l.startsWith('CI ('));
  assert.ok(ci, 'the CI line');
  assert.match(ci, /Node 20 with Python 3\.10/);
});

test('plugin.json and the README say 0.3.0', () => {
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).version, '0.3.0');
  assert.match(README, /^Status: v0\.3\.0\b/m);
});

test('the design spec has amendments A22 to A29, each citing the v0.3 spec', () => {
  // The contract names, from the spec's "Contracts between parts" list.
  const contracts = section(SPEC, '## Contracts between parts', '\n## ');
  const names = [...contracts.matchAll(/^- \*\*([^*]+?)\.?\*\*/gm)].map((m) => m[1].toLowerCase().replace(/^the /, ''));
  assert.ok(names.length >= 8, `contract names: ${names.join(', ')}`);
  const cited = new Set();
  assert.ok(DESIGN.includes('### Amendments from v0.3 (28 Oct 2026, `docs/temper/v0-3/spec.md`)'), 'the v0.3 amendments section');
  for (let n = 22; n <= 29; n++) {
    const m = DESIGN.match(new RegExp(`^- \\*\\*A${n}\\b[^\\n]*`, 'm'));
    assert.ok(m, `amendment A${n}`);
    const cite = m[0].match(/\(v0\.3 spec, ([^)]+)\)\s*$/);
    assert.ok(cite, `A${n} ends citing the v0.3 spec`);
    for (const part of cite[1].split(' and ')) {
      const name = part.trim().toLowerCase().replace(/^the /, '');
      assert.ok(names.includes(name), `A${n} cites "${part}", not a contract name (${names.join(', ')})`);
      cited.add(name);
    }
  }
  assert.deepEqual([...cited].sort(), [...names].sort(), 'every contract is cited by an amendment');
});

test('docs/v1-behaviour.md has the v0.3 ids', () => {
  const ids = [];
  for (let n = 37; n <= 43; n++) ids.push(`BUILD-${n}`);
  ids.push('PUBLISH-10', 'PUBLISH-11', 'STABILISE-32', 'STABILISE-33');
  for (let n = 15; n <= 18; n++) ids.push(`GIT-SAFETY-${n}`);
  for (let n = 32; n <= 35; n++) ids.push(`SKILLS-PACKAGING-${n}`);
  for (const id of ids) {
    const all = BEHAVIOUR.match(new RegExp(`^- \\*\\*${id}\\*\\*`, 'gm')) || [];
    assert.equal(all.length, 1, `one line for ${id}`);
    const line = BEHAVIOUR.match(new RegExp(`^- \\*\\*${id}\\*\\* Given [^\\n]*, when [^\\n]*, then [^\\n]*$`, 'm'));
    assert.ok(line, `behaviour line ${id}`);
    assert.match(line[0], /v0\.3 spec/, `${id} cites the v0.3 spec`);
  }
  // Each id sits in its own group.
  const groups = { BUILD: '## build', PUBLISH: '## publish', STABILISE: '## stabilise', 'GIT-SAFETY': '## git-safety', 'SKILLS-PACKAGING': '## skills-packaging' };
  for (const id of ids) {
    const group = id.replace(/-\d+$/, '');
    assert.ok(section(BEHAVIOUR, `\n${groups[group]}\n`, '\n## ').includes(`- **${id}**`), `${id} is in ${groups[group]}`);
  }
});

test('the v1 log records CONTROL-FLOW-6 redone and TESTS-DOCS-5 deferred in v0.3', () => {
  const log = flat(section(read('docs/v1-log.md'), '### Reopened by the reverts', '\n### '));
  assert.ok(log.includes('SECOND-CONTROL-FLOW-6 is redone in v0.3 (docs/temper/v0-3/spec.md, the build\'s attempt and the checkpoint prompt).'), log);
  assert.ok(log.includes('SECOND-TESTS-DOCS-5 stays open, deferred in v0.3: there is still no safe way for the head to refresh the permission mode without a new prompt.'), log);
  const stale = flat(section(read('docs/v1-log.md'), '- **SECOND-CONTROL-FLOW-1-stale-private-ref**', '\n### '));
  assert.ok(stale.includes('closed in v0.3 by `--prune` on the private fetch'), stale);
});
