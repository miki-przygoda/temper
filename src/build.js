// ---- build.js body: stage 3 ----
// The waves: per task implement -> check -> (one retry -> recheck), then one merge per wave.
// A null agent result is always blocked ("agent returned nothing"), never done.

const NOTHING = 'agent returned nothing';

// spec 3.1: {[phaseId]: sha} for every phase agent that reported a commit; never an empty sha.
// It goes on every result after validation, the blocked ones included. Only a hex sha goes in
// (spec 8): recordCommit returns true for any other reported value, and the phase blocks.
const commits = {};
function recordCommit(id, result) {
  return recordSha(commits, id, result);
}

// spec 3.6: [{id, test, gate}], every listed flaky test an agent reran once and saw pass. Like
// commits, it goes on every result after validation.
const flaky_reruns = [];
function recordReruns(id, result) {
  flaky_reruns.push(...flakyRerunsOf(id, result));
}

function blockedEntry(id, reason) {
  return { id, reason };
}

// Turns an implementer result into a blocked entry, or null when it is done.
function implBlocked(task, impl) {
  if (impl === null || impl === undefined) return blockedEntry(task.id, NOTHING);
  if (impl.status !== 'done') {
    return blockedEntry(task.id, typeof impl.question === 'string' && impl.question !== '' ? impl.question : `implementer returned status ${impl.status}`);
  }
  return null;
}

async function implement(task, retryReport) {
  const label = retryReport === undefined ? `impl:${task.id}` : `retry:${task.id}`;
  const r = await agent(implementerPrompt(task, args, retryReport), { schema: IMPL_SCHEMA, label, phase: 'Waves' });
  recordReruns(label, r);
  return r;
}

async function check(task, impl, label) {
  const r = await agent(checkerPrompt(task, impl, args), { schema: CHECK_SCHEMA, label, phase: 'Waves' });
  recordReruns(label, r);
  return r;
}

function problemsOf(result) {
  return Array.isArray(result.problems) ? result.problems : [];
}

// Pipeline stages. Each passes on {task, impl?, check?, blocked?}; a blocked state skips the later stages.
async function implStage(task) {
  const impl = await implement(task);
  return { task, impl, blocked: implBlocked(task, impl) };
}

async function checkStage(state) {
  if (state.blocked) return state;
  const result = await check(state.task, state.impl, `check:${state.task.id}`);
  if (result === null || result === undefined) return { ...state, blocked: blockedEntry(state.task.id, NOTHING) };
  return { ...state, check: result };
}

async function retryStage(state) {
  if (state.blocked || state.check.pass === true) return state;
  const { task } = state;
  const impl = await implement(task, problemsOf(state.check).join('\n'));
  const blocked = implBlocked(task, impl);
  if (blocked) return { ...state, impl, blocked };
  const result = await check(task, impl, `recheck:${task.id}`);
  if (result === null || result === undefined) return { ...state, impl, blocked: blockedEntry(task.id, NOTHING) };
  if (result.pass !== true) {
    return { ...state, impl, check: result, blocked: blockedEntry(task.id, `failed the check twice: ${problemsOf(result).join('; ')}`) };
  }
  return { ...state, impl, check: result };
}

function mergeBlocked(id, merge) {
  if (merge === null || merge === undefined) return blockedEntry(id, NOTHING);
  if (merge.status !== 'merged') {
    const c = merge.conflict;
    const reason = c && typeof c === 'object'
      ? `merge conflict on task ${c.task}: ${Array.isArray(c.files) ? c.files.join(', ') : ''}`
      : `merge returned status ${merge.status}`;
    return blockedEntry(id, reason);
  }
  if (merge.gate_passed !== true) return blockedEntry(id, 'the quick gate failed after a merge');
  return null;
}

