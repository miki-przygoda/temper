// The run skill's v0.2 text (docs/temper/v0-2/spec.md, sections 3.3, 3.4, 3.6, 3.7a and 3.9, the
// head's side). The head follows skills/run/SKILL.md, so these tests read it as a file.
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
const STAGE4 = () => section('## Stage 4', '## Stage 5');
const STAGE5 = () => section('## Stage 5', '## Status and the board');

test('the run skill bumps attempt on every part-fix resume and passes sweeps, build_rule and flaky', () => {
  const s4 = STAGE4();
  assert.match(s4, /`sweeps` \(the `sweeps:` line of `project\.md`/);
  assert.match(s4, /`build_rule` and `flaky` \(from `args\.json`/);
  assert.match(s4, /`flaky` is an array of strings/);
  assert.match(s4, /`attempt`[^.]*one more than the last launch's on every resume/);
  assert.match(STAGE5(), /`build_rule`, `flaky`/);
});

test('the run skill passes gate_slots to stabilise, sized by A13, for its regression agents', () => {
  assert.match(STAGE4(), /`gate_slots` \(the number of regression agents the stage may launch at once: the smaller of `gate_slots` from `project\.md`[^)]*and what the build host can take/);
});

test('the run skill records flaky_reruns in log.md and reports them', () => {
  const s3 = STAGE3();
  assert.match(s3, /When the result has `flaky_reruns`, whatever its status, append each entry to `log\.md`/);
  assert.match(s3, /tell the user \(overnight, in the morning report\)/);
  assert.match(STAGE4(), /`flaky_reruns`: record and report them as in stage 3/);
  assert.match(section('### The morning report'), /the flaky reruns/);
});

test("the run skill's stage 4 handles unverified findings and sweeps 1", () => {
  const s4 = STAGE4();
  assert.match(s4, /\{status: "list", findings, unverified, refuted, blocked\}/);
  assert.match(s4, /User present: offer each unverified finding as its own option, its label starting `unverified:`/);
  assert.match(s4, /Overnight: never select an unverified finding; it goes to the open items/);
  assert.match(s4, /A `verify:<id>` entry in `blocked` doesn't stop 4b/);
  assert.match(s4, /every minor finding the user didn't select/);
  assert.match(s4, /`status: "stable"`: go to stage 5[^\n]*record in `log\.md` that stage 4 is stable/);
  assert.match(s4, /`second_sweep: null`[^\n]*no second sweep is expected/);
});

test('answers reach a run by resuming, never by editing a launched script', () => {
  const launch = section('## Launching and resuming', '## Stage 3');
  assert.match(launch, /never by editing or regenerating a launched script/);
});

test("the run skill's part-fix return names the v0.2 blocked ids regress:fix:<id> and second:verify:<id> (spec 3.3, 3.9)", () => {
  const s4 = STAGE4();
  // v1's single resume-only check is gone: every part-fix run checks each fix with its own agent.
  assert.doesNotMatch(s4, /`regress:fix` with/);
  assert.doesNotMatch(s4, /over the fixes made on a resume never ran/);
  // A dead regression agent is not a fix question: no answer, resume once, then stop.
  assert.match(s4, /An id `regress:fix:<id>` with `agent returned nothing` is not a fix question and gets no answer/);
  assert.match(s4, /`regress:fix:<id>` with `agent returned nothing` is not a fix question[^]*?Write nothing to `args\.answers`; refresh `args\.done` and resume once[^]*?If the same id blocks again, stop and tell the user/);
  // A second-sweep verifier that returned nothing: no answer, hand over.
  assert.match(s4, /An id `second:verify:<id>` is not a fix and gets no answer: see `handover` below/);
  assert.match(s4, /`status: "handover"`:[^]*`second:verify:<id>`/);
});
