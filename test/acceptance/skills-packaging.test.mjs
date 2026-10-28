// Acceptance tests for the skills-packaging group (docs/v1-behaviour.md, SKILLS-PACKAGING-01..15,
// 17..27). SKILLS-PACKAGING-16 and 28 drive done_tasks.py and cleanup_check.py and are in
// tests_py/acceptance/test_skills_packaging.py.
//
// The manifests, README and skills are read as files, the way Claude Code and the head read them.
// The bundled workflows/*.js are driven through the harness with scripted agents. The plugin CLI
// (`claude plugin validate`, `marketplace add`, `install`, `list`) runs only in a fresh temporary
// CLAUDE_CONFIG_DIR, from an empty temporary directory, and is skipped when `claude` isn't on PATH.
// The steps that need the network (installing superpowers from the Anthropic directory, the install
// smoke script) run only with TEMPER_ACCEPTANCE_NETWORK=1.
// The statusline scripts run only against a temporary CLAUDE_CONFIG_DIR and HOME.
// A test that fails because of the product is skipped with "acceptance-failing: <id>".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from '../harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));
const flat = (s) => s.replace(/\s+/g, ' ');

const SKILL = Object.fromEntries(
  ['temper', 'setup', 'ground', 'plan', 'run', 'cleanup'].map((n) => [n, read(`skills/${n}/SKILL.md`)]),
);
const README = read('README.md');

const section = (text, start, end) => {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `section ${start}`);
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return text.slice(i, j >= 0 ? j : undefined);
};

function frontBlock(text) {
  const lines = text.split('\n');
  const fences = lines.map((l, i) => (l.trim() === '---' ? i : -1)).filter((i) => i >= 0);
  assert.ok(fences.length >= 2, 'a front block');
  const out = {};
  for (const raw of lines.slice(fences[0] + 1, fences[1])) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes(':')) continue;
    out[line.slice(0, line.indexOf(':')).trim()] = line.slice(line.indexOf(':') + 1).trim();
  }
  return out;
}

// The rows of the first markdown table after `heading` in `text`, as arrays of cell strings.
function tableRows(text, heading) {
  const body = heading ? section(text, heading) : text;
  const rows = [];
  let started = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('|')) {
      started = true;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;
      rows.push(cells);
    } else if (started) break;
  }
  return rows.slice(1); // drop the header
}

const hasClaude = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
const NETWORK = process.env.TEMPER_ACCEPTANCE_NETWORK === '1';

// A fresh CLAUDE_CONFIG_DIR and an empty working directory for the plugin CLI.
function claudeSandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'temper-pkg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, 'config');
  const work = join(dir, 'work');
  mkdirSync(config);
  mkdirSync(work);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
  const claude = (...a) => {
    const p = spawnSync('claude', a, { cwd: work, env, encoding: 'utf8', timeout: 240000 });
    return { code: p.status, out: p.stdout, err: p.stderr };
  };
  return { dir, config, work, env, claude };
}

// Every agent does what its prompt asks and succeeds.
function responder(overrides = {}) {
  return (q) => {
    const label = q.opts.label;
    if (overrides[label] !== undefined) return overrides[label];
    const id = label.slice(label.indexOf(':') + 1);
    if (label.startsWith('impl:') || label.startsWith('retry:')) return { status: 'done', branch: `temper/e/${id}`, commit: 'abc', summary: `did ${id}` };
    if (label.startsWith('check:') || label.startsWith('recheck:')) return { pass: true, problems: [] };
    if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
    if (label === 'checkpoint') return { gate_passed: true, gate_log: 'full.log', flows: [{ flow: 'greet', result: 'ok', evidence: 'ran' }], gaps: [] };
    if (label === 'behaviour-spec') return { groups: [{ key: 'g1', behaviours: [{ id: 'G1-01', text: 'given a name then a greeting' }] }], commit: 'bbb' };
    if (label.startsWith('acceptance:')) return { group: id, passing: ['G1-01'], failing: [], untestable: [], commit: 'ccc' };
    if (label.startsWith('green:')) return { fixed: [], corrected: [], questions: [], still_failing: [] };
    return null;
  };
}

// args.json as the plan skill's "## 2. Generate args.json" maps it, for a two-task plan.
function planArgs(extra = {}) {
  return {
    epic: 'e',
    repo: '/srv/app',
    branch: 'temper/e',
    base: 'main',
    spec: 'docs/temper/e/spec.md',
    plan: 'docs/temper/e/plan.md',
    log: 'docs/temper/e/log.md',
    host: { kind: 'local' },
    gates: { quick: 'make check', full: 'make ci' },
    tasks: [
      { id: 'greet', title: 'Greeting', wave: 0, owns: ['src/greet.js'], uses: [], provides: ['Greet'], text: 'TASK-GREET: write greet(name)' },
      { id: 'cli', title: 'CLI', wave: 1, owns: ['src/cli.js'], uses: ['Greet'], provides: [], text: 'TASK-CLI: print greet(argv[2])' },
    ],
    behaviour_groups: [{ key: 'g1', title: 'Greeting' }],
    done: [],
    answers: {},
    ...extra,
  };
}

