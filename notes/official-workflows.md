# How Claude Code's workflows and ultracode work

Checked 24 Oct 2026 against Claude Code 2.1.308. Sources:
- https://code.claude.com/docs/en/workflows.md
- https://code.claude.com/docs/en/plugins/components.md
- https://code.claude.com/docs/en/plugins/publish.md
- https://code.claude.com/docs/en/skills.md
- the bundled `workflow-authoring` reference that Claude Code gives the model

The engine's source is compiled into the binary and not readable here. Every "not documented" below means exactly that; check again before relying on it.

## Two layers

### 1. The Workflow tool (the engine)

**Script shape.** A workflow is a plain JavaScript `.js` file. It starts with `export const meta = { name, description, phases? }`, which must be a pure literal. The body runs with top-level await. It's JS only: TypeScript syntax doesn't parse, and there's no filesystem or Node API.

**Functions available in the body:**
- `agent(prompt, opts)` starts a fresh subagent, which gets the same CLAUDE.md files. It returns the agent's final text. With `opts.schema` (JSON Schema), the agent is made to call a StructuredOutput tool and you get a validated object back. It returns `null` if the agent was skipped or died.
  - Other options: `label`, `phase`, `model`, `effort` (low..max), `isolation: 'worktree'` (expensive; only for agents that write files in parallel) and `agentType`.
- `pipeline(items, ...stages)` sends each item through every stage, with no barrier between stages. This is the default for multi-stage work. Each stage gets `(prevResult, originalItem, index)`. If a stage throws, that item becomes `null`.
- `parallel(thunks)` is a barrier. Use it only when a stage needs every earlier result together, for example to dedupe or to exit early.
- The rest:
  - `phase(title)` groups agents for display;
  - `log(msg)` prints a progress line;
  - `args` is the tool's input, passed verbatim as JSON;
  - `budget` is the turn's token target, a hard ceiling when it's set;
  - `workflow(nameOrRef, args)` runs one nested workflow, one level only.

**Determinism and resume:**
- Every agent's result goes into `journal.jsonl`, keyed by a hash of its prompt and options.
- `resumeFromRunId` returns cached results for the longest unchanged prefix of calls. Everything after the first changed call runs live.
- That's why `Date.now()`, `Math.random()` and `new Date()` with no arguments throw: they would make runs impossible to replay. Pass timestamps in through `args`.

**Limits:**
- concurrency is min(16, CPUs − 2) agents at once;
- 1,000 agents per run, as a backstop;
- 4,096 items per `parallel` or `pipeline` call.

**Running and saving:**
- Runs go in the background, and the session gets a notification when one finishes.
- `/workflows` lists runs and shows their progress. Its keys: `p` pause or resume, `x` stop, `r` restart an agent, `f` filter, `s` save.
- Saved workflows live in `.claude/workflows/` (project; commit it to share) or `~/.claude/workflows/` (personal). Project wins when the names clash.
- You run a saved workflow as `/<name>`, and a plugin's as `/<plugin>:<name>`.
- A permission rule, `Workflow` or `Workflow(<name>)`, approves runs ahead of time.

### 2. Ultracode (the policy)

**Turning it on:**
- **the keyword:** typing `ultracode` in a prompt you type yourself runs that one task as a workflow. It doesn't fire with `-p`, from scheduled tasks or from relayed webhooks;
- **for a session:** `/effort ultracode`, and `/effort ultracode off` to stop;
- **at startup:** `claude --effort ultracode` turns it on and also sets effort to xhigh;
- **always on:** the `ultracode` settings key;
- **off switch for the keyword:** the "Ultracode keyword trigger" row in `/config`.

**What it changes:**
- Claude plans a workflow for every substantive task instead of waiting to be asked.
- The large-workflow warning is off.
- The subagent concurrency limit is lifted for Agent-tool subagents.
- In auto mode, the first launch needs no approval.
- The model is told that token cost isn't a constraint.

**Size guideline:** `workflowSizeGuideline` is unrestricted, small (<5 agents), medium (<10) or large (<50). The default is medium (small for Pro). It's advice to the model, not a cap.

