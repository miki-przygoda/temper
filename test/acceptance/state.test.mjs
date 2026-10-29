// Acceptance tests for the state group (docs/v1-behaviour.md), the ids the head carries out:
// STATE-07 and STATE-17..21. STATE-01..06 and STATE-08..16 drive the Python scripts and are in
// tests_py/acceptance/test_state.py.
// What the head does is read from the skills and templates it follows; where a workflow takes the
// files (args.json, spec.md, plan.md, log.md), the bundled workflows/build.js is driven through the
// harness with scripted agents. A test that fails because of the product is skipped with
// "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from '../harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const SKILL = {
  setup: read('skills/setup/SKILL.md'),
  run: read('skills/run/SKILL.md'),
  temper: read('skills/temper/SKILL.md'),
  ground: read('skills/ground/SKILL.md'),
  plan: read('skills/plan/SKILL.md'),
};
const README = read('README.md');

const section = (text, start, end) => {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `section ${start}`);
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return text.slice(i, j >= 0 ? j : undefined);
};
const flat = (s) => s.replace(/\s+/g, ' ');

function frontBlock(text) {
  const lines = text.split('\n');
  const fences = lines.map((l, i) => (l.trim() === '---' ? i : -1)).filter((i) => i >= 0);
  assert.ok(fences.length >= 2, 'a front block');
  const out = {};
  for (const raw of lines.slice(fences[0] + 1, fences[1])) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes(':')) continue;
    const k = line.slice(0, line.indexOf(':')).trim();
    out[k] = line.slice(line.indexOf(':') + 1).trim();
  }
  return out;
}

// Every agent does what its prompt asks and succeeds.
function responder() {
  return ({ opts }) => {
    const label = opts.label;
    const id = label.slice(label.indexOf(':') + 1);
    if (label.startsWith('impl:') || label.startsWith('retry:')) return { status: 'done', branch: `temper/e/${id}`, commit: 'abcabc01', summary: `did ${id}` };
    if (label.startsWith('check:') || label.startsWith('recheck:')) return { status: 'done', pass: true, problems: [] };
    if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
    if (label === 'checkpoint') return { status: 'done', gate_passed: true, gate_log: 'full.log', flows: [{ flow: 'greet', result: 'ok', evidence: 'ran' }], gaps: [] };
    if (label === 'behaviour-spec') return { status: 'done', groups: [{ key: 'g1', behaviours: [{ id: 'G1-01', text: 'given a name then a greeting' }] }], commit: 'bbbbbb02' };
    if (label.startsWith('acceptance:')) return { status: 'done', group: id, passing: ['G1-01'], failing: [], untestable: [], commit: 'cccccc03' };
    if (label.startsWith('green:')) return { status: 'done', fixed: [], corrected: [], questions: [], still_failing: [] };
    return null;
  };
}

// An args.json typed by a person, not produced by the plan stage: plain JSON text on disk.
const HAND_WRITTEN_ARGS = `{
  "epic": "e",
  "repo": "/srv/app",
  "branch": "temper/e",
  "base": "main",
  "spec": "docs/temper/e/spec.md",
  "plan": "docs/temper/e/plan.md",
  "log": "docs/temper/e/log.md",
  "host": { "kind": "local" },
  "gates": { "quick": "make check", "full": "make ci" },
  "tasks": [
    { "id": "greet", "title": "Greeting", "wave": 0, "owns": ["src/greet.js"], "uses": [], "provides": ["Greet"],
      "text": "HAND-TASK: write greet(name) returning hello name" },
    { "id": "cli", "title": "CLI", "wave": 1, "owns": ["src/cli.js"], "uses": ["Greet"], "provides": [],
      "text": "HAND-TASK-CLI: print greet(argv[2])" }
  ],
  "behaviour_groups": [{ "key": "g1", "title": "Greeting" }],
  "done": [],
  "answers": {}
}
`;

// ---------------------------------------------------------------------------

