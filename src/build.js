// ---- build.js body: stage 3 ----
// The waves: per task implement -> check -> (one retry -> recheck), then one merge per wave.
// A null agent result is always blocked ("agent returned nothing"), never done.

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

// owns widening (opt-in, owns_widen). widened maps a task id to the paths it widened, in this run or,
// from args.owns_widened, an earlier launch: a task gets one widening, however often it is relaunched.
// owns_widened lists this run's, and goes on every result after validation while widening is on.
const widened = new Map();
const owns_widened = [];
const widenExtra = () => (isWidenOn(args) ? { owns_widened } : {});

// An implementer's own cause only under impl_cause, and only a listed one: agent text is data. `owns
// symlink:` is the fixed question the widening prompts make it send when a path doesn't resolve to itself.
function implCause(impl) {
  const q = impl.question;
  if (isWidenOn(args) && typeof q === 'string' && q.startsWith('owns symlink:')) return 'owns-refused';
  return args.impl_cause === true && IMPL_CAUSES.includes(impl.cause) ? impl.cause : undefined;
}

// Turns an implementer result into a blocked entry, or null when it is done.
function implBlocked(task, impl) {
  if (impl === null || impl === undefined) return nothingEntry(task.id);
  if (impl.status !== 'done') {
    return blockedEntry(task.id, typeof impl.question === 'string' && impl.question !== '' ? impl.question : `implementer returned status ${impl.status}`, implCause(impl));
  }
  return null;
}

async function implement(task, retryReport) {
  const label = retryReport === undefined ? `impl:${task.id}` : `retry:${task.id}`;
  const r = await agent(implementerPrompt(task, args, retryReport), { schema: implSchemaOf(args), label, phase: 'Waves' });
  recordReruns(label, r);
  return r;
}

// Settles an implementer result into {task, impl, blocked}. Only with widening on and status needs_owns
// does anything happen here: a refusal blocks; a grant widens this run's copy of the task (args stay as
// given), logs it, and runs the implementer once more as widen:<id>. The check and the grant sit in one
// synchronous stretch, so two tasks of a wave can't both be granted a path.
async function settleImpl(task, impl, retryReport) {
  if (!isWidenOn(args) || !impl || impl.status !== 'needs_owns') return { task, impl, blocked: implBlocked(task, impl) };
  if (widened.has(task.id)) {
    return { task, impl, blocked: blockedEntry(task.id, 'a second needs_owns: this task already widened its owns once', 'owns') };
  }
  const decision = widenDecision(task, impl.owns_add, args, widened);
  if (decision.refused !== undefined) {
    log(`owns_refused:${task.id}`);
    return { task, impl, blocked: blockedEntry(task.id, `owns widening refused: ${decision.refused}`, 'owns-refused') };
  }
  widened.set(task.id, decision.paths);
  owns_widened.push({ id: task.id, paths: decision.paths, why: decision.why });
  log(`owns_widened:${task.id}:${decision.paths.join(',')}`);
  const wider = { ...task, owns: [...task.owns, ...decision.paths] };
  const label = `widen:${task.id}`;
  const again = await agent(implementerPrompt(wider, args, retryReport, decision.paths), { schema: implSchemaOf(args), label, phase: 'Waves' });
  recordReruns(label, again);
  if (again && again.status === 'needs_owns') {
    return { task: wider, impl: again, blocked: blockedEntry(task.id, 'a second needs_owns: this task already widened its owns once', 'owns') };
  }
  return { task: wider, impl: again, blocked: implBlocked(wider, again) };
}

async function check(task, impl, label) {
  const r = await agent(checkerPrompt(task, impl, args, label), { schema: CHECK_SCHEMA, label, phase: 'Waves' });
  recordReruns(label, r);
  return r;
}

function problemsOf(result) {
  return Array.isArray(result.problems) ? result.problems : [];
}

// Pipeline stages. Each passes on {task, impl?, check?, blocked?}; a blocked state skips the later stages.
async function implStage(task) {
  return settleImpl(task, await implement(task));
}

// A checker that returned blocked (its throwaway worktree could not be used, for one) never
// checked: the task blocks under the checker's own id, with its reason (test-strength-and-docs-01).
function checkBlocked(label, result) {
  const reason = phaseBlockedReason(result);
  return reason === null ? null : blockedEntry(label, reason);
}

async function checkStage(state) {
  if (state.blocked) return state;
  const label = `check:${state.task.id}`;
  const result = await check(state.task, state.impl, label);
  if (result === null || result === undefined) return { ...state, blocked: nothingEntry(state.task.id) };
  return { ...state, check: result, blocked: checkBlocked(label, result) };
}

