// The plan skill's v0.3 text (docs/temper/v0-3/spec.md, contract "Plan test ownership").
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
const ADDITIONS = read('templates/plan-additions.md');

test('SKILLS-PACKAGING-32 the plan skill makes each task own the existing tests its change breaks', () => {
  const s1 = section(PLAN, '## 1.', '## 2.');
  assert.match(s1, /git grep/);
  assert.match(s1, /every existing test file that asserts/);
  assert.match(s1, /`Owns:`/);
  assert.match(s1, /function, constant, schema, label, prompt (line|sentence) (and|or) file/);
});

test('the plan skill puts two tasks that need the same test file in different waves', () => {
  assert.match(flat(PLAN), /same test file[^.]*different waves/);
});

test('the plan skill says no code checks test ownership', () => {
  assert.match(flat(PLAN), /no code checks (it|test ownership)|isn't knowable from `args\.json`/);
});

test("plan-additions.md's Owns bullet includes the existing tests the change breaks", () => {
  const line = ADDITIONS.split('\n').find((l) => l.startsWith('- **Owns:**'));
  assert.ok(line, 'Owns bullet');
  assert.match(line, /existing test/);
});

test("skills/plan's description is still triggering conditions only", () => {
  const m = PLAN.match(/^---\n[\s\S]*?^description: (.*)$/m);
  assert.ok(m, 'description');
  assert.match(m[1], /^Use when/);
});
