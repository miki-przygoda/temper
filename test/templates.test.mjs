import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const TEMPLATES = [
  'templates/spec.md',
  'templates/epics.md',
  'templates/plan-additions.md',
  'templates/project.md',
  'templates/preferences.md',
  'templates/gate-slots.md',
];

const PREFERENCE_KEYS = [
  'version',
  'question_style',
  'severe_contact',
  'overnight_without_plan_review',
  'may_push',
  'overnight_fix_default',
  'wakeups_approved',
  'morning_report_time',
  'weekly_stop_percent',
  'keyword_trigger',
];

const REQUIRED_ARGS = [
  'epic', 'repo', 'branch', 'base', 'spec', 'plan', 'log',
  'host', 'gates', 'tasks', 'behaviour_groups', 'done', 'answers',
];

test('each template file exists', () => {
  for (const p of TEMPLATES) assert.ok(existsSync(join(root, p)), `${p} is missing`);
});

test('spec.md has all six headings', () => {
  const spec = read('templates/spec.md');
  for (const h of [
    '## Goal',
    '## User flows',
    '## Contracts between parts',
    '## Non-goals',
    '## Security notes',
    '## Deferred questions',
  ]) {
    assert.ok(spec.includes(h), `spec.md lacks ${h}`);
  }
});

test('epics.md has the epics table', () => {
  assert.ok(read('templates/epics.md').includes('| Epic | Status |'));
});

test("preferences.md's front-block keys are the DEFAULT_PREFERENCES keys", () => {
  const text = read('templates/preferences.md');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'preferences.md has no front block');
  const keys = [...m[1].matchAll(/^(\w+):/gm)].map((x) => x[1]);
  assert.deepEqual(keys, PREFERENCE_KEYS);
});

test("the args schema's top-level required is exactly the build args list", () => {
  const schema = JSON.parse(read('schemas/args.schema.json'));
  assert.deepEqual(schema.required, REQUIRED_ARGS);
});

test('templates/project.md has sweeps, gate_slots, flaky and a Build rule section', () => {
  const text = read('templates/project.md');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'project.md has no front block');
  const lines = m[1].split('\n');
  for (const [key, value] of [['sweeps', '2'], ['gate_slots', ''], ['flaky', '']]) {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    assert.ok(i > 0, `project.md lacks ${key}`);
    assert.equal(lines[i].slice(key.length + 1).trim(), value, `${key}'s default`);
    assert.match(lines[i - 1], /^# \S/, `${key} has a one-line comment above it`);
  }
  const body = text.slice(m[0].length);
  const i = body.indexOf('\n## Build rule\n');
  assert.ok(i >= 0, 'project.md lacks a ## Build rule section');
  const rest = body.slice(i + '\n## Build rule\n'.length);
  const section = rest.split(/\n## /)[0];
  assert.match(section, /<!--[\s\S]*every agent[\s\S]*-->/, 'the Build rule section has an HTML comment explaining it');
});

test('templates/gate-slots.md names flock, a per-slot build dir, a per-slot test scratch dir, the built-from stamp, and sizing', () => {
  const text = read('templates/gate-slots.md');
  const flat = text.replace(/\s+/g, ' ');
  assert.match(flat, /flock -n/);
  assert.match(flat, /own build (output|dir)/i);
  assert.match(flat, /own test scratch dir/i);
  assert.match(flat, /stamp/i);
  assert.match(flat, /touch/i);
  assert.match(flat, /fast storage/i);
  assert.match(flat, /## Sizing/);
  assert.match(flat, /thread count/i);
  assert.match(flat, /gate_slots/);
  assert.match(flat, /sccache/);
  for (const p of ['/home/', '/srv/', '/Users/', '/root/', '/mnt/', '/opt/']) {
    assert.ok(!text.includes(p), `gate-slots.md has an absolute path (${p})`);
  }
  assert.doesNotMatch(text, /(^|[\s`(])\/[a-z]/m, 'gate-slots.md has an absolute path');
  const words = text.split(/\s+/).filter(Boolean).length;
  assert.ok(words < 400, `gate-slots.md has ${words} words`);
});

test('templates/plan-additions.md maps the build rule and flaky into args.json, and gate_slots into the waves', () => {
  const add = read('templates/plan-additions.md').replace(/\s+/g, ' ');
  assert.match(add, /\| the `## Build rule` section of `\.temper\/project\.md` \| `build_rule`/);
  assert.match(add, /\| `flaky` in `\.temper\/project\.md` \| `flaky`/);
  assert.match(add, /\| `gate_slots` in `\.temper\/project\.md` \| no field of its own/);
});
