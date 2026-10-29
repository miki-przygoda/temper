# temper: design spec

Date: 24 Oct 2026. Status: written from design sections 1–6, all approved by the owner. Sources: `notes/discovery.md` (the owner's idea and answers), `notes/design.md` (the approved sections), `notes/official-workflows.md` (Claude Code facts, with doc links), `notes/lessons-from-cairn.md`.

## 1. Goal

temper is a Claude Code plugin for a solo developer. It takes a piece of work from an idea to a spec, to a plan, to an MVP, to a stable branch, to a PR, in a fixed order. Each stage can also be invoked on its own.

The human is in the loop where people are good: problem solving, during discovery and spec writing. The head session (the one the user talks to) directs the work by the spec. Execution agents follow instructions and don't improvise.

It exists because repeated review-and-fix sweeps don't converge: fixes create new bugs. temper builds an MVP first, verifies it against an independent oracle, then runs one sweep, careful fixes and one final sweep with a hard stop.

**Success criteria:**
- Every stage runs from files a person could have written by hand.
- A run survives blocked questions and usage-limit resets without redoing finished work.
- The stop rules hold: at most 2 to-green rounds in stage 3, and at most 2 sweeps in stage 4.
- Nothing is pushed, merged or deleted against the fixed rules (section 8).
- The first real run, Cairn's hardening branch, meets the criteria in section 10.

## 2. Non-goals for v1

- **Coordinating several head sessions.** Multi-developer and multi-session hand-offs belong to Cairn's team layer. temper has one head session (decision A). Its file-based hand-offs are what Cairn will build on.
- **VMs and containers.** Tasks run in git worktrees on the user's machine, or on an ssh build host. VMs get their own spec later, behind the "where tasks run" layer (section 3.4).
- **Replacing Claude Code's Workflow tool or ultracode.** temper uses the Workflow tool and ships its own workflows.
- **Writing a board as the source of truth.** Jira or GitHub Projects can only mirror `epics.md`.
- **A keyword trigger that is on by default.**

## 3. Architecture

### 3.1 Shape: a fixed skeleton fed with plan data

- temper ships tested workflow scripts for the run stages: `build.js` (stage 3), `stabilise.js` (stage 4) and `publish.js` (stage 5).
- The head never writes control flow. It turns the plan into data (`args.json`) and launches a saved workflow with it.
- The same principle applies to agents: the creative part of the work is the spec, not the machinery.
- **Rejected alternatives:**
  - **generated scripts per run:** untested control flow every time;
  - **skills only:** no journal replay or resume, and the head's context fills up.

### 3.2 Stages and hand-offs

| Stage | Entry | Takes in | Hands on |
|---|---|---|---|
| 1 ground | `/temper:ground` | a conversation, plus research agents | `epics.md`, plus `spec.md` and `research.md` per epic |
| 2 plan | `/temper:plan` | one `spec.md` | `plan.md` and `args.json` |
| 3 build | `/temper:build` (workflow) | `args.json` | the epic branch at MVP, plus a build report |
| 4 stabilise | `/temper:stabilise` (workflow) | the branch | the fixed branch, plus open items |
| 5 publish | `/temper:publish` (workflow) | the branch | docs, an evidence script and checklist, a PR |
| cleanup | `/temper:cleanup` | merged branches | worktrees, branches and build dirs removed |

- Every hand-off is a file, so any stage can start from a file a person wrote.
- For stage 1, the head recommends either the whole lifecycle or stopping at the specs (epics for a board). The user decides.

### 3.3 State files

| Where | File | Holds |
|---|---|---|
| The user's account | `~/.claude/temper/preferences.md` | the setup interview's answers and later changes, with a format version |
| The user's account | `~/.claude/temper/limits.json` | the usage reset times, written by the statusline script |
| The project | `.temper/project.md` | the gate and quick-check commands, the build host, the specs directory (default `docs/temper/`), severity notes, extra review lenses, board mirroring on or off |
| The project | `docs/temper/epics.md` | the epics, the contracts between them and each epic's status. The source of truth. |
| The project | `docs/temper/<epic>/spec.md`, `research.md`, `plan.md` | the outputs of stages 1 and 2 |
| The project | `docs/temper/<epic>/log.md` | decisions, blocked questions and their answers, the morning reports and open items |

Preferences live outside the plugin directory, so a plugin update never overwrites them.

**Board mirroring.** When it's on, the head updates the board after every status change in `epics.md`: GitHub Projects through `gh`, Jira through its MCP server. A board that fails to update never blocks a run; the failure is noted in `log.md`.

### 3.4 Where tasks run

A small layer in the scripts' prompts and in `project.md`:
- **`local`:** a git worktree per task under a temper-owned directory;
- **`ssh <host>`:** the worktree is on the host, and commands run over ssh with a per-epic build directory.

Push rights stay with the head on the user's machine. VMs plug in here later.

### 3.5 Checkpoints and resume

- Every task commit carries a `Temper-Task: <epic>/<id>` trailer.
- Before every launch or resume, the head reads the trailers on the epic branch and passes the finished ids as `args.done`. The scripts skip those tasks.
- Finished work is therefore known from git, not from the engine's cache. The cache replays only the longest unchanged prefix of calls, so without this an edited prompt or an answer would rerun later tasks.

### 3.6 Blocked questions

1. An agent returns `{status: "blocked", question, context}`.
2. The script lets the current wave finish, then ends with the list of blocked tasks.
3. The head answers each one from the spec:
   - **the spec settles it:** answer;
   - **it doesn't, and it's severe:** ask the user, or tell them per their preferences;
   - **it doesn't, and it isn't severe:** the head decides and records the decision in `log.md`.
4. The answers go into `args.answers[<task id>]`. Each answer is put only into its own task's prompt.
5. The head resumes the run.

## 4. Stage 1, `ground`

`ground` wraps `superpowers:brainstorming` and adds:

- **Question style from preferences:**
  - open text while the user is dumping ideas;
  - multiple-choice questionnaires (AskUserQuestion: up to 4 tabs, each with 2–4 options plus a custom answer) once there is a base.
- **Research agents, in parallel:**
  - best practices;
  - prior art;
  - documented facts, each with a source link.

  The output is `research.md`, which the spec cites.
- **A size recommendation:** the full lifecycle, or specs only.
- **The epic split:** `epics.md` lists each epic and what it needs from other epics, stated as contracts.
- **The spec template.** Required sections:
  - goal;
  - user flows (the stage 3 checkpoint runs these);
  - contracts between parts;
  - non-goals;
  - security notes;
  - deferred questions with reasons.

  A spec is handed on only when it has no open questions.

## 5. Stage 2, `plan`

`plan` wraps `superpowers:writing-plans` and adds:

- a written contract at every boundary between tasks (types, signatures, formats, errors);
- **file ownership per task:** no two tasks in the same wave own the same file;
- **waves from the dependency graph:** tasks that block others come first, and wave 0 builds the shared contracts;
- the names of the behaviour groups;
- task ids for the trailers;
- the gate commands from `project.md`.

It generates `args.json`, which follows `schemas/args.schema.json`. The user reviews the plan before stage 3, unless their preferences let an overnight run go ahead without that review.

## 6. Stage 3, `build.js`

**Input:** `args.json` holds:
- `epic`, `branch`, `base`;
- `tasks[]`, each with `id`, `title`, `wave`, `owns[]`, `uses[]`, `provides[]` and `text`;
- `contracts`;
- `gates`, with `quick` and `full`;
- `host`;
- `behaviour_groups[]`;
- `done[]`;
- `answers{}`.

The script validates `args.json` first, and refuses before starting any agent if it's invalid.

**Flow:**
1. **Waves in order.** Within a wave, tasks run as a pipeline. Each task goes through three steps:
   1. **Implementer:** works in its own worktree, follows the task text, writes the plan's tests first, commits with the trailer and runs the quick gate.
   2. **Checker** (a separate agent), which confirms that:
      - the diff touches only `owns[]`;
      - the plan's tests are present and not weakened;
      - the quick gate passes;
      - deliberately breaking the code makes the tests fail (a spot-check).
   3. **Retry:** one retry with the checker's report. A second failure counts as blocked.
2. **Merge after each wave.** A merge agent merges the worktrees into the epic branch in dependency order, with the quick gate after each merge. Every conflict counts as blocked.
3. **MVP checkpoint:** the full gate, plus a manual run of each user flow from the spec. It records gaps and fixes nothing.
4. **Behaviour spec:** written by a separate agent from `spec.md`, never from the code.
5. **Acceptance tests:** one agent per behaviour group, never touching product code. A test that fails because of the product stays, marked ignored with its behaviour id.
6. **To-green, at most 2 rounds.** Each failing behaviour is one of:
   - **the product is wrong:** the smallest fix;
   - **the test is wrong:** correct it, citing the spec line;
   - **the spec doesn't decide:** it becomes a question.

   A fix that breaks anything else is reverted, never patched on top.
7. **It returns a build report:** tasks, gates, checkpoint flows, the acceptance pass and fail counts, questions, and blocked items.

**An implementer must stop and return blocked to:**
- change a contract;
- add a dependency;
- touch a file outside `owns[]`;
- edit the tests it is judged by;
- do anything privileged or outside the project.

Anything the task text, the contracts and the tests settle is the implementer's to decide.

## 7. Stage 4, `stabilise.js`

### 4a: sweep and list

1. **Parallel reviewers,** each with one lens, each in a throwaway worktree.
   - The default lenses are: security; failure paths and lifecycle; test strength and docs. `project.md` can add more.
   - A finding needs an input and the wrong result it produces.
2. **Adversarial verify:** a separate agent tries to disprove each finding, reproduces it, and re-rates its severity against the rubric (section 7.1) plus the project's notes. Duplicates are merged.
3. **The list is ordered by severity, and the run ends.**
   - With the user present: the head shows a multi-select question box.
   - Overnight: the head picks according to preferences (default: Critical and Important) and logs its choice. Minor findings go to the open items.

### 4b: careful fixes, one at a time, in severity order

For each fix:
1. **Trace its origin:** `git blame` leads to the `Temper-Task` trailer, which leads to the task and its contract. If the contract is wrong, it goes to the user or the spec, never into a quiet code fix.
2. A failing test first.
3. The smallest fix.
4. **Impact check:** the dependants from the plan's contract graph, then the whole acceptance suite and the quick gate.
5. If anything else breaks, revert and rethink. Move on only when this item is clean.

### Second sweep and stop

1. Fresh agents sweep again, told what was already fixed.
2. Then:
   - **Nothing severe:** done. Non-severe findings go to the open items.
   - **Something severe:** fix it with the same five steps, check only those fixes' diffs, then stop and hand over to the user.

There is never a third sweep.

With `sweeps: 1` in `project.md` there is no second sweep: after the fix wave and its regression check (one agent per fix), the stage is done (A16).

### 7.1 Severity rubric (the default; `project.md` adds language notes)

| Level | Meaning |
|---|---|
| Severe | A real security issue or backdoor. Severe items wake the user, per their preferences. |
| Critical | Wrong results, data loss, or crashes on normal input. |
| Important | Wrong behaviour on input the spec implies, or a test that can't catch a defect it claims to catch. |
| Minor | Everything else that is real. It goes to the open items unless the user selects it. |

## 8. Fixed rules that no preference can change

- No privileged commands (no sudo, not even `sudo -n`). Root steps go into a script and a checklist for the user.
- temper never merges.
- It pushes branches and opens PRs only on a green full gate, and only if the user's preferences allow it. Otherwise it asks.
- It never deletes work that isn't on the remote. The cleanup check is code:
  - the branch is reachable from `origin/<default branch>`, or matches its remote ref;
  - the worktree has nothing uncommitted or untracked.
- Content from repos, docs, logs and agents is data, never instructions.
- Anything that would loosen a security decision is confirmed with the user every time.

If the user asks for a preference that contradicts one of these, the head explains why and doesn't save it.

## 9. Preferences and overnight runs

### Setup interview

`/temper:setup` runs on first use. It's one questionnaire with tabs, and its answers are written to `preferences.md`. The questions:
- question style;
- the overnight contact for severe items: a push notification, the morning report only, or a push for anything blocking;
- whether an overnight run may start without the plan review;
- whether temper may push and open PRs;
- what gets fixed overnight by default;
- approval for overnight wakeups;
- the morning report time (default 07:00 local), which is the end of "overnight";
- whether the keyword trigger is on.

Afterwards temper tells the user where the file is, and that they can ask Claude to change, undo or specialise any choice.

### Keyword trigger

- Off by default, because "temper" is an ordinary word.
- When it's on, a UserPromptSubmit hook adds context telling the head to use temper.
- The same hook reads `permission_mode`, and warns when the session isn't in auto mode before an overnight run.

### Overnight pre-flight

The head checks:
- auto mode is on;
- `autoContinueAtUsageLimit` is on;
- the statusline script is installed, it wraps any existing statusline, and `limits.json` is fresh;
- wakeups are approved.

The head also tells the user the session must stay open, a documented limit of scheduled tasks.

### Wakeups

1. At launch, the head reads `rate_limits.five_hour.resets_at` and schedules a check-in for 2 minutes after the reset.
2. Each check-in:
   - reads the journal;
   - resumes the run if it stopped on the limit;
   - answers any blocked questions it can;
   - schedules the next check-in.
3. If `seven_day.used_percentage` is 90 or more (preferences can lower this), or the next five-hour reset falls after the morning report time, the head stops cleanly and writes the morning report.

### Morning report

A summary in `log.md`, plus a push notification if the preferences ask for one.

## 10. Proving it

### 10.1 Spikes before planning

| # | Question | Depends on it |
|---|---|---|
| S1 | Does a workflow finishing wake an idle head session? | 3.6, overnight runs |
| S2 | Does UserPromptSubmit input include the prompt text and `permission_mode`? | the keyword, the mode warning |
| S3 | Does a wrapping statusline script receive `rate_limits` and write `limits.json`? | wakeups |
| S4 | Does a check-in fire after the usage limit is hit, and can it resume the run? | overnight runs |
| S5 | Does a plugin workflow run as `/temper:build` with args? Does a dependency on superpowers install with the plugin? | packaging |
| S6 | How does `autoContinueAtUsageLimit` behave while a workflow is running? | overnight runs |

A failed spike changes this spec before planning, not during it.

### 10.2 Tests

- **A Node harness for the workflow scripts.** It replaces `agent()`, `pipeline()`, `parallel()`, `phase()` and `log()` with scripted responses. Cases:
  - blocked ends its wave;
  - exactly one retry;
  - `done` tasks are skipped;
  - a merge conflict counts as blocked;
  - at most 2 to-green rounds;
  - never a third sweep;
  - an invalid `args.json` is refused before any agent starts.

  Node is a dev dependency only.
- **`claude plugin validate --strict`** on every change.
- **Skills** are proven by use.

### 10.3 First real run: Cairn's hardening branch (H-1..H-5)

- **Scope:** it starts at stage 2, with a plan written from Cairn's `docs/BACKLOG.md`, then runs stages 3–5.
- **Setup:** the ssh build host, with `ci/local/run.sh` as the full gate.
- **It passes when:**
  - the run finishes with the gate green;
  - no finished task runs twice;
  - every blocked question is answered and the run resumes;
  - no third sweep;
  - cleanup deletes only work that is on the remote.
- **Also recorded:** the number of fixes that broke something else, for comparison with R3.

## 11. Repo layout

```
.claude-plugin/plugin.json        name, version, dependencies: superpowers
.claude-plugin/marketplace.json   install from this repo
skills/ground plan run setup cleanup
workflows/build.js stabilise.js publish.js
hooks/hooks.json                   UserPromptSubmit: keyword, mode warning
statusline/temper-statusline.sh    writes limits.json, wraps an existing statusline
schemas/args.schema.json
templates/ spec.md plan-additions.md project.md preferences.md
tests/harness/                     the control-flow tests
docs/specs/ docs/plans/
```

Installing from the private repo works through the user's git credentials. Sharing temper means making the repo public, or granting access.

## 12. Amendments (24 Oct 2026, from the spikes)

- **A1, state directory.** User state lives in `$CLAUDE_CONFIG_DIR/temper/` when `CLAUDE_CONFIG_DIR` is set, else `~/.claude/temper/`. Spec 3.3's `~/.claude/temper/...` paths mean this directory.
- **A2, superpowers.** `superpowers@anthropic-plugin-directory` is a cross-marketplace dependency. It isn't installed automatically, and temper fails to load until it is. The README and `/temper:setup` say to install it first.
- **A3, keyword matching.** The keyword hook matches only the `prompt` field of the hook input, never the raw JSON.
- **A4, the statusline lives in the state directory.** The plugin's cache path changes with every version, so setup copies the statusline script to `<state>/bin/` and points the settings there. `/temper:run` re-copies it when the copy's version differs from the plugin's.
- **A5, who pushes.** `publish.js` never pushes. It returns `ready` with a PR title and body file. The head, following the `run` skill, pushes and opens the PR: only on a green gate, and only when `may_push: yes` or the user says yes. Spec 3.4 and 8 already keep push rights with the head; this makes it explicit.
- **A6, phase checkpoints.** The phases after the waves (checkpoint, behaviour spec, acceptance groups, to-green rounds, fixes) also commit with a `Temper-Task: <epic>/<phase id>` trailer. So `args.done` covers phases as well as tasks (spec 3.5).

### Amendments from the v1 build's sweep (24 Oct 2026, owner decisions)

- **A7, the ssh host's commits come back to the user's machine.** Before every run of `done_tasks.py` and before any push, the head fetches the epic branch and the task branches from the host's clone with `git fetch ssh://<host>/<host_clone> ...`. `.temper/project.md` names the host clone as `host_clone:`, and it must lie outside `<root>/<epic>/`. (TESTS-DOCS-8)
- **A8, cleanup never runs `rm -r` on an epic directory.** It removes only worktrees that passed the cleanup check, then removes the per-epic directory with `rmdir`, which works only when the directory is empty. The host clone is never inside it. (SAFETY-4)
- **A9, a blocked wave still merges the tasks that passed.** Before `build.js` returns `blocked`, it merges the tasks whose checks passed into the epic branch and lists them in `done_now`. Only the blocked tasks run again on resume. (CONTROL-FLOW-6)
- **A10, the cleanup check counts ignored files.** It also runs `git status --porcelain --ignored --untracked-files=all`. Any ignored file blocks cleanup, unless it matches a `disposable:` pattern in `.temper/project.md` (for example `target/`, `node_modules/`, `__pycache__/`). (SAFETY-9)
- **A11, the checker diffs the task branch against the epic branch:** `git diff <epic branch>...temper/<epic>/<task id>`. The plan's Task 4 said `<base>...`, which counts earlier waves' files against every task from wave 1 on. (TESTS-DOCS-1)

### Amendments from the second sweep (25 Oct 2026, owner decisions)

- **A12, the ssh host's epic branch is kept the same as the head's.** The head pushes its copy of the epic branch to the host clone before every launch or resume, the first one too (which carries the spec and plan the plan skill committed, so the host's agents can branch from it), and right after every commit it makes on it. It fetches back before it commits anything, before every run of `done_tasks.py` and before every push. Both go through `scripts/host_sync.py`, which replaces A7's `git fetch` command: the fetch lands in a private namespace, `refs/temper/host/`, never straight in `refs/heads/`, and moves each local branch only by a fast-forward, with `git merge --ff-only` in the worktree where it's checked out, or else with `git update-ref` checking the old value. A local branch ahead of the host's copy is left for the push, and the head pushes to `origin` only when nothing is ahead, so the host's gate saw every commit. A non-fast-forward in either direction stops the run as blocked with a clear message; nothing is ever forced. Agents leave the epic branch checked out in no worktree on the host, since git refuses a push to a checked-out branch. `host.root` and `host.clone` are both absolute or both `~/`, and are compared after collapsing `.`, `..` and repeated slashes. The host's cleanup check runs with `python3 -I`. `scripts/ssh_host_smoke.sh <host>` checks the git side end to end against a real host, in throwaway repos. (A7-REGRESSION, SECOND-CONTROL-FLOW-1, SECOND-CONTROL-FLOW-2, SECOND-TESTS-DOCS-1, SECOND-SAFETY-7, SECOND-SAFETY-8)

### A13. Size launches to the build host (owner, 25 Oct 2026)

From the first real run (Cairn hardening on a 4-CPU host): a 16-task wave queued 16 gates on one cargo lock, agents worked around the wait with private build directories until the shared disk was nearly full, and their gates never finished. Before each launch the head checks what the build host has free (CPUs, memory, disk, what else runs there), estimates one gate's cost, and launches in chunks the host can take, most critical first, checking the host again between chunks. The plan sizes waves the same way. Parallel gates don't share scratch space.

### Amendments from v0.2 (28 Oct 2026, `docs/temper/v0-2/spec.md`)

- **A14, commits that reach their branch.** Every agent that commits works on its branch: implementers in a task worktree with the task branch checked out, merge and phase agents in one shared epic worktree. Each one checks that HEAD names its branch before committing and that the branch moved to its commit afterwards, and returns blocked instead of repairing a branch by hand. The checker confirms that the task branch's tip is the reported commit and not already on the epic branch, every run stage returns the `commits` its agents reported, and the head checks each one is on its branch and never cherry-picks one. Only a lowercase hex sha of 7 to 64 characters (`/^[0-9a-f]{7,64}$/`, so SHA-1 and SHA-256) goes into `commits`, and the checker's tip check uses the same pattern; any other reported value is left out and its id is blocked with `commit is not a sha`, because the head runs git on these values. The task id `epic` is refused, since it would share the epic worktree's path. (v0.2 spec §3.1)
- **A15, the project's build rule reaches every agent.** `.temper/project.md` may have a `## Build rule` section, which the plan copies into `args.json` as `build_rule` and never into task texts. `withRules` puts it into every prompt, framed as data except where it says how to build and test, after the host text and before the fixed rules, so the fixed rules have the last word. (v0.2 spec §3.2)
- **A16, one-sweep mode and a regression check after every fix wave.** `sweeps: 1 | 2` in `project.md` (default 2) reaches stabilise as `args.sweeps`. Every `part: "fix"` run checks each landed first-wave fix with its own `regress:fix:<id>` agent, done ones included, even when the fix loop wasn't clean: a proven regression hands over, then any block blocks. With `sweeps: 1` a clean check returns `stable` with `second_sweep: null`, and the head bumps `args.attempt` on every resume so the check runs live. The regression agents launch in chunks of `args.gate_slots` (the smaller of `project.md`'s `gate_slots` and what the build host can take, A13); with no `gate_slots` they launch together. (v0.2 spec §3.3)
- **A17, selected minor findings are fixed.** The fix part fixes everything in `args.selected`, whatever its severity, in severity order with minors last; only unselected minors go to the open items. Overnight selection is unchanged: `minor` stays invalid in `overnight_fix_default`, so a minor is fixed only when a person chose it. The 7.1 rubric's Minor line says so. (v0.2 spec §3.4)
- **A18, gates that wait for a slot.** Every prompt says a gate waiting for a free slot or lock is normal, never a failure, and never to be worked around with another build directory, target or partial run. `gate_slots: <n>` in `project.md` bounds the gates at once in the A13 sizing, and `templates/gate-slots.md` gives generic guidance for a project's own slot scripts. (v0.2 spec §3.5)
- **A19, known flaky tests in quick gates.** `flaky:` in `project.md` becomes `args.flaky`. When every failing test of a quick gate or an acceptance-suite run is on that list, the agent reruns it once and reports each such test in `flaky_reruns`, which the head records in `log.md`. The full gate is never rerun, so "push only on a green full gate" is unchanged. (v0.2 spec §3.6)
- **A20, two reverted fixes, redone.** A finding whose verifier returned nothing stays unverified, deduped against the verified list, and blocks above minor; it is never fixed unless a person selects it. Second-sweep ids live in their own `second:` namespace, and a legacy `fix:second-*` trailer not in `args.selected` still counts as proof that the second sweep ran. (v0.2 spec §3.9)
- **A21, answers change through args and resume.** The S7 spike showed that a resume with changed args replays the unchanged prefix of calls and runs everything from the first changed call live. So a changed answer is passed with updated `args` and `resumeFromRunId`, never by editing a generated script, and the `attempt` counter in A16 relies on the same rule. (v0.2 spec §3.7a)

### Amendments from v0.3 (28 Oct 2026, `docs/temper/v0-3/spec.md`)

- **A22, phases can say they're blocked.** The checkpoint, behaviour-spec, acceptance, green, docs and evidence results carry a required `status: 'done' | 'blocked'` and an optional `reason`; a blocked phase sends its other required fields empty. Build and publish check a phase result in a fixed order: nothing returned, then `status !== 'done'` (blocked with the agent's reason, or `phase returned status <status>`), then the commit, recorded only when it is a sha and with no second `commit is not a sha` entry for a blocked phase, then, for the checkpoint only, a red gate. Nothing runs after a blocked phase, and publish never returns `ready` after one. (v0.3 spec, phase results)
- **A23, the build's attempt and a checkpoint that commits only on a green gate.** `validateBuildArgs` accepts an optional `attempt`, an integer of 0 or more (missing means 0), and the checkpoint prompt and every phase prompt after it end with `Run attempt <n>.`; task prompts don't carry it. The run skill bumps `attempt` on every build resume, so a resume after a red checkpoint runs the checkpoint live instead of replaying it from the resume cache. The checkpoint commits its log section only when the full gate passed; on a red gate it commits nothing and returns blocked with the gate log in `reason`. (v0.3 spec, the build's `attempt` and the checkpoint prompt)
- **A24, throwaway worktrees are named under `tmp/`.** The checker, reviewer, verifier, regression and gate prompts name their throwaway worktree as `<repo>/.temper/worktrees/<epic>/tmp/<label>` (on an ssh host, `<root>/<epic>/tmp/<label>`), created detached and left in place when done. The label is lowercased, every character outside `[a-z0-9-]` becomes `-`, and 8 hex characters of a 32-bit FNV-1a hash of the raw label are appended, so no label escapes `tmp/` and two labels never share a path. An existing path is reused with `git -C <path> checkout --detach`, never removed; if that fails, the agent returns blocked with the reason. (v0.3 spec, throwaway worktrees)
- **A25, cleanup checks and removes detached worktrees.** `cleanup_check.py <repo> --detached --worktree <path>` passes a detached worktree of `<repo>` whose HEAD is reachable from the remote's default branch or any other branch of that remote, and whose status is clean except for disposable ignored files; it deletes nothing, and exactly one of a branch and `--detached` must be given. The cleanup skill lists every detached worktree under `.temper/worktrees/<epic>/`, `tmp/` included, from `git worktree list --porcelain`, checks each one with `--detached` and removes it only on exit 0. On an ssh host, `rmdir <root>/<epic>/tmp` comes before `rmdir <root>/<epic>`. (v0.3 spec, `cleanup_check.py` and the cleanup skill)
- **A26, a regression counts only on the branch tip.** Each `regress:fix:<id>` prompt names the branch's current tip and says a regression counts only when it reproduces on the current tip of the branch as well, with both reproductions given. So a regression already fixed forward is not reported again on a rerun of the check. The prompt still ends with `Run attempt <n>.` (v0.3 spec, the regression prompt)
- **A27, stale private host refs are pruned.** `host_sync.py fetch` passes `--prune` to the private fetch, so a branch deleted on the host loses its copy under `refs/temper/host/`. The refspecs bound the prune to `refs/temper/host/<branch>` and `refs/temper/host/temper/<epic>/`; `refs/heads/` is never pruned and still moves only by a fast-forward. (v0.3 spec, `host_sync.py fetch`)
- **A28, a task owns the tests its change breaks.** The plan skill tells the planner to search the tests (`git grep`) for every function, label, prompt line and file a task changes, to put each existing test file that asserts them into the task's `Owns:`, and to put two tasks that need the same test file in different waves. No code checks this, since which tests a change breaks isn't knowable from `args.json`. (v0.3 spec, plan test ownership)
- **A29, Python 3.10.** The scripts need Python 3.10 or later and stay stdlib only. CI's oldest job runs Node 20 with Python 3.10 on `ubuntu-latest`, and the `ubuntu-24.04` pin is gone. (v0.3 spec, Python)
- **A30, a throwaway is reused only when it is its own clean worktree.** `git checkout --detach` keeps uncommitted and untracked files, and refuses only on a conflict, so A24's "if that fails" never caught a dead agent's edits; and a plain directory at the path sits inside the enclosing checkout, so git would act on that. Before reusing an existing throwaway path, the agent checks that `git -C <path> rev-parse --show-toplevel` prints the same directory as `cd <path> && pwd -P` (a worktree of its own) and that `git -C <path> status --porcelain` prints nothing; only then does it run `checkout --detach`. If either check or the checkout fails, it returns blocked with the reason, and never deletes or cleans the path (agents never remove worktrees, a fixed rule). (owner, 29 Oct 2026, failure-paths-and-lifecycle-01)
