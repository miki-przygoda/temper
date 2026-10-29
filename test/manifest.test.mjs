import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

test('plugin.json names temper 0.3.1 by miki-przygoda', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'temper');
  assert.equal(plugin.version, '0.3.1');
  assert.equal(plugin.author.name, 'miki-przygoda');
});

test('plugin.json depends on superpowers from the Anthropic directory', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.deepEqual(plugin.dependencies, ['superpowers@anthropic-plugin-directory']);
});

test('marketplace.json lists temper from this repo', () => {
  const market = readJson('.claude-plugin/marketplace.json');
  assert.equal(market.name, 'temper');
  assert.equal(market.plugins.length, 1);
  assert.equal(typeof market.plugins[0].description, 'string');
  assert.deepEqual(market.plugins, [
    { name: 'temper', source: './', description: market.plugins[0].description },
  ]);
  // A34: the root marketplace allowlists the directory, so installing temper installs superpowers.
  assert.deepEqual(market.allowCrossMarketplaceDependenciesOn, ['anthropic-plugin-directory']);
});

test('README has at least 40 words and mentions superpowers', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const words = readme.split(/\s+/).filter(Boolean);
  assert.ok(words.length >= 40, `README has ${words.length} words`);
  assert.ok(readme.includes('superpowers'));
});
