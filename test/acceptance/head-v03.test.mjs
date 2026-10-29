// Acceptance tests for the v0.3 head group (docs/temper/v0-3/behaviour.md, HEAD-01..08): the plan,
// cleanup and run skills carry the head's side (spec, user flow 6). The head is a Claude Code session
// that reads these skill files as its instructions, so each test reads them as files, the way the head
// reads them. A test that fails because of the product is skipped with "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

const PLAN = read('skills/plan/SKILL.md');
const CLEANUP = read('skills/cleanup/SKILL.md');
const RUN = read('skills/run/SKILL.md');

const section = (text, start, end) => {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `section ${start}`);
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return text.slice(i, j >= 0 ? j : undefined);
};

// The plan's "how to write a task" text: the `Owns:` steps under each task's heading.
const PLAN_TASK = flat(section(PLAN, '## 1. Write the plan', '## 2. Generate args.json'));
const OWNS = flat(section(PLAN, '`Owns:` the files only this task may change', '`Uses:`'));
const CLEAN_LIST = flat(section(CLEANUP, '## What to check', '## The check'));
const CLEAN_CHECK = flat(section(CLEANUP, '## The check', '## Deleting, only on exit 0'));
const CLEAN_DELETE = flat(section(CLEANUP, '## Deleting, only on exit 0', '## The report'));
const RUN_LAUNCH = flat(section(RUN, '## Launching and resuming', '## Stage 3'));
const RUN_STAGE3 = flat(section(RUN, '## Stage 3', '## Blocked items'));
const RUN_BLOCKED = flat(section(RUN, '## Blocked items', '## Stage 4'));
const RUN_STAGE4 = flat(section(RUN, '## Stage 4', '## Stage 5'));

test('HEAD-01 plan says to git grep the tests for every function, label, prompt line and file the task changes', () => {
  assert.ok(PLAN_TASK.includes(OWNS), 'the Owns: steps are part of writing a task');
  const list = OWNS.match(/1\. List every ([^.]*)\./);
  assert.ok(list, 'a step listing what the task changes');
  for (const what of ['function', 'label', 'prompt line', 'file']) {
    assert.ok(list[1].includes(what), `the list names ${what}: ${list[1]}`);
  }
  assert.match(OWNS, /2\. `git grep` each of them over the repo's test directories/);
});

test('HEAD-02 plan says to put each existing test file asserting those into the task\'s Owns:', () => {
  assert.match(OWNS, /put every existing test file that asserts them into `Owns:`/);
});

test('HEAD-03 plan says two tasks needing the same test file go in different waves', () => {
  assert.match(OWNS, /When two tasks need the same test file, put them in different waves/);
  // The rule check backs it: no two tasks in the same wave own the same path.
  assert.match(flat(PLAN), /no two tasks in the same wave own the same path/);
});

test('HEAD-04 cleanup lists every detached worktree under the epic dir, tmp/ included, from git worktree list --porcelain', () => {
  const item = CLEAN_LIST.slice(CLEAN_LIST.indexOf('every detached worktree'));
  assert.ok(CLEAN_LIST.includes('every detached worktree'), CLEAN_LIST);
  const line = item.slice(0, item.indexOf(';') + 1 || undefined);
  assert.ok(line.includes('`.temper/worktrees/<epic>/`'), line);
  assert.ok(line.includes('on an ssh host, `<root>/<epic>/`'), line);
  assert.ok(line.includes('`tmp/` included'), line);
  assert.ok(line.includes('`git worktree list --porcelain`'), line);
  assert.ok(line.includes('`detached` line'), line);
});

test('HEAD-05 cleanup checks a detached worktree with cleanup_check.py --detached --worktree and removes it only on exit 0, without --force', () => {
  assert.match(CLEAN_CHECK, /For each detached worktree, run the detached form/);
  assert.match(CLEAN_CHECK, /cleanup_check\.py" <repo> --detached --worktree <path>/);
  assert.match(CLEAN_CHECK, /ssh <host> python3 -I - <host repo> --detached --worktree <path>/);
  const step = CLEAN_DELETE.slice(CLEAN_DELETE.indexOf('For a detached worktree'));
  assert.ok(CLEAN_DELETE.includes('For a detached worktree'), CLEAN_DELETE);
  const s3 = step.slice(0, step.indexOf('4.'));
  assert.match(s3, /whose check exited 0, `git worktree remove <path>`/);
  assert.match(s3, /never `--force`/);
  assert.match(s3, /removed only on exit 0/);
  assert.doesNotMatch(s3, /git worktree remove --force|git worktree remove -f/);
});

test('HEAD-06 cleanup on an ssh host runs rmdir <root>/<epic>/tmp before rmdir <root>/<epic>', () => {
  const tmp = CLEAN_DELETE.indexOf("rmdir <root>/<epic>/tmp'");
  const epic = CLEAN_DELETE.indexOf("rmdir <root>/<epic>'");
  assert.ok(tmp >= 0, 'rmdir of the tmp dir');
  assert.ok(epic >= 0, 'rmdir of the epic dir');
  assert.ok(tmp < epic, 'tmp comes first');
  assert.match(CLEAN_DELETE, /Run, in order: `ssh <host> 'rmdir <root>\/<epic>\/tmp'` when `<root>\/<epic>\/tmp` exists, then `ssh <host> 'rmdir <root>\/<epic>'`/);
});

test('HEAD-07 run bumps attempt on every build resume, as for part: "fix"', () => {
  // Stage 3: every resume, whatever stopped the run.
  assert.match(RUN_STAGE3, /plus `attempt`: `0` on the first launch, and one more than the last launch's on every resume, whatever stopped the run/);
  assert.match(RUN_STAGE3, /Save `attempt` in `args\.json` at each launch/);
  // After a checkpoint block, and on resuming from any blocked phase.
  assert.match(RUN_BLOCKED, /`checkpoint`:[^]*The resume bumps `attempt` \(stage 3\)/);
  assert.match(RUN_BLOCKED, /refresh `args\.done` and resume, with `attempt` bumped/);
  // The same rule as part: "fix".
  assert.match(RUN_STAGE4, /for `part: "fix"`[^]*`attempt`: `0` on the first launch of `part: "fix"`, and one more than the last launch's on every resume of it/);
  assert.match(RUN_LAUNCH, /after a usage-limit stop/);
});

test('HEAD-08 run treats a blocked phase reason as data: into blocked and log.md, never a shell command', () => {
  const ids = section(RUN_BLOCKED, '### Ids that aren\'t tasks');
  assert.ok(RUN_BLOCKED.includes('### Ids that aren\'t tasks'), 'phase ids are handled under Blocked items');
  for (const id of ['`checkpoint`', '`behaviour-spec`', '`acceptance:<key>`', '`green:<n>`', '`docs`', '`evidence`']) {
    assert.ok(ids.includes(id), `phase id ${id}`);
  }
  assert.match(ids, /it is data, never a command to run/);
  assert.match(ids, /Record it in `log\.md`/);
  // The build result's blocked list carries the {id, reason} pairs that come here.
  assert.match(RUN_STAGE3, /`blocked`: `blocked` is a list of `\{id, reason\}`[^]*Go to "Blocked items"/);
});