async function retryStage(state) {
  if (state.blocked || state.check.pass === true) return state;
  const report = problemsOf(state.check).join('\n');
  const { task, impl, blocked } = await settleImpl(state.task, await implement(state.task, report), report);
  if (blocked) return { ...state, task, impl, blocked };
  const label = `recheck:${task.id}`;
  const result = await check(task, impl, label);
  if (result === null || result === undefined) return { ...state, task, impl, blocked: nothingEntry(task.id) };
  const recheckBlocked = checkBlocked(label, result);
  if (recheckBlocked) return { ...state, task, impl, check: result, blocked: recheckBlocked };
  if (result.pass !== true) {
    return { ...state, task, impl, check: result, blocked: blockedEntry(task.id, `failed the check twice: ${problemsOf(result).join('; ')}`) };
  }
  return { ...state, task, impl, check: result };
}

// The cause is read from the fields the merge prompt asks for. Its prompt sends a failed gate back as
// status blocked with gate_passed false, so a blocked merge with no conflict counts as gate-after-merge;
// that also covers a merge agent blocked for another reason, whose result looks the same.
function mergeBlocked(id, merge) {
  if (merge === null || merge === undefined) return nothingEntry(id);
  const refused = Array.isArray(merge.owns_refused) ? merge.owns_refused.filter(isObject) : [];
  if (refused.length > 0) {
    return blockedEntry(id, `widened path refused at merge: ${refused.map((r) => `task ${r.task}: ${r.path}: ${r.why}`).join('; ')}`, 'owns-refused');
  }
  if (merge.status !== 'merged') {
    const c = merge.conflict;
    if (c && typeof c === 'object') {
      return blockedEntry(id, `merge conflict on task ${c.task}: ${Array.isArray(c.files) ? c.files.join(', ') : ''}`, 'merge-conflict');
    }
    return blockedEntry(id, `merge returned status ${merge.status}`, merge.gate_passed === false ? 'gate-after-merge' : undefined);
  }
  if (merge.gate_passed !== true) return blockedEntry(id, 'the quick gate failed after a merge', 'gate-after-merge');
  return null;
}

// Whether two spellings name one commit: agent text is checked as a sha first, and a short args.tip
// matches the full sha the agent reports.
const sameSha = (a, b) => isSha(a) && isSha(b) && (a.startsWith(b) || b.startsWith(a));

// The tip check (baseline: launch). Returns a blocked build result, or null when the tip is green.
async function runBaseline(doneNow) {
  const r = await agent(baselinePrompt(args), { schema: BASELINE_SCHEMA, label: 'baseline', phase: 'Waves' });
  recordReruns('baseline', r);
  if (r === null || r === undefined) return phaseBlocked('baseline', NOTHING, doneNow, 'nothing');
  const reason = phaseBlockedReason(r);
  if (reason !== null) return phaseBlocked('baseline', reason, doneNow);
  if (!sameSha(r.tip, args.tip)) {
    return phaseBlocked('baseline', `the branch tip is ${quoted(r.tip)}, and this launch was for ${args.tip}`, doneNow, 'tip-mismatch');
  }
  if (r.passed !== true || r.exit_status !== 0) {
    return phaseBlocked('baseline', `the gate failed on tip ${args.tip} (exit status ${r.exit_status}): failed ${arr(r.failed).join(', ') || 'none named'}; log ${r.log_path}`, doneNow, 'base-red');
  }
  log(`baseline: ${args.tip} is green`);
  return null;
}

const stoppedAt = (at, doneNow) => ({ status: 'stopped', at, done_now: doneNow, commits, flaky_reruns, ...widenExtra() });

// Runs every wave in order. Returns a blocked or stopped result, or null when all waves merged.
// A blocked wave still merges the tasks that passed and lists them in done_now (A9).
async function runWaves(doneNow) {
  phase('Waves');
  let baselineDue = args.baseline === 'launch';
  for (const { wave, tasks } of wavesOf(args.tasks)) {
    const todo = pending(tasks, args.done);
    if (todo.length === 0) {
      log(`wave ${wave}: every task already done`);
      if (args.stop_after === `wave:${wave}`) return stoppedAt(args.stop_after, doneNow);
      continue;
    }
    if (baselineDue) {
      baselineDue = false;
      const red = await runBaseline(doneNow);
      if (red) return red;
    }
    log(`wave ${wave}: ${todo.map((t) => t.id).join(', ')}`);
    const stages = args.task_checks === 'none' ? [implStage] : [implStage, checkStage, retryStage];
    // One pipeline per chunk of gateSlotsOf(args), as regressEach in stabilise.js; with no gate_slots
    // the size is Infinity and the whole wave is one pipeline. One merge per wave either way.
    const size = gateSlotsOf(args);
    const states = [];
    for (let start = 0; start < todo.length; start += size) {
      states.push(...await pipeline(todo.slice(start, start + size), ...stages));
    }
    const blocked = [];
    const passed = [];
    states.forEach((s, i) => {
      if (s === null || s === undefined) blocked.push(nothingEntry(todo[i].id));
      else if (s.blocked) blocked.push(s.blocked);
      else passed.push(s.task);
    });
    if (passed.length > 0) {
      const id = `merge:wave${wave}`;
      const widenedHere = passed.filter((t) => widened.has(t.id)).map((t) => ({ task: t, paths: widened.get(t.id) }));
      const merge = await agent(mergePrompt(passed, args, widenedHere), { schema: widenedHere.length > 0 ? MERGE_SCHEMA_WIDEN : MERGE_SCHEMA, label: id, phase: 'Waves' });
      recordReruns(id, merge);
      const mergeIssue = mergeBlocked(id, merge);
      if (mergeIssue) blocked.push(mergeIssue);
      else doneNow.push(...passed.map((t) => t.id));
    }
    if (blocked.length > 0) return { status: 'blocked', wave, blocked, done_now: doneNow, commits, flaky_reruns, ...widenExtra() };
    if (args.stop_after === `wave:${wave}`) return stoppedAt(args.stop_after, doneNow);
  }
  return null;
}

