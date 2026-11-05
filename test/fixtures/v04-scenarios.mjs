// The representative runs behind the byte-identity test (test/build-v04.test.mjs). None uses a field
// added after a7f790c, and together they reach every agent of every stage, so the snapshot holds every
// prompt and schema. gen-a7f790c-snapshot.mjs runs them on a7f790c's bundles; the test runs them on
// today's. Not a test file itself.

const task = (id, wave, extra = {}) => ({
  id,
  title: `Title ${id}`,
  wave,
  owns: [`src/${id}.txt`, `test/${id}.test.txt`],
  uses: [],
  provides: [],
  text: `Task text of ${id}.`,
  ...extra,
});

const common = {
  epic: 'e',
  repo: '/r',
  branch: 'epic/e',
  base: 'main',
  log: 'docs/temper/e/log.md',
  host: { kind: 'local' },
  gates: { quick: 'make quick', full: 'make full' },
  done: [],
};

const ssh = { kind: 'ssh', name: 'builder', root: '/w', clone: '/c/r' };

const buildBase = {
  ...common,
  spec: 'docs/temper/e/spec.md',
  plan: 'docs/temper/e/plan.md',
  default_branch: 'main',
  build_rule: 'Build only with make.',
  flaky: ['suite::timing'],
  tasks: [
    task('a', 0, { provides: ['A'] }),
    task('c', 0),
    task('b', 1, { uses: ['A'] }),
  ],
  behaviour_groups: [{ key: 'g1', title: 'Group 1' }, { key: 'g2', title: 'Group 2' }],
  answers: { a: 'Use the small one.' },
  attempt: 1,
};

const GROUPS = [
  { key: 'g1', behaviours: [{ id: 'G1-01', text: 'given x then y' }] },
  { key: 'g2', behaviours: [{ id: 'G2-01', text: 'given p then q' }] },
];

const SHA = 'abc1234';

function buildReply({ label }, over) {
  if (over[label] !== undefined) return over[label] === null ? undefined : over[label];
  const id = label.slice(label.indexOf(':') + 1);
  if (/^(impl|retry):/.test(label)) return { status: 'done', branch: `temper/e/${id}`, commit: SHA, summary: `did ${id}` };
  if (/^(check|recheck):/.test(label)) return { status: 'done', pass: true, problems: [] };
  if (label.startsWith('merge:')) return { status: 'merged', merged: [], gate_passed: true };
  if (label === 'checkpoint') return { status: 'done', gate_passed: true, gate_log: 'full.log', flows: [], gaps: [], commit: SHA };
  if (label === 'behaviour-spec') return { status: 'done', groups: GROUPS, commit: SHA };
  if (label.startsWith('acceptance:')) return { status: 'done', group: id, passing: [], failing: [], untestable: [], commit: SHA };
  if (label.startsWith('green:')) return { status: 'done', fixed: [], corrected: [], questions: [], still_failing: [] };
  return undefined;
}

const finding = (id, severity, lens = 'security') => ({
  id,
  lens,
  file: 'src/a.txt',
  line: 3,
  summary: `summary of ${id}`,
  input: 'in',
  wrong_result: 'out',
  severity,
  kind: 'fix',
});

function stabiliseReply({ label }, over) {
  if (over[label] !== undefined) return over[label] === null ? undefined : over[label];
  if (label.includes('review:')) return { status: 'done', findings: [] };
  if (label.includes('verify:')) return { status: 'done', real: true, severity: 'important', reason: 'ran it' };
  if (label.startsWith('fix:')) return { status: 'fixed', commit: SHA, note: 'done' };
  if (label.startsWith('regress:')) return { status: 'done', regressions: [] };
  return undefined;
}

const stabiliseBase = {
  ...common,
  lenses: ['security', 'test strength and docs'],
  severity_notes: 'A crash on user input is critical.',
  build_rule: 'Build only with make.',
  flaky: ['suite::timing'],
};

function publishReply({ label }, over) {
  if (over[label] !== undefined) return over[label] === null ? undefined : over[label];
  if (label === 'docs') return { status: 'done', commit: SHA, files: ['README.md'], summary: 'the docs' };
  if (label === 'evidence') return { status: 'done', script: 's.sh', checklist: 'c.md', commit: SHA };
  if (label === 'gate') return { status: 'done', passed: true, exit_status: 0, log_path: 'gate.log' };
  return undefined;
}

