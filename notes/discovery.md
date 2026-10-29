# Discovery: the owner's idea and the answers so far

Working name was **hypercode**; the name is **temper** (sixth round). The repository is `temper`.

## The idea (owner, 24 Oct 2026)

1. **Discovery with the human.** The head session and the user talk the problem through until their pictures match. Agents research the topic and its best practices. The output is a high-level spec, made highly detailed.
2. **Planning.** One plan or several epics, chosen by the head and the user. The work is split by dependencies: what blocks other work goes first, and the rest runs in parallel.
3. **Execution agents follow instructions.** They aren't creative. They report problems to the head, which steers them by the spec.
4. **Overnight mode is the default.** The head decides on its own and wakes the user only for severe items.
5. **This runs until the MVP is done,** with every spec'd feature verified.
6. **Review after the MVP.** An agent review produces a list ordered by severity, and the user is told about it. Issues are fixed one at a time: find where each was introduced and by which task, fix it, check what else the fix affects, then go to the next.
7. **Overnight wakeups.** The user approves them once, and that approval goes into memory. A skill finds out when the 5-hour usage window resets and schedules cron jobs, so the run continues after running out of tokens.

## Answers to the first round of questions

**Assumptions confirmed:**
- **a.** The head session is the one the user talks to, and it outlives the run.
- **b.** "Verified" means tests, not the agent saying it works.
- **c.** It's a replacement, or at least a layer that **enforces the process** and then launches dynamic workflows with a different set of instructions for each phase.

**Answers to the weak spots:**
1. **Escalation.** An agent returns `blocked`. Something (a hook or a notification) wakes the head session, the head resolves the block, and the work in the workflow continues.
2. **"Not creative".** The head and the user write a highly detailed spec. An agent writes code to match it. Each task gets the input format it receives and the output format expected of it. If those match, and tests prove the work wasn't faked, the agent did the job.
3. **Verification and merging.**
   - A separate agent verifies what was written.
   - The head session and the agents merge worktrees carefully.
   - Problems leaking into the main app before master are acceptable, because nothing is pushed until the end.
   - Order: MVP → verify → sweep → careful corrections → publish.
4. **Parallel parts.** The initial spec has to say what each part expects from the others, so the agents' work fits together cleanly.
5. **"Severe".** Left broad because it depends on the language. Severe means an actual security issue or a backdoor.
6. **Stopping rule for the review.**
   1. Make a list of the initial bugs.
   2. Fix all the chosen ones carefully; the user or the head chooses.
   3. Run one more verification sweep.
   4. If it finds nothing severe, continue.
7. **The 5-hour reset.**
   - Claude spawns another session and runs `/usage` to read the reset time.
   - It schedules a job for that reset. At the reset it looks again and schedules the next one, and so on.
8. **Permissions.** hypercode is auto-mode only, or it warns the user when the permissions aren't right.
9. **Existing skills.** Reuse superpowers' brainstorming and writing-plans; they work well.
10. **Sizing.** Give guidance and let the head decide. Fixed rules would hold back better future models.

## Second round (owner, 24 Oct 2026)

**Split into stages, each invoked separately.**
- Someone can use hypercode for ground → full spec only, or for spec → MVP only.
- Based on the size, Claude recommends either the full lifecycle or only ground → spec(s).
- Each spec can be an epic, put on a project board (GitHub Projects or Jira).
- Several workflows then work on the epics at once, as long as they aren't blocked.

## Third round (owner, 24 Oct 2026)

- **Epic status.** Kept in local files; Jira or GitHub Projects mirrors them.
- **Dependency list.** Created in stage 1 or 2, so agents are never left to make that choice.
- **Isolation.** The process includes running worktrees in several VMs, on one machine or another, to keep things clean. Once the work is on master or the remote, its worktrees and the work it created are cleaned off the machine.
- **Coordination: A.** One head session runs everything. hypercode is for a solo developer.
- **Larger work belongs to a separate multi-session tool.** One session does stages 1–2. The spec goes to a separate sub-head session, which launches its own larger workflow (for example stage 3 only). Then the main session, or the two working together, merge everything into one MVP or stable build, and then into the remote's master. That covers several developers following these practices, and large automated agent work.

**Consequence.** Every stage's input and output is a plain file in a fixed format, so such a tool can hand a spec from one session to another. hypercode has to work standalone, without it.

## Fourth round (owner, 24 Oct 2026)

- **Isolation for v1: A.**
  - Tasks run in plain git worktrees on the user's machine, plus an optional ssh build host.
  - A "where tasks run" layer lets VMs plug in later; VMs get their own spec.
  - Cleanup of worktrees and branches is a coded git check: the branch is reachable from origin/master or matches the remote, and nothing is left uncommitted. It's not an instruction.
  - Push rights stay with the head on the user's machine.
- **The user shapes the skill as they use it.**
  - Their choices become the skill's behaviour for them, for example how they want questions put to them.
  - This is the same idea as the wakeup approval: approve once, and it's remembered.

## Fifth round (owner, 24 Oct 2026)

**How questions are asked.**
- While the user is dumping ideas (early discovery, no base yet): open, plain-text questions. Multiple-choice boxes don't fit there.
- Once a base exists: multiple-choice questionnaires, with several numbered choices plus a custom answer, spread over several tabs or pages.
- The owner suggested 1–5 choices plus a 6th custom one. Claude Code's AskUserQuestion allows 2–4 options plus an automatic "Other", and up to 4 questions (tabs) per call. So it's 4 + custom per tab, and more pages means more calls.

**How the skill learns: C.**
- A setup interview on first use gets the basics straight away.
- After that the user explicitly asks Claude to undo, change or specialise a choice.
- The docs tell users where their preferences are stored and that they can ask for changes.

## Sixth round (owner, 24 Oct 2026, questionnaire)

- **Overnight contact for severe items.** No default; each user picks it in the setup interview.
- **Dogfooding.** Straight on a real project: the first real run is a milestone of a Rust project, probably its hardening branch.
- **Severity.** hypercode ships a default, language-neutral rubric (a security issue or backdoor is severe, then Critical, Important, Minor). The per-project file adds language-specific notes.
- **Name.** Not "hypercode", which echoes Anthropic's "ultracode". A different name, to be picked.
- **Name: temper.**
  - Tempering is what makes hardened steel stable instead of brittle, which is the MVP → stable step.
  - Rejected: kiln, which clashes with Fredasterehub/kiln, a Claude Code orchestration project, and with Kiln AI.
  - One web search on 24 Oct 2026 found no Claude Code project called temper.
  - Prior art to study in research: oh-my-claudecode (a multi-agent orchestration plugin with modes) and mbruhler/claude-orchestration.

## Approach (owner, 24 Oct 2026)

**Fixed skeleton + plan data.**
- temper ships tested workflow scripts for the run stages: `build.js` (stage 3), `stabilise.js` (stage 4) and `publish.js` (stage 5).
- The head never writes control flow. It fills in data (tasks, contracts, gates, lenses) from the plan and passes it as args.
- Skills: `ground` (wraps superpowers:brainstorming, plus research agents and the epic list), `plan` (wraps superpowers:writing-plans, plus contracts and the dependency graph), `run` (launch, journals, blocked answers, resume, overnight) and `setup` (the first-use interview).
- Hooks: the keyword and a mode warning (UserPromptSubmit), and a statusline script that writes `limits.json`.

**Rejected:**
- generated scripts: new, untested control flow on every run;
- skills only: no replay or resume, and the head's context fills up.
