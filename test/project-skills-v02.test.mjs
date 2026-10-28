// The plan and setup skills' v0.2 text (docs/temper/v0-2/spec.md, sections 3.2, 3.5 and 3.6).
// The head follows the skills as files, so these tests read them as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const section = (text, start, end) => {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `section ${start}`);
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return flat(text.slice(i, j >= 0 ? j : undefined));
};
const PLAN = read('skills/plan/SKILL.md');
const SETUP = read('skills/setup/SKILL.md');

test('the plan skill sizes waves to gate_slots in the plan and records the split in the Waves table', () => {
  const s1 = section(PLAN, '## 1.', '## 2.');
  assert.match(s1, /No wave holds more tasks than `gate_slots` from `project\.md` \(empty or missing means 1\)/);
  assert.match(s1, /split it here, most critical first; never leave a wider wave for the `run` skill to re-cut/);
  assert.match(s1, /the `## Waves` table's Why column/);
});

test('the setup skill asks for the build rule, flaky tests, sweeps and gate_slots and points to gate-slots.md', () => {
  const s6 = section(SETUP, '## 6. The project');
  assert.match(s6, /`## Build rule`/);
  assert.match(s6, /suggest one from the repo's build files and CI config/);
  assert.match(s6, /`flaky`/);
  assert.match(s6, /`sweeps`/);
  assert.match(s6, /`gate_slots`/);
  assert.match(s6, /Ask every item, even when the answer is the default/);
  assert.match(s6, /When a gate takes more than a few minutes, or its build tool holds one lock for the whole build \(cargo's, for one\), point the user to `\$\{CLAUDE_PLUGIN_ROOT\}\/templates\/gate-slots\.md`/);
});