// Runs every wave in order. Returns a blocked result, or null when all waves merged.
// A blocked wave still merges the tasks that passed and lists them in done_now (A9).
async function runWaves(doneNow) {
  phase('Waves');
  for (const { wave, tasks } of wavesOf(args.tasks)) {
    const todo = pending(tasks, args.done);
    if (todo.length === 0) {
      log(`wave ${wave}: every task already done`);
      continue;
    }
    log(`wave ${wave}: ${todo.map((t) => t.id).join(', ')}`);
    const states = await pipeline(todo, implStage, checkStage, retryStage);
    const blocked = [];
    const passed = [];
    states.forEach((s, i) => {
      if (s === null || s === undefined) blocked.push(blockedEntry(todo[i].id, NOTHING));
      else if (s.blocked) blocked.push(s.blocked);
      else passed.push(s.task);
    });
    if (passed.length > 0) {
      const id = `merge:wave${wave}`;
      const merge = await agent(mergePrompt(passed, args), { schema: MERGE_SCHEMA, label: id, phase: 'Waves' });
      recordReruns(id, merge);
      const mergeIssue = mergeBlocked(id, merge);
      if (mergeIssue) blocked.push(mergeIssue);
      else doneNow.push(...passed.map((t) => t.id));
    }
    if (blocked.length > 0) return { status: 'blocked', wave, blocked, done_now: doneNow, commits, flaky_reruns };
  }
  return null;
}

// ---- after the waves: checkpoint, behaviour spec, acceptance groups, to-green ----
// Each phase id ('checkpoint', 'behaviour-spec', 'acceptance:<key>', 'green:<n>') in args.done is skipped (A6).
// A null phase result is blocked with "agent returned nothing", like a task.

const MAX_GREEN_ROUNDS = 2;
const isDone = (id) => args.done.includes(id);
const arr = (v) => (Array.isArray(v) ? v : []);

function phaseBlocked(id, reason, doneNow) {
  return { status: 'blocked', blocked: [blockedEntry(id, reason)], done_now: doneNow, commits, flaky_reruns };
}

// Returns {blocked} or {checkpoint}; checkpoint is null when it was done in an earlier run.
async function runCheckpoint(doneNow) {
  if (isDone('checkpoint')) {
    log('checkpoint: already done');
    return { checkpoint: null };
  }
  phase('Checkpoint');
  const cp = await agent(checkpointPrompt(args), { schema: CHECKPOINT_SCHEMA, label: 'checkpoint', phase: 'Checkpoint' });
  if (cp === null || cp === undefined) return { blocked: phaseBlocked('checkpoint', NOTHING, doneNow) };
  if (recordCommit('checkpoint', cp)) return { blocked: phaseBlocked('checkpoint', NOT_A_SHA, doneNow) };
  if (cp.gate_passed !== true) return { blocked: phaseBlocked('checkpoint', 'full gate failed: ' + cp.gate_log, doneNow) };
  return { checkpoint: cp };
}

// Returns {blocked} or {groups}: the behaviour spec's [{key, behaviours}].
async function runBehaviourSpec(doneNow) {
  if (isDone('behaviour-spec')) {
    if (!Array.isArray(args.behaviour)) {
      return { blocked: phaseBlocked('behaviour-spec', 'done but args.behaviour missing', doneNow) };
    }
    log('behaviour-spec: already done, using args.behaviour');
    return { groups: args.behaviour };
  }
  phase('Behaviour');
  const b = await agent(behaviourSpecPrompt(args), { schema: BEHAVIOUR_SCHEMA, label: 'behaviour-spec', phase: 'Behaviour' });
  if (b === null || b === undefined) return { blocked: phaseBlocked('behaviour-spec', NOTHING, doneNow) };
  if (recordCommit('behaviour-spec', b)) return { blocked: phaseBlocked('behaviour-spec', NOT_A_SHA, doneNow) };
  return { groups: arr(b.groups) };
}

