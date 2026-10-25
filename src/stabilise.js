// ---- stage 4: stabilise ----
// part 'sweep' (4a): reviewers by lens, an adversarial verify per finding, a severity-ordered list.
// part 'fix' (4b): the selected fixes, the second sweep, severe fixes with a regression check, the stop.

// One sweep: a review per lens, then a verify per finding. Keeps the findings the verifier
// reproduced, with the verifier's severity, merged and ordered. A verdict of real:false or
// null (the agent died or was skipped) counts as refuted. A review that returns nothing leaves its
// lens unreviewed: it is blocked ("agent returned nothing"), never a lens with no findings.
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
      if (!verdict || verdict.real !== true) {
        refuted += 1;
        continue;
      }
      kept.push({ ...finding, severity: verdict.severity ?? finding.severity });
    }
  }
  return { findings: sortFindings(dedupeFindings(kept)), refuted, blocked };
}

const errors = validateStabiliseArgs(args);
if (errors.length > 0) return { status: 'invalid', errors };

if (args.part === 'sweep') {
  phase('Sweep');
  const { findings, refuted, blocked } = await sweepAndVerify(lensesOr(args.lenses), [], '');
  return { status: 'list', findings, refuted, blocked };
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

const out = { fixed: [], reverted: [], contract_items: [], blocked: [] };

// A Minor finding is never fixed in the code; it goes to the open items (spec 7.1).
const selectedMinor = args.selected.filter((f) => f.severity === 'minor');
const toFix = args.selected.filter((f) => f.severity !== 'minor');

phase('Fix');
const fixedFirst = await fixLoop(toFix, out);

// A resume after a block (an earlier run committed some of these fixes, or the head answered one):
// the fixes made now get the regression check over their diffs before the second sweep.
const answered = (f) => isObject(args.answers) && typeof args.answers[f.id] === 'string';
const resumed = toFix.some((f) => args.done.includes(`fix:${f.id}`) || answered(f));
const firstRegressions = [];
if (resumed && fixedFirst.length > 0) {
  const r = await agent(regressPrompt(fixedFirst, args), { label: 'regress:fix', phase: 'Fix', schema: REGRESS_SCHEMA });
  if (!r) out.blocked.push({ id: 'regress:fix', reason: 'agent returned nothing' });
  else if (Array.isArray(r.regressions)) firstRegressions.push(...r.regressions);
}

// A blocked first-sweep fix, or a regression from one, stops part fix here: the second sweep
// never runs on a branch missing a selected fix (SECOND-CONTROL-FLOW-4).
if (out.blocked.length > 0 || firstRegressions.length > 0) {
  return {
    status: firstRegressions.length > 0 ? 'handover' : 'blocked',
    fixed: out.fixed,
    reverted: out.reverted,
    contract_items: out.contract_items,
    blocked: out.blocked,
    open_items: selectedMinor,
    regressions: firstRegressions,
  };
}

phase('Second sweep');
if (lostSecondIds.length > 0) {
  out.blocked.push({ id: 'second-sweep', reason: 'done but args.second_sweep_findings missing' });
  const r = await agent(regressPrompt(lostSecondIds, args), {
    label: 'regress',
    phase: 'Second sweep',
    schema: REGRESS_SCHEMA,
  });
  return {
    status: 'handover',
    fixed: out.fixed,
    reverted: out.reverted,
    contract_items: out.contract_items,
    blocked: out.blocked,
    open_items: selectedMinor,
    regressions: r && Array.isArray(r.regressions) ? r.regressions : [],
  };
}

// Saved findings stand in for the sweep; their done severe fixes still get the regression check below.
let secondFindings;
let unreviewed = false;
if (savedSecond) {
  secondFindings = sortFindings(savedSecond);
} else {
  const alreadyFixed = [...doneIds(toFix), ...out.fixed];
  const second = await sweepAndVerify(lensesOr(args.lenses), alreadyFixed, 'second:');
  secondFindings = second.findings;
  // A lens the second sweep never reviewed means the stage is not done: hand over, never 'stable'.
  out.blocked.push(...second.blocked);
  unreviewed = second.blocked.length > 0;
}
const severe = secondFindings.filter((f) => f.severity === 'severe');
const others = secondFindings.filter((f) => f.severity !== 'severe');

let regressions = [];
if (severe.length > 0) {
  const fixedNow = await fixLoop(severe, out);
  const toCheck = [...doneIds(severe), ...fixedNow];
  if (toCheck.length > 0) {
    const r = await agent(regressPrompt(toCheck, args), {
      label: 'regress',
      phase: 'Second sweep',
      schema: REGRESS_SCHEMA,
    });
    regressions = r && Array.isArray(r.regressions) ? r.regressions : [];
  }
}

// There is never a third sweep: the run ends here either way.
return {
  status: severe.length > 0 || unreviewed ? 'handover' : 'stable',
  fixed: out.fixed,
  reverted: out.reverted,
  contract_items: out.contract_items,
  blocked: out.blocked,
  open_items: [...selectedMinor, ...others],
  second_sweep: { severe: severe.length, others: others.length },
  second_sweep_findings: secondFindings,
  regressions,
};
