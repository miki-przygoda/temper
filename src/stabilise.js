// ---- stage 4: stabilise ----
// part 'sweep' (4a): reviewers by lens, an adversarial verify per finding, a severity-ordered list.
// part 'fix' (4b): the selected fixes, the second sweep, severe fixes with a regression check, the stop.

// One sweep: a review per lens, then a verify per finding. Keeps the findings the verifier
// reproduced, with the verifier's severity, merged and ordered. A verdict of real:false or
// null (the agent died or was skipped) counts as refuted.
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
      const found = (review && Array.isArray(review.findings) ? review.findings : []).filter(hasInputAndWrongResult);
      const verdicts = await parallel(found.map((f) => () => agent(verifyPrompt(f, args), {
        label: `${labelPrefix}verify:${f.id}`,
        phase: verifyPhase,
        schema: VERDICT_SCHEMA,
      })));
      return found.map((finding, i) => ({ finding, verdict: verdicts[i] }));
    },
  );
  const kept = [];
  let refuted = 0;
  for (const pairs of perLens) {
    for (const { finding, verdict } of pairs || []) {
      if (!verdict || verdict.real !== true) {
        refuted += 1;
        continue;
      }
      kept.push({ ...finding, severity: verdict.severity ?? finding.severity });
    }
  }
  return { findings: sortFindings(dedupeFindings(kept)), refuted };
}

const errors = validateStabiliseArgs(args);
if (errors.length > 0) return { status: 'invalid', errors };

if (args.part === 'sweep') {
  phase('Sweep');
  const { findings, refuted } = await sweepAndVerify(lensesOr(args.lenses), [], '');
  return { status: 'list', findings, refuted };
}

// part 'fix' (4b): careful fixes one at a time in severity order, one more sweep, then the stop.

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
await fixLoop(toFix, out);

phase('Second sweep');
const alreadyFixed = [...doneIds(toFix), ...out.fixed];
const second = await sweepAndVerify(lensesOr(args.lenses), alreadyFixed, 'second:');
const severe = second.findings.filter((f) => f.severity === 'severe');
const others = second.findings.filter((f) => f.severity !== 'severe');

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
  status: severe.length > 0 ? 'handover' : 'stable',
  fixed: out.fixed,
  reverted: out.reverted,
  contract_items: out.contract_items,
  blocked: out.blocked,
  open_items: [...selectedMinor, ...others],
  second_sweep: { severe: severe.length, others: others.length },
  regressions,
};