// One agent per behaviour group, in order. Returns {blocked} or {passing, failing, untestable}
// over the groups run now; failing is [{id, observed}]. earlier is true when a group was done in an earlier run.
async function runAcceptance(groups, doneNow) {
  const out = { passing: 0, failing: [], untestable: [], earlier: false };
  for (const group of args.behaviour_groups) {
    const id = `acceptance:${group.key}`;
    if (isDone(id)) {
      log(`${id}: already done`);
      out.earlier = true;
      continue;
    }
    const spec = groups.find((g) => g && g.key === group.key);
    const behaviours = spec ? arr(spec.behaviours) : [];
    const r = await agent(acceptancePrompt(group, behaviours, args), { schema: ACCEPTANCE_SCHEMA, label: id, phase: 'Behaviour' });
    if (r === null || r === undefined) return { blocked: phaseBlocked(id, NOTHING, doneNow) };
    if (recordCommit(id, r)) return { blocked: phaseBlocked(id, NOT_A_SHA, doneNow) };
    out.passing += arr(r.passing).length;
    out.failing.push(...arr(r.failing));
    out.untestable.push(...arr(r.untestable));
  }
  return out;
}

// At most two rounds while anything still fails. An id that became a question is not retried.
// markedToo: an earlier run's acceptance failures are unknown here, so until a round runs, the
// round also takes the tests still marked acceptance-failing (CONTROL-FLOW-1).
// Returns {blocked} or {rounds, fixed, corrected, questions}.
async function runGreen(failing, markedToo, doneNow) {
  const out = { rounds: 0, fixed: [], corrected: [], questions: [] };
  let left = failing;
  for (let r = 1; r <= MAX_GREEN_ROUNDS && (left.length > 0 || markedToo); r++) {
    if (r === 1) phase('Green');
    const id = `green:${r}`;
    if (isDone(id)) {
      log(`${id}: already done`);
      continue;
    }
    const g = await agent(greenPrompt(left, r, args, markedToo), { schema: GREEN_SCHEMA, label: id, phase: 'Green' });
    if (g === null || g === undefined) return { blocked: phaseBlocked(id, NOTHING, doneNow) };
    recordReruns(id, g);
    if (recordCommit(id, g)) return { blocked: phaseBlocked(id, NOT_A_SHA, doneNow) };
    markedToo = false;
    out.rounds = r;
    out.fixed.push(...arr(g.fixed));
    out.corrected.push(...arr(g.corrected));
    out.questions.push(...arr(g.questions));
    const asked = new Set(out.questions.map((q) => q.id));
    const prev = left;
    left = arr(g.still_failing)
      .filter((fid) => !asked.has(fid))
      .map((fid) => prev.find((f) => f.id === fid) || { id: fid, observed: 'still failing' });
  }
  for (const f of left) out.questions.push({ id: f.id, question: `still failing after ${MAX_GREEN_ROUNDS} rounds` });
  return out;
}

const errors = validateBuildArgs(args);
if (errors.length > 0) return { status: 'invalid', errors };

const done_now = [];
const wavesBlocked = await runWaves(done_now);
if (wavesBlocked) return wavesBlocked;

const cp = await runCheckpoint(done_now);
if (cp.blocked) return cp.blocked;

const behaviourSpec = await runBehaviourSpec(done_now);
if (behaviourSpec.blocked) return behaviourSpec.blocked;

const acc = await runAcceptance(behaviourSpec.groups, done_now);
if (acc.blocked) return acc.blocked;

const green = await runGreen(acc.failing, acc.earlier, done_now);
if (green.blocked) return green.blocked;

return {
  status: 'mvp',
  checkpoint: cp.checkpoint,
  acceptance: { passing: acc.passing, failing: acc.failing.map((f) => f.id), untestable: acc.untestable },
  green: { rounds: green.rounds, fixed: green.fixed, corrected: green.corrected },
  questions: green.questions,
  blocked: [],
  done_now,
  commits,
  flaky_reruns,
};
