// Acceptance tests for the v0.2 head group (docs/temper/v0-2/behaviour.md, HEAD-01..21): the run,
// plan and setup skills, the project and gate-slots templates and the README carry the head's side
// (spec 3.1 to 3.6 and 3.8, head side). The head is a Claude Code session that reads these files as
// its instructions, so each test reads them as files, the way the head and the user read them.
// A test that fails because of the product is skipped with "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

const RUN = read('skills/run/SKILL.md');
const PLAN = read('skills/plan/SKILL.md');
const SETUP = read('skills/setup/SKILL.md');
const PROJECT = read('templates/project.md');
const SLOTS = read('templates/gate-slots.md');
const README = read('README.md');

const section = (text, start, end) => {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `section ${start}`);
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return text.slice(i, j >= 0 ? j : undefined);
};

// The front block of a template, as {key: {value, comment}} with the comment lines just above it.
function frontBlock(text) {
  const lines = text.split('\n');
  const fences = lines.map((l, i) => (l.trim() === '---' ? i : -1)).filter((i) => i >= 0);
  assert.ok(fences.length >= 2, 'a front block');
  const out = {};
  let comment = [];
  for (const raw of lines.slice(fences[0] + 1, fences[1])) {
    const line = raw.trim();
    if (line.startsWith('#')) { comment.push(line.slice(1).trim()); continue; }
    if (!line.includes(':')) continue;
    const k = line.slice(0, line.indexOf(':')).trim();
    out[k] = { value: line.slice(line.indexOf(':') + 1).trim(), comment: comment.join(' ') };
    comment = [];
  }
  return out;
}

const STAGE4 = flat(section(RUN, '## Stage 4', '## Stage 5'));
const STAGE5 = flat(section(RUN, '## Stage 5', '## Status and the board'));
const STAGE3 = flat(section(RUN, '## Stage 3', '## Blocked items'));
const SETUP_PROJECT = flat(section(SETUP, '## 6. The project'));

test('HEAD-01 the project template has sweeps, gate_slots, flaky and an optional build rule section', () => {
  const fb = frontBlock(PROJECT);
  assert.ok(fb.sweeps, 'sweeps key');
  assert.equal(fb.sweeps.value, '2', 'sweeps defaults to 2');
  assert.match(fb.sweeps.comment, /\b2\b/);
  assert.match(fb.sweeps.comment, /\b1\b/);
  assert.ok(fb.gate_slots, 'gate_slots key');
  assert.equal(fb.gate_slots.value, '', 'gate_slots is empty by default');
  assert.match(fb.gate_slots.comment, /empty means 1/);
  assert.ok(fb.flaky, 'flaky key');
  assert.equal(fb.flaky.value, '');
  assert.match(fb.flaky.comment, /comma-separated/);
  assert.match(fb.flaky.comment, /test runner prints/);
  const rule = section(PROJECT, '\n## Build rule');
  assert.match(rule, /free text/);
  assert.match(flat(rule), /Leave it empty when there is no rule/);
});

