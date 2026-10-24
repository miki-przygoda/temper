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
