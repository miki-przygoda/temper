import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The phrases each skill must contain, from the plan's Tasks 14 and 15.
const SKILLS = {
  temper: ['setup', 'ground', 'plan', 'run', 'cleanup', 'preferences.md'],
  ground: [
    'superpowers:brainstorming',
    'research.md',
    'epics.md',
    'templates/spec.md',
    'no open questions',
    'question_style',
  ],
  plan: [
    'superpowers:writing-plans',
    'templates/plan-additions.md',
    'args.json',
    'Owns:',
    'Wave:',
    'earlier wave',
    'review the plan',
  ],
};

// Parses the front block between the first two `---` lines as `key: value` lines.
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

for (const [name, phrases] of Object.entries(SKILLS)) {
  const path = join(root, 'skills', name, 'SKILL.md');

  test(`skills/${name}/SKILL.md has frontmatter with its name and a description`, () => {
    assert.ok(existsSync(path), `skills/${name}/SKILL.md is missing`);
    const fm = frontmatter(readFileSync(path, 'utf8'));
    assert.ok(fm, `skills/${name}/SKILL.md has no frontmatter`);
    assert.equal(fm.name, name);
    assert.ok(
      typeof fm.description === 'string' && fm.description.length >= 20,
      `skills/${name}/SKILL.md needs a description of at least 20 characters`,
    );
  });

  test(`skills/${name}/SKILL.md contains its required phrases`, () => {
    assert.ok(existsSync(path), `skills/${name}/SKILL.md is missing`);
    const text = readFileSync(path, 'utf8');
    for (const p of phrases) assert.ok(text.includes(p), `skills/${name}/SKILL.md lacks "${p}"`);
  });
}