const scenario = (name, wf, args, reply, over = {}) => ({
  name,
  wf,
  args,
  respond: (call) => reply(call, over),
});

export const SCENARIOS = [
  scenario('build, every agent, a retry and two green rounds', 'build', buildBase, buildReply, {
    'check:a': { status: 'done', pass: false, problems: ['no test'] },
    'acceptance:g1': { status: 'done', group: 'g1', passing: [], failing: [{ id: 'G1-01', observed: 'nope' }], untestable: [], commit: SHA },
    'green:1': { status: 'done', fixed: [], corrected: [], questions: [], still_failing: ['G1-01'], flaky_reruns: [{ test: 'suite::timing', gate: 'quick' }] },
  }),
  scenario('build on an ssh host, no task checks, a resume', 'build', {
    ...buildBase,
    host: ssh,
    task_checks: 'none',
    done: ['a', 'c', 'checkpoint', 'behaviour-spec', 'acceptance:g1'],
    behaviour: GROUPS,
    answers: {},
    attempt: 3,
  }, buildReply),
  scenario('build, a blocked wave', 'build', buildBase, buildReply, {
    'impl:a': { status: 'blocked', branch: '', summary: '', question: 'Which one?' },
    'impl:c': null,
    'impl:b': { status: 'blocked', branch: '', summary: '', question: 'unused' },
  }),
  scenario('build, a merge conflict', 'build', buildBase, buildReply, {
    'merge:wave0': { status: 'blocked', merged: [], conflict: { task: 'a', files: ['src/a.txt'] }, gate_passed: false },
  }),
  scenario('build, a gate failing after a merge', 'build', buildBase, buildReply, {
    'merge:wave0': { status: 'merged', merged: ['a', 'c'], gate_passed: false },
  }),
  scenario('build, a checkpoint returning nothing', 'build', buildBase, buildReply, { checkpoint: null }),
  scenario('stabilise, a sweep with findings, a dead lens and a dead verifier', 'stabilise', {
    ...stabiliseBase,
    part: 'sweep',
    sweeps: 2,
  }, stabiliseReply, {
    'review:security': { status: 'done', findings: [finding('security-01', 'critical'), finding('security-02', 'important')] },
    'review:test strength and docs': null,
    'verify:security-02': null,
  }),
  scenario('stabilise, fixes on an ssh host, a second sweep and a severe fix', 'stabilise', {
    ...stabiliseBase,
    host: ssh,
    part: 'fix',
    gate_slots: 2,
    attempt: 2,
    selected: [finding('security-01', 'critical'), finding('security-02', 'minor')],
    answers: { 'security-01': 'Keep the old format.' },
  }, stabiliseReply, {
    'second:review:security': { status: 'done', findings: [finding('second:security-01', 'severe')] },
    'second:verify:second:security-01': { status: 'done', real: true, severity: 'severe', reason: 'ran it' },
  }),
  scenario('stabilise, a fix returning nothing', 'stabilise', {
    ...stabiliseBase,
    part: 'fix',
    sweeps: 1,
    selected: [finding('security-01', 'critical')],
  }, stabiliseReply, { 'fix:security-01': null }),
  scenario('publish, every agent', 'publish', {
    ...common,
    spec: 'docs/temper/e/spec.md',
    build_rule: 'Build only with make.',
    attempt: 1,
  }, publishReply),
  scenario('publish on an ssh host, a dead gate', 'publish', {
    ...common,
    host: ssh,
    spec: 'docs/temper/e/spec.md',
  }, publishReply, { docs: null }),
];

// What the snapshot keeps of a run: every agent call in order, the logs, the phases, the parallel
// batches, and the result with `cause` taken out of its blocked entries (`cause` is the one thing a
// result gains with no new field: the test pins that separately).
export function snapshotOf({ result, calls, logs, phases, batches }) {
  const noCause = JSON.parse(JSON.stringify(result));
  for (const b of Array.isArray(noCause.blocked) ? noCause.blocked : []) delete b.cause;
  return {
    calls: calls.map((c) => ({ prompt: c.prompt, opts: c.opts })),
    logs,
    phases,
    batches,
    result: noCause,
  };
}