test('HEAD-02 setup asks for the build rule, suggests one from the build files and allows it empty', () => {
  const item = SETUP_PROJECT.slice(SETUP_PROJECT.indexOf('the `## Build rule` section'));
  assert.ok(SETUP_PROJECT.includes('the `## Build rule` section'), 'setup asks for the build rule');
  assert.match(SETUP_PROJECT, /Ask the user for each item below/);
  assert.match(item.slice(0, 400), /suggest one from the repo's build files/);
  assert.match(item.slice(0, 400), /it may be empty/);
});

test('HEAD-03 plan copies the build rule and flaky into args.json as build_rule and flaky', () => {
  const p = flat(PLAN);
  assert.match(p, /`build_rule`: the text of `project\.md`'s `## Build rule` section/);
  assert.match(p, /or `""` when it is empty or missing/);
  assert.match(p, /`flaky`: the `flaky:` line of `project\.md`, split on commas/);
  assert.match(p, /or `\[\]` when the line is empty or missing/);
  assert.match(p, /`build_rule` is a string and `flaky` an array of strings/);
});

test('HEAD-04 plan tells the plan not to copy the build rule into task texts', () => {
  assert.match(flat(PLAN), /Never copy the build rule (or the flaky list )?into a task's text: every agent's prompt already carries/);
});

test('HEAD-05 plan sizes waves to gate_slots', () => {
  const p = flat(PLAN);
  assert.match(p, /waves from the dependency graph, sized to `gate_slots`/);
  assert.match(p, /No wave holds more tasks than `gate_slots` from `project\.md` \(empty or missing means 1\)/);
});

test('HEAD-06 run passes build_rule and flaky to stabilise and publish, and sweeps to stabilise', () => {
  assert.match(STAGE4, /`sweeps` \(the `sweeps:` line of `project\.md`, `1` or `2`/);
  assert.match(STAGE4, /`build_rule` and `flaky` \(from `args\.json`/);
  assert.match(STAGE5, /^## Stage 5, `temper:publish` Args: .*?`gates`, `build_rule`, `flaky` \(both as in stage 4\) and `done`/);
});

test('HEAD-07 run uses gate_slots as the upper bound in the A13 step', () => {
  const a13 = flat(section(RUN, '**What the build host can take (amendment A13).**', '6. **Status.**'));
  assert.match(a13, /The number of tasks per launch is the smaller of `gate_slots` from `project\.md` \(empty or missing means 1\) and what the host can take/);
});

test('HEAD-08 run bumps args.attempt on every resume of part fix', () => {
  assert.match(STAGE4, /`attempt`: `0` on the first launch of `part: "fix"`, and one more than the last launch's on every resume of it/);
  assert.match(STAGE4, /Save `attempt` in `args\.json` at each launch/);
});

test('HEAD-09 run checks each done_now id has its trailer reachable from the epic branch', () => {
  const r = flat(RUN);
  // After every temper:build return (and the fetch-back on ssh), each done_now id's trailer is checked.
  assert.match(r, /`done_now`[^.]*(trailer|Temper-Task)[^.]*(reachable|on the epic branch|merge-base|--is-ancestor)/i);
  assert.match(r, /(every|each) (return|result) of `temper:build`|after (every|each) `temper:build` (return|result)/i);
});

test('HEAD-10 run checks every commits sha with git merge-base --is-ancestor', () => {
  assert.match(STAGE3, /When the result has `commits`, whatever its status, check each sha/);
  assert.match(STAGE3, /`git -C <repo> merge-base --is-ancestor <sha> <branch>`/);
  assert.match(STAGE4, /`commits`: check them as in stage 3/);
  assert.match(STAGE5, /When the result has `commits`, check them as in stage 3/);
  // spec 8 (security-01): the values are hex shas; anything else was left out and blocked.
  assert.match(STAGE3, /Each value is a hex sha \(`\/\^\[0-9a-f\]\{7,64\}\$\/`\)/);
  assert.match(STAGE3, /`commit is not a sha`/);
});

test('HEAD-11 a sha not on the branch is reported, never cherry-picked, and reruns on resume', () => {
  assert.match(STAGE3, /A sha that isn't on the branch[^.]*: tell the user its id and sha/);
  assert.match(STAGE3, /never cherry-pick it/);
  assert.match(STAGE3, /Its trailer isn't in `done`, so its phase or task runs again: refresh `args\.done` and resume/);
});

test('HEAD-12 run records flaky_reruns in log.md for the morning report', () => {
  assert.match(STAGE3, /When the result has `flaky_reruns`, whatever its status, append each entry to `log\.md`/);
  assert.match(STAGE3, /overnight, in the morning report/);
  assert.match(STAGE4, /`flaky_reruns`: record and report them as in stage 3/);
  assert.match(flat(section(RUN, '### The morning report')), /the flaky reruns/);
});

test('HEAD-13 unverified findings are shown marked unverified; present users may select, overnight never', () => {
  assert.match(STAGE4, /`unverified` holds findings whose verifier returned nothing/);
  assert.match(STAGE4, /User present: offer each unverified finding as its own option, its label starting `unverified:`/);
  assert.match(STAGE4, /Overnight: never select an unverified finding/);
});

test('HEAD-14 second_sweep: null means one-sweep mode, and run says what the head does', () => {
  assert.match(STAGE4, /With `second_sweep: null`, record that it ran one sweep, as `sweeps: 1` asks, so no second sweep is expected/);
});

test('HEAD-15 run names each new result field and what the head does with it', () => {
  const r = flat(RUN);
  assert.match(r, /When the result has `commits`, whatever its status, check each sha/);
  assert.match(r, /When the result has `flaky_reruns`, whatever its status, append each entry to `log\.md`/);
  assert.match(r, /`unverified` findings\. User present: offer each unverified finding/);
  assert.match(r, /With `second_sweep: null`, record that it ran one sweep/);
});

test("HEAD-16 run's minors line reads 'every minor finding the user didn't select'", () => {
  assert.match(STAGE4, /every minor finding the user didn't select[^.]*go to the open items/);
  assert.doesNotMatch(STAGE4, /which means every minor finding,/);
});

test('HEAD-17 setup keeps minor invalid in overnight_fix_default', () => {
  const s = flat(SETUP);
  assert.match(s, /`minor` is not a valid part of it/);
  const row = SETUP.split('\n').find((l) => l.includes('`overnight_fix_default`') && l.startsWith('|'));
  assert.ok(row, 'overnight_fix_default row');
  assert.doesNotMatch(row, /minor/);
});

test('HEAD-18 gate-slots template covers slots, stamp, fast scratch, sizing and shared caches in generic terms', () => {
  const g = flat(SLOTS);
  assert.match(g, /N slot dirs/);
  assert.match(g, /`flock -n` on its lock file/);
  assert.match(g, /own build output dir/);
  assert.match(g, /own test scratch dir/);
  assert.match(g, /stamp file naming the last worktree/);
  assert.match(g, /touches that worktree's tracked sources/);
  assert.match(g, /fast local storage/);
  assert.match(g, /Measure one gate's CPU use/);
  assert.match(g, /below the thread count/);
  assert.match(g, /Watch the load/);
  assert.match(g, /run skill launches tasks in chunks of at most N/);
  assert.match(g, /sccache/);
  assert.match(g, /read-mostly/);
  // Generic: no hostnames, user paths or project names.
  assert.doesNotMatch(SLOTS, /\/Users\/|\/home\/|\.local\b|@[a-z0-9-]+\.|ssh [a-z]/i);
});

test('HEAD-19 setup points to templates/gate-slots.md when gates are slow or share a build lock', () => {
  assert.match(SETUP_PROJECT, /When a gate takes more than a few minutes, or its build tool holds one lock for the whole build[^.]*point the user to `\$\{CLAUDE_PLUGIN_ROOT\}\/templates\/gate-slots\.md`/);
});

test('HEAD-20 README says agents belong to the head session, closing it ends the run, and the build host needs Claude Code', () => {
  const night = flat(section(README, '## Overnight runs', '\n## '));
  assert.match(night, /Every agent belongs to the head's session/);
  assert.match(night, /closing that session ends the run/);
  assert.match(night, /Running the head on the build host instead would need Claude Code installed and logged in there, which temper doesn't set up/);
  const known = flat(section(README, '## Known issues', '\n## '));
  assert.match(known, /A run stops when the head's Claude Code session closes \(see \[Overnight runs\]/);
});

test('HEAD-21 the known issues note on answers is one line: args and resumeFromRunId, never a generated script', () => {
  const known = section(README, '## Known issues', '\n## ');
  const lines = known.split('\n').filter((l) => /resumeFromRunId/.test(l));
  assert.equal(lines.length, 1, 'one line names resumeFromRunId');
  assert.match(lines[0], /`args` and `resumeFromRunId`, never by editing a generated script/);
});
