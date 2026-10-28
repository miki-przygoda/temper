// ---- stage 4: stabilise ----
// part 'sweep' (4a): reviewers by lens, an adversarial verify per finding, a severity-ordered list.
// part 'fix' (4b): the selected fixes, a regression check per fix, the second sweep (sweeps 2), severe
// fixes with a regression check per fix, the stop.

// One sweep: a review per lens, then a verify per finding. Keeps the findings the verifier
// reproduced, with the verifier's severity, merged and ordered. A verdict of real:false counts as
// refuted. A verify that returns nothing (the agent died or was skipped) leaves its finding
// unverified (spec 3.9): kept with the reviewer's severity and marked `unverified: true`, never
// refuted or fixed. The unverified list is deduped within itself and against the verified one, so a
// bug that one lens's verifier reproduced is listed once, verified. An unverified finding above minor
// is blocked ("agent returned nothing"). A review that returns nothing leaves its lens unreviewed: it
// is blocked ("agent returned nothing"), never a lens with no findings.
// A finding needs an input and the wrong result it produces (spec 7 4a.1); one without is not accepted.
const hasInputAndWrongResult = (f) => !!f
  && typeof f.input === 'string' && f.input.trim() !== ''
  && typeof f.wrong_result === 'string' && f.wrong_result.trim() !== '';

async function sweepAndVerify(lenses, alreadyFixed, labelPrefix) {
  const second = labelPrefix !== '';
  const reviewPhase = second ? 'Second sweep' : 'Sweep';
  const verifyPhase = second ? 'Second sweep' : 'Verify';
  const perLens = await pipeline(
    lenses,
    (lens) => agent(reviewPrompt(lens, args, alreadyFixed), {
      label: `${labelPrefix}review:${lens}`,
      phase: reviewPhase,
      schema: FINDINGS_SCHEMA,
    }),
    async (review) => {
      if (!review) return null;
      const all = (Array.isArray(review.findings) ? review.findings : []).filter(hasInputAndWrongResult);
      // An id that doesn't match ID_RE never reaches a prompt, a label or a fix:<id> trailer, and
      // done_tasks.py would never read its trailer back (SECOND-SAFETY-4): that finding goes
      // unverified and its lens is blocked, so the list is not clean for it.
      const found = all.filter((f) => isId(f.id));
      const verdicts = await parallel(found.map((f) => () => agent(verifyPrompt(f, args), {
        label: `${labelPrefix}verify:${f.id}`,
        phase: verifyPhase,
        schema: VERDICT_SCHEMA,
      })));
      return { pairs: found.map((finding, i) => ({ finding, verdict: verdicts[i] })), badIds: found.length < all.length };
    },
  );
  const kept = [];
  const raw = [];
  const blocked = [];
  let refuted = 0;
  for (const [i, lensResult] of perLens.entries()) {
    if (!lensResult) {
      blocked.push({ id: `${labelPrefix}review:${lenses[i]}`, reason: 'agent returned nothing' });
      continue;
    }
    if (lensResult.badIds) {
      blocked.push({ id: `${labelPrefix}review:${lenses[i]}`, reason: 'a finding id did not match ID_RE; that finding was not verified' });
    }
    for (const { finding, verdict } of lensResult.pairs) {
      if (!verdict) {
        raw.push(finding);
        continue;
      }
      if (verdict.real !== true) {
        refuted += 1;
        continue;
      }
      kept.push({ ...finding, severity: verdict.severity ?? finding.severity });
    }
  }
  const findings = sortFindings(dedupeFindings(kept));
  const unverified = sortFindings(dedupeAgainst(dedupeFindings(raw), findings)).map((f) => ({ ...f, unverified: true }));
  for (const f of unverified) {
    if (f.severity !== 'minor') blocked.push({ id: `${labelPrefix}verify:${f.id}`, reason: 'agent returned nothing' });
  }
  return { findings, refuted, blocked, unverified };
}

const errors = validateStabiliseArgs(args);
if (errors.length > 0) return { status: 'invalid', errors };