// A small JSON Schema checker for the keywords schemas/args.schema.json uses.
function schemaErrors(schema, value, root = schema, path = '$') {
  const errs = [];
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root);
    return schemaErrors(target, value, root, path);
  }
  const typeOk = (t, v) => ({
    object: v !== null && typeof v === 'object' && !Array.isArray(v),
    array: Array.isArray(v),
    string: typeof v === 'string',
    integer: Number.isInteger(v),
    number: typeof v === 'number',
    boolean: typeof v === 'boolean',
  })[t];
  if (schema.type && !typeOk(schema.type, value)) return [`${path}: not ${schema.type}`];
  if (schema.const !== undefined && value !== schema.const) errs.push(`${path}: not ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not in enum`);
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: pattern`);
  if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path}: minLength`);
  if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: minimum`);
  if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: minItems`);
  if (schema.oneOf) {
    const ok = schema.oneOf.filter((s) => schemaErrors(s, value, root, path).length === 0).length;
    if (ok !== 1) errs.push(`${path}: oneOf matched ${ok}`);
  }
  if (schema.required) for (const k of schema.required) if (!(k in value)) errs.push(`${path}.${k}: required`);
  if (schema.properties) {
    for (const [k, s] of Object.entries(schema.properties)) if (k in value) errs.push(...schemaErrors(s, value[k], root, `${path}.${k}`));
  }
  if (schema.additionalProperties !== undefined && typeOk('object', value)) {
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && k in schema.properties) continue;
      if (schema.additionalProperties === false) errs.push(`${path}.${k}: additional`);
      else if (typeof schema.additionalProperties === 'object') errs.push(...schemaErrors(schema.additionalProperties, v, root, `${path}.${k}`));
    }
  }
  if (schema.items && Array.isArray(value)) value.forEach((v, i) => errs.push(...schemaErrors(schema.items, v, root, `${path}[${i}]`)));
  return errs;
}

// The statusline, installed into a temporary CLAUDE_CONFIG_DIR and HOME.
function statuslineSandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'temper-pkg-sl-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, 'config');
  const home = join(dir, 'home');
  mkdirSync(config);
  mkdirSync(home);
  const env = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: config, CLAUDE_PLUGIN_ROOT: ROOT, LC_ALL: 'C' };
  const py = (args, input) => {
    const p = spawnSync('python3', args, { cwd: dir, env, input, encoding: 'utf8', timeout: 30000 });
    return { code: p.status, out: p.stdout, err: p.stderr };
  };
  return { dir, config, home, env, py, state: join(config, 'temper') };
}

// ---------------------------------------------------------------------------

test('SKILLS-PACKAGING-01 plugin.json is named temper and depends on superpowers@anthropic-plugin-directory', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'temper');
  assert.ok(Array.isArray(plugin.dependencies), 'dependencies is a list');
  assert.ok(plugin.dependencies.includes('superpowers@anthropic-plugin-directory'), JSON.stringify(plugin.dependencies));
});

