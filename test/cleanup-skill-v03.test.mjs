// The cleanup skill's v0.3 text (docs/temper/v0-3/spec.md, contract "The cleanup skill").
// No code checks it: the head follows the skill as a file, so these tests read it as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const CLEANUP = read('skills/cleanup/SKILL.md');

const description = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'frontmatter');
  const line = m[1].split('\n').find((l) => l.startsWith('description:'));
  assert.ok(line, 'description line');
  return line.slice('description:'.length).trim();
};

test('SKILLS-PACKAGING-33 the cleanup skill checks every detached worktree with --detached and removes it only on exit 0', () => {
  const s = flat(CLEANUP);
  assert.ok(s.includes('git worktree list --porcelain'), 'names git worktree list --porcelain');
  assert.ok(s.includes('.temper/worktrees/<epic>/'), 'names .temper/worktrees/<epic>/');
  assert.ok(s.includes('tmp/'), 'names tmp/');
  assert.ok(CLEANUP.includes('cleanup_check.py" <repo> --detached --worktree <path>'), 'gives the --detached command');
  assert.match(s, /detached[^.]*only (on|when it exits) (exit )?0/);
});

test('the cleanup skill removes <root>/<epic>/tmp before <root>/<epic> on an ssh host', () => {
  const tmp = CLEANUP.indexOf('rmdir <root>/<epic>/tmp');
  const epic = CLEANUP.indexOf("ssh <host> 'rmdir <root>/<epic>'");
  assert.ok(tmp >= 0, 'names rmdir <root>/<epic>/tmp');
  assert.ok(epic >= 0, "names ssh <host> 'rmdir <root>/<epic>'");
  assert.ok(tmp < epic, 'tmp comes before the epic directory');
});

test('the cleanup skill never pins a detached worktree to a temporary branch', () => {
  assert.match(flat(CLEANUP), /never (pin|put) [^.]*temporary branch/i);
});

test("skills/cleanup's description is triggering conditions only", () => {
  const d = description(CLEANUP);
  assert.match(d, /^Use when /);
  assert.ok(d.includes('/temper:cleanup'), 'names /temper:cleanup');
  assert.match(d, /PR is merged/);
});
