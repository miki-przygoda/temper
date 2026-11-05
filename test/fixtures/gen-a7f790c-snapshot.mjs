// Writes a7f790c-snapshot.json: the scenarios of v04-scenarios.mjs run on the bundles of commit a7f790c,
// read with `git show`, so it comes out the same on any later checkout. Run it only to add a scenario:
//   node test/fixtures/gen-a7f790c-snapshot.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from '../harness.mjs';
import { SCENARIOS, snapshotOf } from './v04-scenarios.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const COMMIT = 'a7f790c';
const scratch = mkdtempSync(join(tmpdir(), 'temper-snapshot-'));
try {
  const out = {};
  for (const s of SCENARIOS) {
    const file = join(scratch, `${s.wf}.js`);
    writeFileSync(file, execFileSync('git', ['-C', here, 'show', `${COMMIT}:workflows/${s.wf}.js`]));
    out[s.name] = snapshotOf(await runWorkflow(file, { args: JSON.parse(JSON.stringify(s.args)), respond: s.respond }));
  }
  writeFileSync(join(here, `${COMMIT}-snapshot.json`), `${JSON.stringify(out, null, 1)}\n`);
  for (const [name, s] of Object.entries(out)) console.log(`${name}: ${s.result.status}, ${s.calls.length} agents`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