test('STATE-07 a preference that contradicts a fixed rule is explained and not saved', () => {
  const rules = flat(section(SKILL.setup, '### Answers that contradict the fixed rules', '## 4.'));
  // The fixed rules the examples in the behaviour touch.
  assert.match(rules, /no sudo/);
  assert.match(rules, /never merges/);
  assert.match(rules, /only on a green full gate/);
  // Examples of such requests, including the behaviour's three.
  assert.match(rules, /you can use sudo/);
  assert.match(rules, /merge it for me/);
  assert.match(rules, /push even if the gate fails/);
  // What the head does: explain which rule and why, and not save it.
  assert.match(rules, /explain which rule it contradicts and why, and don't save it/);
  assert.match(rules, /Keep the default for that key/);
  // The same check applies to a change asked for later, not only during the interview.
  const later = flat(section(SKILL.setup, '## 4. Write preferences.md', '## 5.'));
  assert.match(later, /edit that key in `<state>\/preferences\.md`, applying the same fixed-rules check/);
  // The user is told so too.
  assert.match(flat(read('templates/preferences.md')), /contradicts one of these, Claude explains why and doesn't save it/);
  assert.match(flat(README), /contradicts one of the fixed rules below is explained and not saved/);
  // No preference key could hold such a choice: none is about sudo, merging or the gate.
  const keys = Object.keys(frontBlock(read('templates/preferences.md')));
  for (const k of keys) assert.doesNotMatch(k, /sudo|merge|gate|privileg/i, k);
});

test('STATE-17 setup writes .temper/project.md with the gates, host, specs dir, severity notes, lenses and board', (t) => {
  const project = flat(section(SKILL.setup, '## 6. The project'));
  assert.match(project, /copy `\$\{CLAUDE_PLUGIN_ROOT\}\/templates\/project\.md` to `\.temper\/project\.md`/);
  assert.match(project, /`gate_quick`/);
  assert.match(project, /`gate_full`/);
  assert.match(project, /`host`/);
  assert.match(project, /specs_dir: docs\/temper/);

  // Follow the skill in a throwaway git repo.
  const repo = mkdtempSync(join(tmpdir(), 'temper-state-project-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, '.temper'));
  copyFileSync(join(ROOT, 'templates', 'project.md'), join(repo, '.temper', 'project.md'));
  const path = join(repo, '.temper', 'project.md');
  const filled = readFileSync(path, 'utf8')
    .replace(/^gate_quick:.*$/m, 'gate_quick: cargo test -q')
    .replace(/^gate_full:.*$/m, 'gate_full: ci/full-gate.sh')
    .replace(/^host:.*$/m, 'host: ssh buildhost /srv/build');
  writeFileSync(path, filled);

  const text = readFileSync(path, 'utf8');
  const fm = frontBlock(text);
  assert.equal(fm.gate_quick, 'cargo test -q');
  assert.equal(fm.gate_full, 'ci/full-gate.sh');
  assert.equal(fm.host, 'ssh buildhost /srv/build');
  assert.equal(fm.specs_dir, 'docs/temper');
  assert.ok('lenses' in fm, 'extra review lenses');
  assert.equal(fm.board, 'off');
  assert.match(text, /board[^\n]*off/i);
  assert.match(text, /^## Severity notes$/m);

  // The defaults straight from the template: specs dir docs/temper, board off.
  const template = frontBlock(read('templates/project.md'));
  assert.equal(template.specs_dir, 'docs/temper');
  assert.equal(template.board, 'off');
  for (const k of ['gate_quick', 'gate_full', 'host', 'lenses']) assert.ok(k in template, k);

  // The head reads each of them back from that file.
  const files = flat(section(SKILL.run, '## Files', '## Before every launch'));
  assert.match(files, /`\.temper\/project\.md`: the gates, the host, the specs directory \(`specs_dir`, default `docs\/temper`\), `board`, `lenses` and the severity notes/);
});

test('STATE-18 epics.md is the source of truth, and each epic keeps spec, research, plan and log in docs/temper/<epic>/', async () => {
  const epics = read('templates/epics.md');
  assert.match(epics, /source of truth/);
  assert.match(epics, /\| Epic \| Status \|/);
  assert.match(epics, /^## Contracts between epics$/m);

  // The default specs dir is docs/temper, and the stages write the files there.
  assert.equal(frontBlock(read('templates/project.md')).specs_dir, 'docs/temper');
  const ground = flat(SKILL.ground);
  assert.match(ground, /Write `<specs_dir>\/epics\.md`/);
  assert.match(ground, /`<specs_dir>\/<epic>\/spec\.md`/);
  assert.match(ground, /`<specs_dir>\/<epic>\/research\.md`/);
  assert.match(ground, /`<specs_dir>\/<epic>\/log\.md`/);
  assert.match(ground, /`epics\.md` stays the source of truth/);
  const plan = flat(SKILL.plan);
  assert.match(plan, /Save the plan to `<specs_dir>\/<epic>\/plan\.md`/);
  assert.match(plan, /`spec`, `plan`, `log`: `<specs_dir>\/<epic>\/spec\.md`, `plan\.md` and `log\.md`/);
  assert.match(flat(SKILL.run), /`<specs_dir>\/epics\.md`: each epic's status, the source of truth/);
  // The router decides the next stage from epics.md and the epic folders, not from memory.
  assert.match(flat(SKILL.temper), /Look at `<specs_dir>\/epics\.md` and each epic's folder `<specs_dir>\/<epic>\/`/);
  assert.match(flat(README), /`epics\.md` is the source of truth for the epics and their status, and each epic has its own folder with `spec\.md`, `research\.md`, `plan\.md`, `args\.json` and `log\.md`/);

  // The build stage works from those files: every agent is pointed at docs/temper/e/.
  const args = JSON.parse(HAND_WRITTEN_ARGS);
  const { result, calls } = await runWorkflow('workflows/build.js', { args, respond: responder() });
  assert.equal(result.status, 'mvp');
  const prompt = (label) => calls.find((c) => c.opts.label === label).prompt;
  assert.ok(prompt('impl:greet').includes('docs/temper/e/spec.md'));
  assert.ok(prompt('impl:greet').includes('docs/temper/e/plan.md'));
  assert.ok(prompt('checkpoint').includes('docs/temper/e/log.md'));
  assert.ok(prompt('behaviour-spec').includes('docs/temper/e/behaviour.md'));
});

test('STATE-19 decisions, blocked questions and answers, morning reports and open items go into the epic\'s log.md', () => {
  const run = flat(SKILL.run);
  // Blocked questions and their answers.
  assert.match(run, /Record every question and answer in `log\.md`/);
  assert.match(run, /record the question in `log\.md` for the morning report/);
  // Decisions.
  assert.match(run, /decide it yourself and record the decision and its reason in `log\.md`/);
  assert.match(flat(SKILL.ground), /record the decisions made along the way there/);
  assert.match(flat(SKILL.plan), /Record the plan's key decisions in `log\.md`/);
  // Morning reports.
  assert.match(run, /append a morning report to `log\.md`/);
  // Open items.
  assert.match(run, /go to the open items in `log\.md`/);
  assert.match(run, /`open_items`: append them to the open items in `log\.md`/);
  // log.md is the epic's own file.
  assert.match(run, /`<specs_dir>\/<epic>\/args\.json` \(from the `plan` skill\), `spec\.md`, `plan\.md` and `log\.md`/);
});

test('STATE-20 with board mirroring on, the board follows each epics.md change; a board failure never blocks and is logged', () => {
  const run = flat(section(SKILL.run, '## Status and the board', '## Overnight runs'));
  const epicsAt = run.indexOf('epics.md');
  const boardAt = run.indexOf('mirror each change to the board');
  assert.ok(epicsAt >= 0 && boardAt > epicsAt, 'the board mirrors the change made to epics.md');
  assert.match(run, /When `board` in `project\.md` isn't `off`/);
  assert.match(run, /A board that fails to update never blocks the run: note the failure in `log\.md` and go on/);

  const ground = flat(section(SKILL.ground, '## 3. Board mirroring'));
  assert.match(ground, /mirror every status change in `epics\.md` to the board after writing it/);
  assert.match(ground, /A board that fails to update never blocks the run: note the failure and the error in the epic's `log\.md`/);

  const plan = flat(section(SKILL.plan, '## 5. Hand on'));
  assert.ok(plan.indexOf("Set the epic's status in `epics.md`") < plan.indexOf('mirror the change to the board'));
  assert.match(plan, /a board failure is noted in `log\.md` and never blocks/);

  // The run skill moves the status at every stage change, so each one reaches the board.
  for (const s of ['building', 'stabilising', 'ready']) assert.match(flat(SKILL.run), new RegExp(`status to \`${s}\``));
});

test('STATE-21 a hand-written spec.md, plan.md or args.json starts its stage as if an earlier stage had written it', async (t) => {
  // args.json: the build workflow runs from a file a person typed.
  const dir = mkdtempSync(join(tmpdir(), 'temper-state-hand-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'args.json'), HAND_WRITTEN_ARGS);
  const args = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
  const { result, calls } = await runWorkflow('workflows/build.js', { args, respond: responder() });
  assert.equal(result.status, 'mvp');
  const impl = calls.find((c) => c.opts.label === 'impl:greet');
  assert.ok(impl.prompt.includes('HAND-TASK: write greet(name) returning hello name'));
  assert.ok(calls.find((c) => c.opts.label === 'impl:cli').prompt.includes('HAND-TASK-CLI'));
  assert.match(flat(SKILL.run), /`args` is `args\.json` as saved/);

  // spec.md: the plan stage takes any spec.md with no open questions, whoever wrote it.
  const planInputs = flat(section(SKILL.plan, '## 0. Read the inputs', '## 1.'));
  assert.match(planInputs, /Read `<specs_dir>\/<epic>\/spec\.md`\. If it has open questions, stop/);
  assert.match(flat(README), /You can start at any stage that has its input file/);

  // plan.md: a plan.md a person wrote is turned into args.json, not replaced by a new plan.
  // The plan skill always writes the plan afresh with superpowers:writing-plans and saves it to
  // plan.md; neither it nor the router has a path that starts from an existing plan.md.
  const planSkill = flat(SKILL.plan);
  const router = flat(SKILL.temper);
  const usesExisting = /plan\.md` (already )?exists|existing `?plan\.md|hand-written `?plan\.md|plan\.md` (that )?(a person|the user) wrote|plan\.md` written by hand/;
  assert.ok(usesExisting.test(planSkill) || usesExisting.test(router),
    'the plan skill or the router starts from an existing (hand-written) plan.md');
});
