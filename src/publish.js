// ---- publish.js body: stage 5 ----
// Docs, then the owner's evidence, then the full gate. This script never pushes (A5):
// it returns `ready` with a PR title and body file, and the head pushes and opens the PR.

const publishErrors = validatePublishArgs(args);
if (publishErrors.length > 0) return { status: 'invalid', errors: publishErrors };

const publishDone = args.done;

// spec 3.1: {docs?, evidence?}, the sha each agent reported, never an empty one; on every result from here.
// Only a hex sha goes in (spec 8); any other reported value blocks its id.
const commits = {};
const blockedAt = (id, reason) => ({ status: 'blocked', blocked: [{ id, reason }], commits });

// spec "Phase results", the order of checks for a non-null docs or evidence result r: the agent's
// own blocked status (its sha commit still recorded), then a reported non-sha commit.
function phaseIssue(id, r) {
  const reason = phaseBlockedReason(r);
  if (reason !== null) {
    recordSha(commits, id, r);
    return blockedAt(id, reason);
  }
  if (recordSha(commits, id, r)) return blockedAt(id, NOT_A_SHA);
  return null;
}

function firstLine(text) {
  return typeof text === 'string' ? text.split('\n')[0].trim() : '';
}

// POSIX single-quoted form, each ' written as '\'': the agent's summary is data, and sh
// must never expand backticks or $(...) in it (SECOND-SAFETY-1).
function shellQuote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

phase('Docs');
let docs = null;
if (!publishDone.includes('docs')) {
  docs = await agent(docsPrompt(args), { schema: DOCS_SCHEMA, label: 'docs', phase: 'Docs' });
  if (docs === null || docs === undefined) return blockedAt('docs', 'agent returned nothing');
  const docsIssue = phaseIssue('docs', docs);
  if (docsIssue) return docsIssue;
}

let evidence = null;
if (!publishDone.includes('evidence')) {
  evidence = await agent(evidencePrompt(args), { schema: EVIDENCE_SCHEMA, label: 'evidence', phase: 'Docs' });
  if (evidence === null || evidence === undefined) return blockedAt('evidence', 'agent returned nothing');
  const evidenceIssue = phaseIssue('evidence', evidence);
  if (evidenceIssue) return evidenceIssue;
}

phase('Gate');
const gate = await agent(gatePrompt(args), { schema: GATE_SCHEMA, label: 'gate', phase: 'Gate' });
// Green means passed and a real exit status of 0; anything else is not green (spec 8).
if (!gate || gate.passed !== true || gate.exit_status !== 0) return { status: 'gate_failed', gate, commits };

const summaryLine = firstLine(docs && docs.summary);
const prTitle = summaryLine ? `${args.epic}: ${summaryLine}` : args.epic;
return {
  status: 'ready',
  docs,
  evidence,
  gate,
  pr: {
    title: prTitle,
    title_shell: shellQuote(prTitle),
    body_file: `${epicDir(args)}/pr-body.md`,
  },
  commits,
};
