// ---- publish.js body: stage 5 ----
// Docs, then the owner's evidence, then the full gate. This script never pushes (A5):
// it returns `ready` with a PR title and body file, and the head pushes and opens the PR.

const publishErrors = validatePublishArgs(args);
if (publishErrors.length > 0) return { status: 'invalid', errors: publishErrors };

const publishDone = args.done;

// spec 3.1: {docs?, evidence?}, the sha each agent reported, never an empty one; on every result from here.
const commits = {};
const recordCommit = (id, result) => {
  if (result && isNonEmptyString(result.commit)) commits[id] = result.commit;
};

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
  if (docs === null) return { status: 'blocked', blocked: [{ id: 'docs', reason: 'agent returned nothing' }], commits };
  recordCommit('docs', docs);
}

let evidence = null;
if (!publishDone.includes('evidence')) {
  evidence = await agent(evidencePrompt(args), { schema: EVIDENCE_SCHEMA, label: 'evidence', phase: 'Docs' });
  if (evidence === null) return { status: 'blocked', blocked: [{ id: 'evidence', reason: 'agent returned nothing' }], commits };
  recordCommit('evidence', evidence);
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