if (args.part === 'sweep') {
  phase('Sweep');
  const { findings, refuted, blocked, unverified } = await sweepAndVerify(lensesOr(args.lenses), [], '');
  return { status: 'list', findings, unverified, refuted, blocked };
}

// part 'fix' (4b): careful fixes one at a time in severity order, one more sweep, then the stop.

// The second sweep's findings from an earlier fix run, saved by the head (args.second_sweep_findings).
// When given, the second sweep already ran: never sweep again (spec 7, 1, 3.5). A fix:second-* trailer
// without them means it ran but its findings are unknown: never guess or sweep again; the committed
// second-sweep fixes still get the regression check, then hand over.
const savedSecond = Array.isArray(args.second_sweep_findings) ? args.second_sweep_findings : null;
const lostSecondIds = savedSecond ? [] : args.done.filter((d) => d.startsWith('fix:second-')).map((d) => d.slice('fix:'.length));

// One agent per finding, one after another, skipping fixes whose trailer is already in done.
// A null result (the agent died or was skipped) counts as blocked. Returns the ids it handled.
async function fixLoop(findings, out) {
  const handled = [];
  for (const f of sortFindings(findings)) {
    if (args.done.includes(`fix:${f.id}`)) continue;
    const r = await agent(fixPrompt(f, args), { label: `fix:${f.id}`, phase: 'Fix', schema: FIX_SCHEMA });
    // spec 3.1: the sha each fix agent reported, never an empty one.
    if (r && isNonEmptyString(r.commit)) out.commits[`fix:${f.id}`] = r.commit;
    // spec 3.6: the listed flaky tests it reran once and saw pass.
    out.flaky_reruns.push(...flakyRerunsOf(`fix:${f.id}`, r));
    if (!r) out.blocked.push({ id: f.id, reason: 'agent returned nothing' });
    else if (r.status === 'fixed') { out.fixed.push(f.id); handled.push(f.id); }
    else if (r.status === 'reverted') out.reverted.push(f.id);
    else if (r.status === 'contract') out.contract_items.push(f.id);
    else out.blocked.push({ id: f.id, reason: r.note || 'blocked' });
  }
  return handled;
}

// Ids whose fix:<id> trailer is already on the branch (fixed in an earlier run).
const doneIds = (findings) => findings.filter((f) => args.done.includes(`fix:${f.id}`)).map((f) => f.id);

const out = { fixed: [], reverted: [], contract_items: [], blocked: [], commits: {}, flaky_reruns: [] };

// spec 3.4: every selected finding is fixed, whatever its severity; fixLoop's severity order puts
// minors last. Only the second sweep's non-severe findings, which nobody selected, go to the open items.
const toFix = args.selected;

// spec 3.3: one regression agent per fix, in parallel, labelled regress:fix:<id>. The prompt carries
// args.attempt, so a resume that bumps it reruns these live. An agent that returns nothing blocks its fix.
async function regressEach(ids, phaseTitle = 'Fix') {
  const results = await parallel(ids.map((id) => () => agent(regressPrompt(id, args), {
    label: `regress:fix:${id}`,
    phase: phaseTitle,
    schema: REGRESS_SCHEMA,
  })));
  const regressions = [];
  const blocked = [];
  for (const [i, r] of results.entries()) {
    if (!r) blocked.push({ id: `regress:fix:${ids[i]}`, reason: 'agent returned nothing' });
    else if (Array.isArray(r.regressions)) regressions.push(...r.regressions);
  }
  return { regressions, blocked };
}

phase('Fix');
const fixedFirst = await fixLoop(toFix, out);

// Every part-fix run checks every first-wave fix on the branch: those done in an earlier run and those
// made now. Reverted and contract items left no commit, and blocked ones landed nothing. It runs even
// when the fix loop was not clean, so a landed fix is never left unchecked because a later one blocked.
const landed = [...doneIds(toFix), ...fixedFirst];
const firstCheck = await regressEach(landed);
out.blocked.push(...firstCheck.blocked);
const firstRegressions = firstCheck.regressions;