test('SKILLS-PACKAGING-02 temper fails to load until superpowers is installed, and the README and setup say to install it first', async (t) => {
  // The README's install steps put superpowers first, and say why.
  const install = section(README, '## Install', '\n## ');
  const cmds = install.split('\n').filter((l) => l.startsWith('claude plugin'));
  assert.equal(cmds[0], 'claude plugin install superpowers@anthropic-plugin-directory');
  assert.match(flat(install), /Install superpowers first/);
  assert.match(flat(install), /doesn't load until superpowers is installed/);
  // /temper:setup checks it first and tells the user to install it before anything else.
  const setup = flat(section(SKILL.setup, '## 1. Superpowers first', '## 2.'));
  assert.ok(SKILL.setup.indexOf('## 1. Superpowers first') < SKILL.setup.indexOf('## 3. The interview'));
  assert.match(setup, /fails to load until it is/);
  assert.match(setup, /tell the user to install superpowers first/);
  assert.match(setup, /claude plugin install superpowers@anthropic-plugin-directory/);
  assert.match(setup, /Do nothing else until it is installed/);

  // The real CLI: install temper without superpowers, and it reports the dependency and doesn't load.
  if (!hasClaude) {
    t.diagnostic('claude is not on PATH: the CLI part was not run');
    return;
  }
  const sb = claudeSandbox(t);
  assert.equal(sb.claude('plugin', 'marketplace', 'add', ROOT).code, 0, 'marketplace add');
  assert.equal(sb.claude('plugin', 'install', 'temper@temper').code, 0, 'install temper');
  let list = JSON.parse(sb.claude('plugin', 'list', '--json').out);
  let temper = list.find((p) => p.id === 'temper@temper');
  assert.ok(temper, 'temper is installed');
  assert.ok(Array.isArray(temper.errors) && temper.errors.some((e) => e.includes('superpowers@anthropic-plugin-directory')), JSON.stringify(temper));
  assert.ok((temper.errorDetails ?? []).some((d) => d.type === 'dependency-unsatisfied' && d.dependency === 'superpowers@anthropic-plugin-directory'));
  assert.match(sb.claude('plugin', 'list').out, /temper@temper[\s\S]*failed to load/);

  if (!NETWORK) {
    t.diagnostic('TEMPER_ACCEPTANCE_NETWORK is not 1: installing superpowers was not run');
    return;
  }
  // Then installing superpowers makes it load.
  assert.equal(sb.claude('plugin', 'install', 'superpowers@anthropic-plugin-directory').code, 0, 'install superpowers');
  list = JSON.parse(sb.claude('plugin', 'list', '--json').out);
  temper = list.find((p) => p.id === 'temper@temper');
  assert.equal(temper.enabled, true);
  assert.ok(!temper.errors || temper.errors.length === 0, JSON.stringify(temper.errors));
});

test('SKILLS-PACKAGING-03 the README installs superpowers, then the marketplace, then temper@temper, which ends up enabled', (t) => {
  const install = section(README, '## Install', '\n## ');
  const cmds = install.split('\n').filter((l) => l.startsWith('claude plugin'));
  assert.deepEqual(cmds, [
    'claude plugin install superpowers@anthropic-plugin-directory',
    'claude plugin marketplace add miki-przygoda/temper',
    'claude plugin install temper@temper',
  ]);
  // The marketplace the README adds is this repo's, and it offers temper (so `temper@temper`).
  const market = readJson('.claude-plugin/marketplace.json');
  assert.equal(market.name, 'temper');
  assert.ok(market.plugins.some((p) => p.name === 'temper' && p.source === './'));

  if (!hasClaude || !NETWORK) {
    t.diagnostic('claude is not on PATH or TEMPER_ACCEPTANCE_NETWORK is not 1: the live install was not run');
    return;
  }
  // The README's steps in the README's order, with this checkout as the marketplace (the repo is
  // private), in a throwaway config. Then `claude plugin list` shows temper@temper enabled.
  const sb = claudeSandbox(t);
  assert.equal(sb.claude('plugin', 'install', 'superpowers@anthropic-plugin-directory').code, 0, 'install superpowers');
  assert.equal(sb.claude('plugin', 'marketplace', 'add', ROOT).code, 0, 'marketplace add');
  assert.equal(sb.claude('plugin', 'install', 'temper@temper').code, 0, 'install temper');
  const list = JSON.parse(sb.claude('plugin', 'list', '--json').out);
  const temper = list.find((p) => p.id === 'temper@temper');
  assert.ok(temper, JSON.stringify(list));
  assert.equal(temper.enabled, true);
  assert.ok(!temper.errors || temper.errors.length === 0, JSON.stringify(temper.errors));
  assert.match(sb.claude('plugin', 'list').out, /temper@temper[^❯]*enabled/);
  // The install smoke script does the same and agrees.
  const smoke = spawnSync('sh', [join(ROOT, 'scripts', 'install_smoke.sh')], { cwd: sb.work, env: sb.env, encoding: 'utf8', timeout: 240000 });
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.match(smoke.stdout, /temper@temper enabled/);
});

// A LICENSE (or `license` field) is the owner's choice before sharing, not a v1 check: spec 10.2 asks
// only for `claude plugin validate --strict`, and the plan says "A LICENSE is not required by
// `--strict`; it's the owner's choice later, and the directory profile asks for it" (Task 1 step 4).
test('SKILLS-PACKAGING-04 claude plugin validate --strict passes, with author details and a 40-word README', (t) => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.ok(plugin.author && typeof plugin.author.name === 'string' && plugin.author.name.length > 0, 'author details');
  const words = README.split(/\s+/).filter(Boolean);
  assert.ok(words.length >= 40, `README has ${words.length} words`);

  if (!hasClaude) {
    t.diagnostic('claude is not on PATH: validate was not run');
    return;
  }
  const sb = claudeSandbox(t);
  for (const target of [ROOT, join(ROOT, '.claude-plugin', 'plugin.json')]) {
    const r = sb.claude('plugin', 'validate', target, '--strict', '--json');
    assert.equal(r.code, 0, r.out + r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.success, true);
    const codes = (out.directory?.findings ?? []).map((f) => f.code);
    for (const c of ['AUTHOR_MISSING', 'README_MISSING', 'README_TOO_SHORT']) assert.ok(!codes.includes(c), `${target}: ${c}`);
  }
});

