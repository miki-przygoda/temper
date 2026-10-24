// ---- build.js body: stage 3 ----
// The waves: per task implement -> check -> (one retry -> recheck), then one merge per wave.
// A null agent result is always blocked ("agent returned nothing"), never done.

const NOTHING = 'agent returned nothing';

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

function implement(task, retryReport) {
  const label = retryReport === undefined ? `impl:${task.id}` : `retry:${task.id}`;
  return agent(implementerPrompt(task, args, retryReport), { schema: IMPL_SCHEMA, label, phase: 'Waves' });
}

function check(task, impl, label) {
  return agent(checkerPrompt(task, impl, args), { schema: CHECK_SCHEMA, label, phase: 'Waves' });
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
    if (blocked.length > 0) return { status: 'blocked', wave, blocked, done_now: doneNow };

    const id = `merge:wave${wave}`;
    const merge = await agent(mergePrompt(passed, args), { schema: MERGE_SCHEMA, label: id, phase: 'Waves' });
    const mergeIssue = mergeBlocked(id, merge);
    if (mergeIssue) return { status: 'blocked', wave, blocked: [mergeIssue], done_now: doneNow };
    doneNow.push(...passed.map((t) => t.id));
  }
  return null;
}

const errors = validateBuildArgs(args);
if (errors.length > 0) return { status: 'invalid', errors };

const done_now = [];
const wavesBlocked = await runWaves(done_now);
if (wavesBlocked) return wavesBlocked;

// Task 6 continues here with the checkpoint, the behaviour spec, acceptance and green.
return { status: 'waves-done', done_now };
