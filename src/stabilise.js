// ---- stage 4: stabilise ----
// part 'sweep' (4a): reviewers by lens, an adversarial verify per finding, a severity-ordered list.

// One sweep: a review per lens, then a verify per finding. Keeps the findings the verifier
// reproduced, with the verifier's severity, merged and ordered. A verdict of real:false or
// null (the agent died or was skipped) counts as refuted.
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
      const found = review && Array.isArray(review.findings) ? review.findings : [];
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

// part 'fix' (4b) lands in Task 8.
return { status: 'invalid', errors: ["part 'fix' is not built yet"] };