test('SKILLS-PACKAGING-05 /temper:build, /temper:stabilise and /temper:publish are the plugin workflows and take their args as a JSON object', async () => {
  // A plugin's workflows/<name>.js runs as /<plugin>:<name> (spike S5).
  for (const name of ['build', 'stabilise', 'publish']) {
    const path = join(ROOT, 'workflows', `${name}.js`);
    assert.ok(existsSync(path), path);
    const meta = read(`workflows/${name}.js`).match(/export const meta = \{[\s\S]*?name: '(\w+)'/);
    assert.ok(meta, `${name}.js exports meta`);
    assert.equal(meta[1], name);
    assert.match(README, new RegExp(`\`/temper:${name}\` \\(workflow\\)`));
    assert.match(SKILL.run, new RegExp(`\`temper:${name}\``));
  }
  assert.match(flat(SKILL.run), /Launch a stage with the Workflow tool: the workflow name \(`temper:build`, `temper:stabilise` or `temper:publish`\) and `args` set to the args object/);

  // Each workflow reads the args as an object: its fields reach the agents, and a non-object is refused.
  const build = await runWorkflow('workflows/build.js', { args: planArgs(), respond: responder() });
  assert.equal(build.result.status, 'mvp');
  assert.ok(build.calls.find((c) => c.opts.label === 'impl:greet').prompt.includes('TASK-GREET'));

  const common = { epic: 'e', repo: '/srv/app', branch: 'temper/e', base: 'main', log: 'docs/temper/e/log.md', host: { kind: 'local' }, gates: { quick: 'make check', full: 'make ci' }, done: [] };
  const stab = await runWorkflow('workflows/stabilise.js', {
    args: { ...common, part: 'sweep', lenses: [], severity_notes: 'NOTE-XYZ' },
    respond: () => ({ findings: [] }),
  });
  assert.notEqual(stab.result.status, 'invalid', JSON.stringify(stab.result));
  assert.ok(stab.calls.length > 0);
  assert.ok(stab.calls.some((c) => c.prompt.includes('temper/e')));

  const pub = await runWorkflow('workflows/publish.js', { args: { ...common, spec: 'docs/temper/e/spec.md' }, respond: () => null });
  assert.notEqual(pub.result.status, 'invalid', JSON.stringify(pub.result));
  assert.ok(pub.calls.length > 0);

  for (const name of ['build', 'stabilise', 'publish']) {
    const asText = await runWorkflow(`workflows/${name}.js`, { args: JSON.stringify(planArgs()), respond: () => null });
    assert.equal(asText.result.status, 'invalid');
    assert.equal(asText.calls.length, 0);
    const empty = await runWorkflow(`workflows/${name}.js`, { args: {}, respond: () => null });
    assert.equal(empty.result.status, 'invalid');
    assert.ok(empty.result.errors.some((e) => e.startsWith('epic')), JSON.stringify(empty.result.errors));
  }
});

test('SKILLS-PACKAGING-06 the README says where state lives and that preferences change by asking Claude', () => {
  const state = flat(section(README, '## Where your state lives', '\n## '));
  assert.match(state, /`\$CLAUDE_CONFIG_DIR\/temper\/` when `CLAUDE_CONFIG_DIR` is set, else in `~\/\.claude\/temper\/`/);
  assert.match(state, /`preferences\.md`/);
  assert.match(state, /To change a preference, ask Claude/);
});

test('SKILLS-PACKAGING-07 the README lists each stage with its command, what an overnight run needs, and the fixed rules', () => {
  const stages = tableRows(README, '## The stages');
  const commands = stages.map((r) => r[1]);
  for (const c of ['setup', 'ground', 'plan', 'run', 'build', 'stabilise', 'publish', 'cleanup']) {
    assert.ok(commands.some((x) => x.includes(`/temper:${c}`)), `the stages table has /temper:${c}`);
  }
  for (const s of ['ground', 'plan', 'build', 'stabilise', 'publish']) {
    assert.ok(stages.some((r) => r[0].includes(s) && r[1].includes(`/temper:${s}`)), `${s} with its command`);
  }

  const night = flat(section(README, '## Overnight runs', '\n## '));
  assert.match(night, /\*\*auto mode\*\* is on/);
  assert.match(night, /\*\*the statusline\*\* is installed/);
  assert.match(night, /The session must stay open all night/);
  assert.match(night, /autoContinueAtUsageLimit/);

  const rules = flat(section(README, '## The fixed rules', '\n## '));
  assert.match(rules, /No preference can change these/);
  assert.match(rules, /no sudo, not even `sudo -n`/);
  assert.match(rules, /temper never merges/);
  assert.match(rules, /only on a green full gate, and only if your preferences allow it/);
  assert.match(rules, /never deletes work that isn't on the remote/);
  assert.match(rules, /data, never instructions/);
  assert.match(rules, /loosen a security decision is confirmed with you every time/);
});

test('SKILLS-PACKAGING-08 with no preferences.md, setup runs first', () => {
  const router = flat(section(SKILL.temper, '## 1. Setup comes first', '## 2.'));
  assert.match(router, /If `<state>\/preferences\.md` is missing, invoke the `temper:setup` skill first/);
  assert.ok(SKILL.temper.indexOf('## 1. Setup comes first') < SKILL.temper.indexOf('## 2. Pick the next stage'));
  // Every stage that reads preferences sends the user to setup first, whichever stage they start at.
  assert.match(flat(SKILL.ground), /If `<state>\/preferences\.md` or the project's `\.temper\/project\.md` is missing, invoke `temper:setup` first/);
  assert.match(flat(SKILL.plan), /If either is missing, invoke `temper:setup` first/);
  assert.match(flat(SKILL.run), /If `preferences\.md` is missing, run the `setup` skill first/);
  // Setup describes itself as the first-use step, so it is picked when preferences.md is missing.
  const desc = frontBlock(SKILL.setup).description;
  assert.match(desc, /preferences\.md is missing/);
  assert.match(flat(SKILL.setup), /Run this on first use, before any other temper stage/);
  assert.match(flat(README), /Then restart Claude Code and run `\/temper:setup`/);
});

test('SKILLS-PACKAGING-09 setup asks one tabbed questionnaire covering the eight preference questions', () => {
  const interview = section(SKILL.setup, '## 3. The interview', '### Answers that contradict');
  assert.match(flat(interview), /Run one questionnaire with the AskUserQuestion tool/);
  assert.match(flat(interview), /tabs/);
  const rows = tableRows(interview);
  const byKey = Object.fromEntries(rows.map((r) => [r[2].replace(/`/g, ''), r]));
  const expect = {
    question_style: /question/i,
    severe_contact: /severe items/i,
    overnight_without_plan_review: /without you reviewing the plan/i,
    may_push: /push branches and open PRs/i,
    overnight_fix_default: /fixed overnight/i,
    wakeups_approved: /check-ins overnight/i,
    morning_report_time: /morning report/i,
    keyword_trigger: /"temper" in a prompt/i,
  };
  assert.equal(rows.length, 8, rows.map((r) => r[2]).join(', '));
  for (const [key, q] of Object.entries(expect)) {
    assert.ok(byKey[key], `a tab for ${key}`);
    assert.match(byKey[key][1], q, key);
  }
  // Each answer has a home in preferences.md.
  const prefs = frontBlock(read('templates/preferences.md'));
  for (const key of Object.keys(expect)) assert.ok(key in prefs, `templates/preferences.md has ${key}`);
  // Within AskUserQuestion's limit of 4 tabs per call.
  assert.match(flat(interview), /two calls of four tabs/);
});

test('SKILLS-PACKAGING-10 after writing the answers, setup says where preferences.md is and that any choice can be changed by asking Claude', () => {
  const write = flat(section(SKILL.setup, '## 4. Write preferences.md', '## 5.'));
  assert.match(write, /Then tell the user: - where the file is \(the full path of `<state>\/preferences\.md`\)/);
  assert.match(write, /they can ask Claude to change, undo or specialise any choice at any time/);
  // The file itself says so too, for when they open it.
  assert.match(flat(read('templates/preferences.md')), /ask Claude to change, undo or specialise any of these at any time/);
});

test('SKILLS-PACKAGING-11 the router picks the next stage by the state of the files', () => {
  const pick = section(SKILL.temper, '## 2. Pick the next stage from the files', '## 3.');
  assert.match(flat(SKILL.temper), /decide from the files, never from memory/);
  const rows = tableRows(pick);
  const next = (pred) => rows.find((r) => pred(r[0]))?.[1] ?? '';
  // No epics.md: ground. It's the first row, so it wins over everything else.
  assert.match(rows[0][0], /no `epics\.md`/);
  assert.match(rows[0][1], /`temper:ground`/);
  // A finished spec but no args.json: plan.
  assert.match(next((s) => /finished `spec\.md` but no `args\.json`/.test(s)), /`temper:plan`/);
  // An unfinished spec goes back to ground, not to plan.
  assert.match(next((s) => /`spec\.md` is missing or still has open questions/.test(s)), /`temper:ground`/);
  // With args.json, run.
  assert.match(next((s) => /it has `args\.json`/.test(s)), /`temper:run`/);
  // When the files disagree with a status, the files that exist win.
  assert.match(flat(pick), /trust the files that exist/);
});

test('SKILLS-PACKAGING-12 ground uses the question style, runs three research agents in parallel into research.md, recommends a size and writes epics.md with contracts', () => {
  const g = flat(SKILL.ground);
  assert.match(g, /From `preferences\.md`, read `question_style`/);
  assert.match(g, /Ask questions the way `question_style` says/);
  assert.match(g, /start three research agents at the same time/);
  assert.match(g, /\*\*best practices:\*\*/);
  assert.match(g, /\*\*prior art:\*\*/);
  assert.match(g, /\*\*documented facts:\*\* every API, version, limit or behaviour the design will depend on, each with a source link/);
  assert.match(g, /Write their findings to `<specs_dir>\/<epic>\/research\.md`/);
  assert.match(g, /Recommend either the full lifecycle \(plan, build, stabilise, publish\) or specs only/);
  assert.match(g, /Write `<specs_dir>\/epics\.md` from `\$\{CLAUDE_PLUGIN_ROOT\}\/templates\/epics\.md`/);
  assert.match(g, /under `## Contracts between epics`, every contract one epic needs from another/);
  assert.match(read('templates/epics.md'), /^## Contracts between epics$/m);
});

test('SKILLS-PACKAGING-13 a spec is handed on only with every required section and no open questions', () => {
  const g = flat(SKILL.ground);
  assert.match(g, /A spec is handed on only when it has no open questions/);
  assert.match(g, /placeholders, "TBD" and contradictions between sections count as open questions/);
  assert.match(g, /deferred questions, each with the reason it can wait/);
  const spec = read('templates/spec.md');
  for (const h of ['Goal', 'User flows', 'Contracts between parts', 'Non-goals', 'Security notes', 'Deferred questions']) {
    assert.match(spec, new RegExp(`^## ${h}$`, 'm'), h);
  }
  assert.doesNotMatch(spec, /^## Open questions$/m);
  // Plan refuses a spec with open questions, and the router sends it back to ground.
  assert.match(flat(SKILL.plan), /If it has open questions, stop and invoke `temper:ground` for that epic instead/);
  assert.match(flat(SKILL.temper), /`spec\.md` is missing or still has open questions \| `temper:ground`/);
});

test('SKILLS-PACKAGING-14 the plan has contracts at every boundary, one owner per file per wave, waves from the graph, and names groups, ids and gates', async () => {
  const p = flat(SKILL.plan);
  const add = flat(read('templates/plan-additions.md'));
  assert.match(p, /a written contract at every boundary between tasks/);
  assert.match(p, /no two tasks in the same wave own the same path/);
  assert.match(add, /No two tasks in the same wave own the same file/);
  assert.match(p, /wave 0 builds the shared contracts/);
  assert.match(p, /every contract a task `uses` is provided by a task in an earlier wave/);
  assert.match(p, /a `## Behaviour groups` list/);
  assert.match(p, /a task id\*\* in each task's heading/);
  assert.match(p, /the gate commands\*\* from `project\.md`, quoted in the plan/);
  for (const line of ['Owns:', 'Uses:', 'Provides:', 'Wave:']) assert.ok(add.includes(line), line);

  // The build stage holds a plan to the same rules: a plan that breaks them never starts an agent.
  const clash = planArgs();
  clash.tasks[1] = { ...clash.tasks[1], wave: 0, uses: [], owns: ['src/greet.js'] };
  const r1 = await runWorkflow('workflows/build.js', { args: clash, respond: responder() });
  assert.equal(r1.result.status, 'invalid');
  assert.equal(r1.calls.length, 0);

  const sameWave = planArgs();
  sameWave.tasks[1] = { ...sameWave.tasks[1], wave: 0 };
  const r2 = await runWorkflow('workflows/build.js', { args: sameWave, respond: responder() });
  assert.equal(r2.result.status, 'invalid', 'a contract from the same wave is not an earlier wave');
  assert.equal(r2.calls.length, 0);

  // A plan that keeps them runs wave 0 (the contract) before wave 1 (its user).
  const ok = await runWorkflow('workflows/build.js', { args: planArgs(), respond: responder() });
  const labels = ok.calls.map((c) => c.opts.label);
  assert.ok(labels.indexOf('impl:greet') < labels.indexOf('impl:cli'), labels.join(','));
});

test('SKILLS-PACKAGING-15 plan writes an args.json that follows the schema, and the user reviews the plan unless preferences allow an overnight skip', async () => {
  const schema = readJson('schemas/args.schema.json');
  const gen = section(SKILL.plan, '## 2. Generate args.json', '## 3.');
  assert.match(flat(gen), /following `\$\{CLAUDE_PLUGIN_ROOT\}\/schemas\/args\.schema\.json`, with every required field/);
  // Every field the schema requires is one the skill tells the head to fill.
  const named = new Set([...gen.matchAll(/^- .*$/gm)].flatMap((m) => [...m[0].matchAll(/`(\w+)`(?:,? (?:and )?`\w+`)*:/g)].flatMap((x) => [...x[0].matchAll(/`(\w+)`/g)].map((y) => y[1]))));
  for (const k of schema.required) assert.ok(named.has(k), `the plan skill fills ${k}`);
  // An args.json filled the way the skill maps it follows the schema, and the build accepts it.
  const args = planArgs();
  assert.deepEqual(schemaErrors(schema, args), []);
  const ssh = planArgs({ host: { kind: 'ssh', name: 'beast', root: '/srv/build', clone: '/srv/repo' } });
  assert.deepEqual(schemaErrors(schema, ssh), []);
  // A7: an ssh host carries its clone, from project.md's host_clone, and the schema needs it.
  assert.ok(schemaErrors(schema, planArgs({ host: { kind: 'ssh', name: 'beast', root: '/srv/build' } })).length > 0, 'an ssh host without its clone');
  assert.match(flat(gen), /`\{"kind":"ssh","name":"<host>","root":"<root>","clone":"<host_clone>"\}`/);
  assert.ok('host_clone' in frontBlock(read('templates/project.md')), 'project.md has host_clone');
  const { result } = await runWorkflow('workflows/build.js', { args, respond: responder() });
  assert.equal(result.status, 'mvp');
  // The checker isn't vacuous.
  assert.ok(schemaErrors(schema, { ...args, gates: { quick: 'x' } }).length > 0);

  const review = flat(section(SKILL.plan, '## 4. The user\'s plan review', '## 5.'));
  assert.match(review, /Ask the user to review the plan before stage 3/);
  assert.match(review, /Skip the review only when `overnight_without_plan_review` is `yes` in `preferences\.md` and the build will start as an overnight run/);
  assert.equal(frontBlock(read('templates/preferences.md')).overnight_without_plan_review, 'no');
  assert.match(flat(SKILL.run), /\*\*The plan was reviewed\*\*, unless `overnight_without_plan_review` is `yes`/);
});

test('SKILLS-PACKAGING-17 a finished workflow wakes the head, which reads the return value and blocked list from the notification', async () => {
  const launch = flat(section(SKILL.run, '## Launching and resuming', '## Stage 3'));
  assert.match(launch, /Then end your turn/);
  assert.match(launch, /its completion notification starts your next turn with the script's return value/);
  assert.match(launch, /Read the return value from the notification; don't poll/);
  assert.match(flat(SKILL.run), /`blocked`: `blocked` is a list of `\{id, reason\}`/);

  // The blocked list is in the workflow's return value itself.
  const { result } = await runWorkflow('workflows/build.js', {
    args: planArgs(),
    respond: responder({ 'impl:greet': { status: 'blocked', question: 'Q-WHICH-GREETING?', context: 'spec is silent' } }),
  });
  assert.equal(result.status, 'blocked');
  assert.ok(Array.isArray(result.blocked));
  const entry = result.blocked.find((b) => b.id === 'greet');
  assert.ok(entry, JSON.stringify(result.blocked));
  assert.match(entry.reason, /Q-WHICH-GREETING\?/);
});

test('SKILLS-PACKAGING-18 a blocked question the spec settles is answered from the spec', () => {
  const loop = flat(section(SKILL.run, '### Task ids: the answer loop', '### Ids that aren\'t tasks'));
  assert.match(loop, /For each blocked task, answer its question from the spec/);
  assert.match(loop, /1\. \*\*The spec settles it:\*\* write the answer/);
  assert.match(loop, /Write each answer to `args\.answers\[<task id>\]`/);
});

test('SKILLS-PACKAGING-19 a severe question the spec does not settle goes to the user, or is told to them per their preferences', () => {
  const loop = flat(section(SKILL.run, '### Task ids: the answer loop', '### Ids that aren\'t tasks'));
  assert.match(loop, /\*\*It doesn't, and it's severe\*\* \(a security issue or anything the rubric calls severe\): the user decides/);
  assert.match(loop, /User present: ask with AskUserQuestion/);
  assert.match(loop, /Overnight, per `severe_contact` in `preferences\.md`: `report` → record the question in `log\.md` for the morning report; `push` or `push-blocking` → also send a push notification with the question/);
  assert.match(loop, /The task stays blocked until the user answers/);
  for (const v of ['report', 'push', 'push-blocking']) assert.match(SKILL.setup, new RegExp(`\`${v}\``));
});

test('SKILLS-PACKAGING-20 a non-severe question the spec does not settle is decided by the head and recorded in log.md', () => {
  const loop = flat(section(SKILL.run, '### Task ids: the answer loop', '### Ids that aren\'t tasks'));
  assert.match(loop, /\*\*It doesn't, and it isn't severe:\*\* decide it yourself and record the decision and its reason in `log\.md`/);
  assert.match(loop, /Record every question and answer in `log\.md`/);
});

test('SKILLS-PACKAGING-21 each answer goes to args.answers for its own task, and the run resumes with a refreshed args.done', async () => {
  const loop = flat(section(SKILL.run, '### Task ids: the answer loop', '### Ids that aren\'t tasks'));
  assert.match(loop, /Write each answer to `args\.answers\[<task id>\]` in `args\.json`. Each answer reaches only its own task's prompt/);
  assert.match(loop, /refresh `args\.done` and resume/);
  assert.match(flat(SKILL.run), /To resume a run after answering blocked items.*launch the same workflow with the updated args and `resumeFromRunId`/);

  // The resumed build: greet finished (in args.done), cli blocked earlier and now has its answer.
  const answer = 'ANSWER-CLI-PRINTS-TO-STDOUT';
  const { result, calls } = await runWorkflow('workflows/build.js', {
    args: planArgs({ done: ['greet'], answers: { cli: answer } }),
    respond: responder(),
  });
  assert.equal(result.status, 'mvp', JSON.stringify(result));
  const labels = calls.map((c) => c.opts.label);
  assert.ok(!labels.includes('impl:greet'), 'a finished task is not run again');
  const cli = calls.find((c) => c.opts.label === 'impl:cli');
  assert.ok(cli && cli.prompt.includes(answer), 'the answer reaches its own task');
  for (const c of calls) if (c !== cli && !c.opts.label.endsWith(':cli')) assert.ok(!c.prompt.includes(answer), `${c.opts.label} doesn't see it`);
});

test('SKILLS-PACKAGING-22 the overnight pre-flight checks auto mode, reports the optional autoContinueAtUsageLimit, checks the statusline, limits.json and wakeups, and says the session must stay open', (t) => {
  const pre = flat(section(SKILL.run, '### Pre-flight', '### Wakeups'));
  assert.match(pre, /\*\*Auto mode is on\.\*\*/);
  assert.match(pre, /\*\*`autoContinueAtUsageLimit` is optional\.\*\* Report whether it is on/);
  assert.match(pre, /don't hold the launch because it is off/);
  assert.match(pre, /\*\*The statusline is installed\*\*, it wraps any statusline the user had, and `limits\.json` is fresh: `install_statusline\.py status` reports `installed: true` and `limits_age_s` under about 600/);
  assert.match(pre, /\*\*Wakeups are approved:\*\* `wakeups_approved: yes`/);
  assert.match(pre, /Tell the user this session must stay open all night/);

  // What the pre-flight reads, driven for real: a user with their own statusline installs temper's.
  const sb = statuslineSandbox(t);
  const settings = join(sb.config, 'settings.json');
  writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'echo MINE-STATUS' } }));
  let st = JSON.parse(sb.py([join(ROOT, 'scripts', 'install_statusline.py'), 'status']).out);
  assert.equal(st.installed, false, 'before install the check fails');
  const inst = sb.py([join(ROOT, 'scripts', 'install_statusline.py'), 'install']);
  assert.equal(inst.code, 0, inst.err);
  assert.equal(JSON.parse(inst.out).wrapped, true);
  st = JSON.parse(sb.py([join(ROOT, 'scripts', 'install_statusline.py'), 'status']).out);
  assert.equal(st.installed, true);
  assert.equal(st.limits_age_s, null, 'no limits.json yet: not fresh');
  // A statusline refresh with rate_limits makes limits.json fresh, and the user's statusline still shows.
  const cmd = JSON.parse(readFileSync(settings, 'utf8')).statusLine.command;
  const payload = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 10, resets_at: 1792868400 }, seven_day: { used_percentage: 40, resets_at: 1793232000 } } });
  const run = spawnSync('sh', ['-c', cmd], { cwd: sb.dir, env: sb.env, input: payload, encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /MINE-STATUS/);
  st = JSON.parse(sb.py([join(ROOT, 'scripts', 'install_statusline.py'), 'status']).out);
  assert.ok(typeof st.limits_age_s === 'number' && st.limits_age_s < 600, JSON.stringify(st));
});

test('SKILLS-PACKAGING-23 the first check-in is 2 minutes after rate_limits.five_hour.resets_at', (t) => {
  const wake = flat(section(SKILL.run, '### Wakeups', '### The morning report'));
  assert.match(wake, /At launch, read `five_hour\.resets_at` \(Unix seconds\) from `<state>\/limits\.json`\. Schedule a one-shot check-in with CronCreate \(`recurring: false`\) for 2 minutes after that reset/);

  // limits.json's five_hour.resets_at is the statusline input's rate_limits.five_hour.resets_at.
  const sb = statuslineSandbox(t);
  const inst = sb.py([join(ROOT, 'scripts', 'install_statusline.py'), 'install']);
  assert.equal(inst.code, 0, inst.err);
  const cmd = JSON.parse(readFileSync(join(sb.config, 'settings.json'), 'utf8')).statusLine.command;
  const resets = 1792868400;
  const payload = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 15, resets_at: resets }, seven_day: { used_percentage: 47, resets_at: 1793232000 } } });
  const run = spawnSync('sh', ['-c', cmd], { cwd: sb.dir, env: sb.env, input: payload, encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  const limits = JSON.parse(readFileSync(join(sb.state, 'limits.json'), 'utf8'));
  assert.equal(limits.five_hour.resets_at, resets);
  // The check-in the skill schedules: 2 minutes after that reset.
  assert.equal(new Date((limits.five_hour.resets_at + 120) * 1000).toISOString(), '2026-10-24T19:02:00.000Z');
});

test('SKILLS-PACKAGING-24 a check-in reads the journal, resumes a run stopped on the limit, answers what it can and schedules the next', () => {
  const each = flat(section(SKILL.run, '2. Each check-in:', '3. Stop cleanly'));
  assert.match(each, /reads the run's journal and status/);
  assert.match(each, /resumes the run \(`resumeFromRunId`, after refreshing `args\.done`\) if it stopped on the usage limit/);
  assert.match(each, /answers any blocked questions it can, as above/);
  assert.match(each, /schedules the next check-in the same way/);
});

test('SKILLS-PACKAGING-25 the head stops cleanly at the weekly stop or when the next reset is after the morning report time', () => {
  const stop = flat(section(SKILL.run, '3. Stop cleanly', '**Fallback'));
  assert.match(stop, /Stop cleanly, and write the morning report, when `seven_day\.used_percentage` in `limits\.json` is at or above `weekly_stop_percent`, or when the next five-hour reset falls after `morning_report_time`/);
  const prefs = frontBlock(read('templates/preferences.md'));
  assert.equal(prefs.weekly_stop_percent, '90');
  assert.equal(prefs.morning_report_time, '07:00');
  assert.match(flat(SKILL.setup), /`weekly_stop_percent` is the weekly usage at which an overnight run stops cleanly, and that they can lower it/);
  assert.match(flat(README), /`weekly_stop_percent`, default 90/);
});

test('SKILLS-PACKAGING-26 the morning report is a summary in log.md, plus a push if the preferences ask for one', () => {
  const report = flat(section(SKILL.run, '### The morning report'));
  assert.match(report, /append a morning report to `log\.md`: the stages run, the tasks and fixes done, the blocked questions/);
  assert.match(report, /Send a push notification with a one-line summary when `severe_contact` is `push` or `push-blocking`/);
  assert.match(flat(README), /writes a morning report to the epic's `log\.md`/);
});

test('SKILLS-PACKAGING-27 every stage change updates the epic\'s status in epics.md', () => {
  const statuses = read('templates/epics.md').match(/Status is one of: ([^.]+)\./)[1].split(',').map((s) => s.trim());
  assert.deepEqual(statuses, ['spec', 'planned', 'building', 'stabilising', 'ready', 'merged']);
  // Who sets each status when the epic reaches that stage.
  const sets = {
    spec: [SKILL.ground, /status `spec`/],
    planned: [SKILL.plan, /Set the epic's status in `epics\.md` to `planned`/],
    building: [SKILL.run, /Set the epic's status to `building`/],
    stabilising: [SKILL.run, /Set the status to `stabilising`/],
    ready: [SKILL.run, /Set the status to `ready`/],
  };
  for (const [s, [text, re]] of Object.entries(sets)) assert.match(flat(text), re, s);
  assert.match(flat(SKILL.run), /Update the epic's `Status` in `epics\.md` at every stage change/);
  // `merged` is a status the router and cleanup act on, so some skill must record it when the
  // epic's PR is merged and it moves on to cleanup.
  const all = Object.values(SKILL).map(flat).join('\n');
  assert.match(all, /(set|update|record)[^.]*status[^.]*(to|as) `merged`|`merged`[^.]*in `epics\.md`/i, 'no skill records the merged status');
});
