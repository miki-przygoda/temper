import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKILLS = {
  setup: [
    'install superpowers first',
    'AskUserQuestion',
    'preferences.md',
    'install_statusline.py install',
    'ask Claude to change',
  ],
  run: [
    'done_tasks.py',
    'args.done',
    'args.answers',
    'resumeFromRunId',
    'limits.json',
    'CronCreate',
    'seven_day',
    'may_push',
    'never merge',
    'stays open',
  ],
  cleanup: ['cleanup_check.py', 'exit 1', 'nothing is deleted'],
};

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

for (const [name, phrases] of Object.entries(SKILLS)) {
  const path = join(root, 'skills', name, 'SKILL.md');

  test(`skills/${name}/SKILL.md exists`, () => {
    assert.ok(existsSync(path), `${path} is missing`);
  });

  test(`skills/${name} has frontmatter with its name and a description`, () => {
    const fm = frontmatter(readFileSync(path, 'utf8'));
    assert.ok(fm, 'no frontmatter');
    assert.equal(fm.name, name);
    assert.ok(typeof fm.description === 'string' && fm.description.length >= 20, 'description under 20 characters');
  });

  test(`skills/${name} contains its required phrases`, () => {
    const text = readFileSync(path, 'utf8');
    for (const p of phrases) assert.ok(text.includes(p), `skills/${name} lacks "${p}"`);
  });
}