**Patterns it hands the model:**
- adversarial verify;
- verifiers with different lenses;
- a judge panel;
- loop-until-dry;
- a multi-modal sweep;
- a completeness critic;
- "no silent caps".

It also suggests running separate workflows for understand, design, implement and review, and reading each result before starting the next.

## What it doesn't decide

The official layer gives primitives and patterns shaped like reviews (find, verify, fix). It has nothing to say about how a build goes from a plan to stable, or about when to stop fixing. That gap is where this project fits.

## Packaging and sharing

- **A plugin** can ship workflows in a `workflows/` folder, or wherever its manifest's `workflows` field points, next to `skills/`, `agents/`, `commands/` and `hooks/`. The schema for that field (manifest-reference.md) is not yet checked.
- **A skill launching a workflow:** not documented. A SKILL.md that says "run this workflow" is only prompt text. The real entry point is the saved workflow itself.
- **`allowed-tools`** in skill frontmatter approves tools ahead of time for the turn that invokes the skill. It doesn't restrict them. Whether it covers a Workflow launch is not documented.
- **Your own marketplace** is a git repo with `.claude-plugin/marketplace.json`. Install it with `claude plugin marketplace add owner/repo`, then `claude plugin install <plugin>@<marketplace>`.
- **Anthropic's directory** takes submissions at https://claude.ai/directory/manage. It needs a paid plan, and you run `claude plugin validate ./plugin --strict` first. Listed plugins show up as `<name>@synced`. `claude-plugins-official` doesn't take submissions through that portal.

## Second round of checks (24 Oct 2026)

"Stated" means the docs say it. "Not documented" means they don't. Each "not documented" item needs a spike before the design relies on it.

**Waking an idle head session:**
- Cross-session messages to an idle session start a new turn. Stated (cross-session-messaging.md).
- A background workflow finishing while the session is idle starting a turn: not documented. Observed in practice: background task notifications do re-invoke the session. Needs a spike.

**Workflow agents messaging the head mid-run:** not documented. The workflows page says "No mid-run user input"; agents only return results to the script.

**Usage-limit waits:**
- A run waits for the limit to reset only when all of these hold:
  - it's an interactive session;
  - on a claude.ai subscription;
  - with `autoContinueAtUsageLimit` on;
  - the reset is within 24 hours;
  - there have been fewer than two waits before.
- It never waits in `-p`, background sessions or Remote Control; the agent fails instead. Stated (workflows.md, interactive-mode.md).

**Reset times you can read:**
- The statusline JSON gives `rate_limits.five_hour.resets_at` and `rate_limits.seven_day.resets_at` (Unix seconds), plus `used_percentage`.
- They appear only for Pro and Max, and only after the first API response. Stated (statusline.md).
- `/usage` in `-p` mode: not documented. Hook input has no rate-limit fields.

**Scheduling:**
- CronCreate tasks are scoped to the session. They fire only while Claude Code is running and idle, and stop when it exits.
  - `--resume` brings back recurring and one-shot tasks that haven't expired, but not a self-paced `/loop`.
  - Recurring tasks expire after 7 days.
  - Stated (scheduled-tasks.md).
- Durable options:
  - cloud scheduled tasks (routines; they run on Anthropic's cloud, not your machine; a research preview);
  - desktop scheduled tasks (your machine has to be on);
  - a GitHub Actions schedule.
- Over the limit: a cloud task is rejected until the window resets. What a session-scoped cron does at the limit is not documented.

**Hooks:**
- A UserPromptSubmit hook can add `additionalContext`; it can't replace the prompt. Plugins ship hooks in `hooks/hooks.json`. Stated.
- Not verified: whether UserPromptSubmit's input includes the prompt text. A keyword-trigger example: not documented.
- `permission_mode` (default, plan, acceptEdits, auto, dontAsk, bypassPermissions) is a common hook input field. Confirmed on PreToolUse; not verified on UserPromptSubmit. Skills can't read the mode.

**Plugin manifest:**
- `dependencies` takes `"name"`, `"name@marketplace"` or `{name, marketplace, version}`, and a dependency starts enabled. Stated (manifest-reference.md).
- `workflows` takes a path or an array of paths (`.js` files or directories) and replaces the default `workflows/` scan.
