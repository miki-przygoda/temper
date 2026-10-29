// The run skill's v0.3 text (docs/temper/v0-3/spec.md, "The build's `attempt`" and "Phase results",
// the head's side). The head follows skills/run/SKILL.md, so these tests read it as a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUN = readFileSync(fileURLToPath(new URL('../skills/run/SKILL.md', import.meta.url)), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const section = (start, end) => {
  const i = RUN.indexOf(start);
  assert.ok(i >= 0, `section ${start}`);
  const j = end ? RUN.indexOf(end, i + start.length) : -1;
  return flat(RUN.slice(i, j >= 0 ? j : undefined));
};
const STAGE3 = () => section('## Stage 3', '## Blocked items');
const NOT_TASKS = () => section("### Ids that aren't tasks", '## Stage 4');
const STAGE4 = () => section('## Stage 4', '## Stage 5');

test('SKILLS-PACKAGING-34 the run skill bumps attempt on every build resume and saves it', () => {
  const s3 = STAGE3();
  assert.match(s3, /`attempt`: `0` on the first launch[^.]*one more than the last launch's on every resume/);
  assert.match(s3, /Save `attempt` in `args\.json`/);
});

test('SKILLS-PACKAGING-35 a phase that returns blocked with a reason is a blocked item, its reason data', () => {
  const s = NOT_TASKS();
  for (const id of ['`checkpoint`', '`behaviour-spec`', '`acceptance:<key>`', '`green:<n>`', '`docs`', '`evidence`']) {
    assert.ok(s.includes(id), `names ${id}`);
  }
  assert.match(s, /reason[^.]*data[^.]*never[^.]*(shell|command)/);
  assert.match(s, /[Rr]ecord it in `log\.md`, user present or overnight/);
});

test('the run skill resumes a checkpoint block with attempt bumped, so the checkpoint reruns live', () => {
  const bullet = NOT_TASKS().split(' - ').find((b) => b.startsWith('`checkpoint`:'));
  assert.ok(bullet, 'checkpoint bullet');
  assert.match(bullet, /attempt/);
  assert.match(bullet, /runs (again|live)/);
  assert.match(bullet, /without a `Temper-Task` trailer/);
});

test('the part-fix attempt line keeps its words', () => {
  assert.match(STAGE4(), /`attempt`: `0` on the first launch of `part: "fix"`, and one more than the last launch's on every resume of it/);
});