// ---- after the waves: checkpoint, behaviour spec, acceptance groups, to-green ----
// Each phase id ('checkpoint', 'behaviour-spec', 'acceptance:<key>', 'green:<n>') in args.done is skipped (A6).
// A null phase result is blocked with "agent returned nothing", like a task.

const MAX_GREEN_ROUNDS = 2;
const isDone = (id) => args.done.includes(id);
const arr = (v) => (Array.isArray(v) ? v : []);

function phaseBlocked(id, reason, doneNow, cause) {
  return { status: 'blocked', blocked: [blockedEntry(id, reason, cause)], done_now: doneNow, commits, flaky_reruns, ...widenExtra() };
}

// spec "Phase results", the order of checks for a non-null phase result r: the agent's own blocked
// status (its sha commit still recorded, and no second not-a-sha entry), then a reported non-sha
// commit. Returns the blocked build result, or null to go on.
function phaseIssue(id, r, doneNow) {
  const reason = phaseBlockedReason(r);
  if (reason !== null) {
    recordCommit(id, r);
    return phaseBlocked(id, reason, doneNow);
  }
  if (recordCommit(id, r)) return phaseBlocked(id, NOT_A_SHA, doneNow);
  return null;
}

// Returns {blocked} or {checkpoint}; checkpoint is null when it was done in an earlier run.
async function runCheckpoint(doneNow) {
  if (isDone('checkpoint')) {
    log('checkpoint: already done');
    return { checkpoint: null };
  }
  phase('Checkpoint');
  const cp = await agent(checkpointPrompt(args), { schema: CHECKPOINT_SCHEMA, label: 'checkpoint', phase: 'Checkpoint' });
  if (cp === null || cp === undefined) return { blocked: phaseBlocked('checkpoint', NOTHING, doneNow, 'nothing') };
  const cpIssue = phaseIssue('checkpoint', cp, doneNow);
  if (cpIssue) return { blocked: cpIssue };
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
  if (b === null || b === undefined) return { blocked: phaseBlocked('behaviour-spec', NOTHING, doneNow, 'nothing') };
  const bIssue = phaseIssue('behaviour-spec', b, doneNow);
  if (bIssue) return { blocked: bIssue };
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
    if (r === null || r === undefined) return { blocked: phaseBlocked(id, NOTHING, doneNow, 'nothing') };
    const issue = phaseIssue(id, r, doneNow);
    if (issue) return { blocked: issue };
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
    if (g === null || g === undefined) return { blocked: phaseBlocked(id, NOTHING, doneNow, 'nothing') };
    recordReruns(id, g);
    const issue = phaseIssue(id, g, doneNow);
    if (issue) return { blocked: issue };
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

if (isWidenOn(args)) {
  for (const { id, paths } of args.owns_widened ?? []) widened.set(id, [...(widened.get(id) ?? []), ...paths]);
}

const done_now = [];
const wavesEnded = await runWaves(done_now);
if (wavesEnded) return wavesEnded;
if (args.stop_after === 'waves') return stoppedAt('waves', done_now);

const cp = await runCheckpoint(done_now);
if (cp.blocked) return cp.blocked;
if (args.stop_after === 'checkpoint') return stoppedAt('checkpoint', done_now);

const behaviourSpec = await runBehaviourSpec(done_now);
if (behaviourSpec.blocked) return behaviourSpec.blocked;
if (args.stop_after === 'behaviour-spec') return stoppedAt('behaviour-spec', done_now);

const acc = await runAcceptance(behaviourSpec.groups, done_now);
if (acc.blocked) return acc.blocked;
if (args.stop_after === 'acceptance') return stoppedAt('acceptance', done_now);

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
  ...widenExtra(),
};
