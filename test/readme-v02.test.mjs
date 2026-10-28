// The v0.2 docs (docs/temper/v0-2/spec.md, sections 3.4's rubric, 3.7a, 3.8 and 3.10): the README's
// known issues and version, the design spec's amendments A14 to A21, and the v0.2 behaviour lines.
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

test("the README's known issues list only what v0.2 left open", () => {
  const known = flat(section(README, '## Known issues', '\n## '));
  for (const gone of ['detached HEAD', 'build rule', 'never fixed by the fix part']) {
    assert.ok(!known.includes(gone), `known issues still name "${gone}"`);
  }
  assert.match(known, /head's (Claude Code )?session/);
  assert.match(known, /CONTROL-FLOW-6/);
  assert.match(known, /`args` and `resumeFromRunId`/);
  assert.match(known, /never by editing a generated script/);
});

test('the README says what ends an overnight run, and the stages name sweeps', () => {
  const night = flat(section(README, '## Overnight runs', '\n## '));
  assert.match(night, /every agent belongs to the head's session/i);
  assert.match(night, /closing (that|the head's) session ends the run/i);
  assert.match(night, /build host/);
  assert.match(flat(section(README, '## The stages', '\n## ')), /`sweeps: 1`/);
});

test('plugin.json and the README say 0.2.0', () => {
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).version, '0.2.0');
  assert.match(README, /^Status: v0\.2\.0\b/m);
});

test('the design spec has amendments A14 to A21, each citing a v0.2 spec section', () => {
  const ids = ['A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21'];
  const sections = new Set();
  for (const id of ids) {
    const m = DESIGN.match(new RegExp(`^- \\*\\*${id}\\b[^\\n]*`, 'm'));
    assert.ok(m, `amendment ${id}`);
    const cite = m[0].match(/\(v0\.2 spec §(3\.\d+a?)\)\s*$/);
    assert.ok(cite, `${id} ends citing a v0.2 spec section`);
    sections.add(cite[1]);
  }
  assert.deepEqual([...sections].sort(), ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7a', '3.9']);
  assert.match(flat(DESIGN), /\| Minor \| Everything else that is real\. It goes to the open items unless the user selects it\. \|/);
  assert.match(flat(section(DESIGN, '## 7. Stage 4', '### 7.1')), /`sweeps: 1`/);
});

test('docs/v1-behaviour.md has the v0.2 ids', () => {
  const ids = [];
  for (let n = 28; n <= 34; n++) ids.push(`BUILD-${n}`);
  for (let n = 22; n <= 30; n++) ids.push(`STABILISE-${n}`);
  ids.push('PUBLISH-09', 'STATE-22');
  for (let n = 29; n <= 31; n++) ids.push(`SKILLS-PACKAGING-${n}`);
  for (const id of ids) {
    const line = BEHAVIOUR.match(new RegExp(`^- \\*\\*${id}\\*\\* Given [^\\n]*, when [^\\n]*, then [^\\n]*$`, 'm'));
    assert.ok(line, `behaviour line ${id}`);
    assert.match(line[0], /v0\.2 spec §3\./, `${id} cites the v0.2 spec`);
  }
  const s09 = BEHAVIOUR.match(/^- \*\*STABILISE-09\*\*[^\n]*$/m);
  assert.ok(s09, 'STABILISE-09');
  assert.match(s09[0], /\(changed in v0\.2, spec §3\.4\)/);
  assert.equal(BEHAVIOUR.match(/^- \*\*STABILISE-09\*\*/gm).length, 1, 'STABILISE-09 edited in place');
});

test('the v1 log says the reverted fixes are redone in v0.2', () => {
  const log = flat(section(read('docs/v1-log.md'), '### Reopened by the reverts', '\n### '));
  assert.match(log, /SECOND-CONTROL-FLOW-5, SECOND-TESTS-DOCS-2 and SECOND-CONTROL-FLOW-7 are redone in v0\.2 \(docs\/temper\/v0-2\/spec\.md §3\.9\)\./);
});