// A regression hands over first; then a blocked fix or regression agent stops part fix here: the
// second sweep never runs on a branch missing a selected fix (SECOND-CONTROL-FLOW-4).
if (out.blocked.length > 0 || firstRegressions.length > 0) {
  return {
    status: firstRegressions.length > 0 ? 'handover' : 'blocked',
    fixed: out.fixed,
    reverted: out.reverted,
    contract_items: out.contract_items,
    blocked: out.blocked,
    open_items: [],
    regressions: firstRegressions,
    commits: out.commits,
    flaky_reruns: out.flaky_reruns,
  };
}

phase('Second sweep');
if (lostSecondIds.length > 0) {
  out.blocked.push({ id: 'second-sweep', reason: 'done but args.second_sweep_findings missing' });
  const r = await regressEach(lostSecondIds, 'Second sweep');
  out.blocked.push(...r.blocked);
  return {
    status: 'handover',
    fixed: out.fixed,
    reverted: out.reverted,
    contract_items: out.contract_items,
    blocked: out.blocked,
    open_items: [],
    regressions: r.regressions,
    commits: out.commits,
    flaky_reruns: out.flaky_reruns,
  };
}

// One-sweep mode (spec 3.3): stable after a clean regression check. A saved empty second sweep with no
// sweeps field is how a v1 head asked for one sweep, and keeps that meaning.
if (sweepsOf(args) === 1 || (savedSecond && savedSecond.length === 0 && args.sweeps === undefined)) {
  return {
    status: 'stable',
    fixed: out.fixed,
    reverted: out.reverted,
    contract_items: out.contract_items,
    blocked: out.blocked,
    open_items: [],
    second_sweep: null,
    regressions: [],
    commits: out.commits,
    flaky_reruns: out.flaky_reruns,
  };
}

// Saved findings stand in for the sweep; their done severe fixes still get the regression check below.
// Unverified ones are saved with them, marked, and stay unverified on resume (spec 3.9): never fixed,
// and one above minor still blocks, so the result can't be stable.
let secondFindings;
let unverified;
let unreviewed = false;
if (savedSecond) {
  secondFindings = sortFindings(savedSecond.filter((f) => f.unverified !== true));
  unverified = sortFindings(savedSecond.filter((f) => f.unverified === true));
  const unclean = unverified.filter((f) => f.severity !== 'minor');
  out.blocked.push(...unclean.map((f) => ({ id: `second:verify:${f.id}`, reason: 'agent returned nothing' })));
  unreviewed = unclean.length > 0;
} else {
  const alreadyFixed = [...doneIds(toFix), ...out.fixed];
  const second = await sweepAndVerify(lensesOr(args.lenses), alreadyFixed, 'second:');
  secondFindings = second.findings;
  unverified = second.unverified;
  // A lens the second sweep never reviewed, or an unverified finding above minor, means the stage is
  // not done: hand over, never 'stable'.
  out.blocked.push(...second.blocked);
  unreviewed = second.blocked.length > 0;
}
const severe = secondFindings.filter((f) => f.severity === 'severe');
const others = secondFindings.filter((f) => f.severity !== 'severe');

let regressions = [];
if (severe.length > 0) {
  const fixedNow = await fixLoop(severe, out);
  const toCheck = [...doneIds(severe), ...fixedNow];
  const r = await regressEach(toCheck, 'Second sweep');
  out.blocked.push(...r.blocked);
  regressions = r.regressions;
}

// There is never a third sweep: the run ends here either way.
return {
  status: severe.length > 0 || unreviewed ? 'handover' : 'stable',
  fixed: out.fixed,
  reverted: out.reverted,
  contract_items: out.contract_items,
  blocked: out.blocked,
  open_items: [...others, ...unverified],
  second_sweep: { severe: severe.length, others: others.length },
  second_sweep_findings: [...secondFindings, ...unverified],
  unverified,
  regressions,
  commits: out.commits,
  flaky_reruns: out.flaky_reruns,
};
