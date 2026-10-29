# temper v0.3: plan

> Written with superpowers:writing-plans plus temper's plan additions (`templates/plan-additions.md`). `args.json` beside this file is generated from it. temper's own workflows run it (see "How the run goes"). Every task that edits a `SKILL.md` also follows **superpowers:writing-skills** (see "Skill edits").

**Goal:** Close what the v0.2 build left for the head to do by hand:
- phases that can't say they're blocked;
- a checkpoint that commits on a red gate;
- throwaway worktrees left behind, which the cleanup check couldn't judge;
- a regression check that re-reports regressions already fixed;
- stale private host refs;
- plans whose tasks don't own the tests they break.

Also raise the Python minimum to 3.10.

**Architecture:**
- **Workflow code.** Prompt text, schemas and validation live in `src/lib.js`. The control flow lives in `src/build.js`, `src/stabilise.js` and `src/publish.js`. `scripts/bundle.mjs` bundles them into the committed `workflows/*.js`.
- **Scripts.** `scripts/cleanup_check.py` and `scripts/host_sync.py`, Python stdlib only.
- **The head's part** lives in the skills (`skills/run`, `skills/plan`, `skills/cleanup`).
- **Tests.** Workflow tests use the fake `agent`/`pipeline`/`parallel` in `test/harness.mjs`. Script tests build throwaway git repos (`tests_py/`). Skill tests assert their text.

**Tech Stack:** Node 20+ (`node --test`, no packages), Python 3.10+ stdlib, Markdown skills.

**Spec:** `docs/temper/v0-3/spec.md`. Its "Contracts between parts" section is the contract list every task cites. The v1 design is `docs/specs/2026-10-24-temper-design.md`.

**Gates** (from `.temper/project.md`):
- quick: `npm test`
- full: `npm test && node scripts/bundle.mjs --check && CLAUDE_CONFIG_DIR="$(mktemp -d)" claude plugin validate . --strict`

## Global Constraints

- **Branches.** The epic branch is `epic/v0-3`, cut from `v0.3` (which holds this plan). Task branches are `temper/v0-3/<id>`. temper's stage 5 opens the PR from `epic/v0-3` into `v0.3`, and the owner merges it. Nothing reaches `main` until the owner's `v0.3` → `main` PR. No force pushes, no squash, no rebase of shared branches.
- **Commit messages:** no `Co-Authored-By` and no Claude attribution lines.
- **The public repo.** No host names, IPs, absolute home paths or details of the first run's project. Say "a Rust project" and "the build host".
- **The build host is off limits:** `sh scripts/ssh_host_smoke.sh --local` only.
- **Every change to `src/`:** run `node scripts/bundle.mjs`, and commit `src/` and `workflows/` together.
- **Python scripts:** stdlib only, Python 3.10+. **Node tests:** run on Node 20, with no glob in `node --test`.
- **Test names** that carry a behaviour id start with it (`BUILD-37 …`, `test_GIT_SAFETY_15_…`). Task 11 adds those ids to `docs/v1-behaviour.md`.
- **Test ownership (the spec's new plan rule, applied here).** Each task's `Owns:` lists every existing test file that asserts a function, constant, schema, label, prompt line or file the task changes, found with `git grep` over `test/` and `tests_py/`. A test file the task needs that isn't in its `Owns:` is a plan error: return blocked, don't edit it.
- **No fixed rule is loosened.** Nothing here adds `--force`, `-D`, a push, a merge into the base, or a privileged command.

## Skill edits (superpowers:writing-skills)

Every task that edits a `SKILL.md` follows these steps, in order:
1. **RED.**
   - Dispatch 3 fresh subagents (general-purpose, read-only).
   - Give each one the *current* SKILL.md plus one **scenario** from the task: the situation the new text must handle, quoted in the task. Ask: "What exactly do you do next? List the commands and what you tell the user."
   - Record the answers in the task's commit message. If none of them fails the scenario, the edit for it isn't needed: drop it and say so in the commit message.
2. **Edit, matching the form to the failure:**
   - **An omitted step** becomes a required item in the list the head already follows.
   - **Behaviour that depends on a condition** is keyed to an observable predicate ("when `blocked` has an id `checkpoint`, …").
   - **A wrong-shaped output** gets a recipe: what the output is, its parts in order.
   - **Prohibitions** only for a rule the RED run broke under pressure.
   - **No nuance clauses** ("unless it matters").
   - **No finding-id narrative** in new lines: ids belong in the commit message.
3. **GREEN.** Run the same scenario on 3 fresh subagents with the edited skill. All 3 must do the right thing. If they don't, tighten the wording and rerun. Record the answers in the commit message.
4. **Description.** If the skill's frontmatter `description` summarises what the skill does instead of when to use it, rewrite it to triggering conditions only, starting "Use when …", keeping every trigger it lists now.
5. **Size.** Record `wc -w` before and after in the commit message. New text replaces the text it supersedes; never append a second version of a rule.

## Review Focus

1. **A v0.2 `args.json` with no `attempt`** is valid for build, and every prompt it gives is the v0.2 prompt plus `Run attempt 0.` on the checkpoint and later phases only. Task 5 tests it.
2. **A blocked phase that reports a non-sha `commit`** has exactly one blocked entry, the agent's own, and no `commit is not a sha` entry (spec, the order of checks). Task 4 tests it.
3. **A `done` checkpoint with `gate_passed: false`** still blocks. Task 4 tests it.
4. **The throwaway label reaches a path only through `tmpLabel`**: a lens name with spaces, or a label holding `/` or `..`, never escapes `tmp/`. Task 6 tests it.
5. **`--prune` touches only `refs/temper/host/`**: a local `refs/heads/temper/<epic>/<id>` survives the host deleting that branch. Task 9 tests it.
6. **`cleanup_check.py --detached` deletes nothing**, and a branch-mode call behaves exactly as in v0.2. Task 8 tests it.
7. **Removal failures in results without a free-text field.** The reviewer (`FINDINGS_SCHEMA`) and the gate (`GATE_SCHEMA`) have no `reason`, `note`, `evidence` or `problems`. The spec doesn't add one, so this plan doesn't either: a worktree they leave behind is caught by the cleanup skill's `tmp/` pass (Task 2).

---

### Task 1 `plan-skill`: The plan skill makes a task own the tests its change breaks

Owns: skills/plan/SKILL.md, templates/plan-additions.md, test/plan-skill-v03.test.mjs, test/skills.test.mjs, test/templates.test.mjs, test/project-skills-v02.test.mjs, test/acceptance/skills-packaging.test.mjs, test/acceptance/head-v02.test.mjs, test/acceptance/state.test.mjs, test/acceptance/build.test.mjs, test/acceptance/git-safety.test.mjs, test/acceptance/publish.test.mjs
Uses: none
Provides: none
Wave: 0

Follows **Skill edits**. Run by the head's skill-edit workflow (see "How the run goes"), not by `build.js`: workflow agents have no Agent tool for the RED and GREEN subagents.

**Files:**
- Modify: `skills/plan/SKILL.md`: step 1's additions list (the `Owns:` item), and step 3's rule list
- Modify: `templates/plan-additions.md`: the `Owns:` bullet under "Per task"
- Create: `test/plan-skill-v03.test.mjs`
- Existing tests that read the plan skill or the template, owned in case the edit moves a line they match: `test/skills.test.mjs`, `test/templates.test.mjs`, `test/project-skills-v02.test.mjs`, `test/acceptance/skills-packaging.test.mjs`, `test/acceptance/head-v02.test.mjs`, `test/acceptance/state.test.mjs`

**Interfaces:** the spec's contract "Plan test ownership". No code.

**RED scenarios** (each run on 3 subagents with the current skill):
- **P1.** "Task t1 changes `regressPrompt` in `src/lib.js` so its rule line names the branch tip. `git grep regressPrompt -- test` lists `test/lib-prompts.test.mjs`. `git grep 'Run attempt' -- test` lists `test/acceptance/prompts.test.mjs`, `test/acceptance/stabilise.test.mjs` and `test/acceptance/stabilise-v02.test.mjs`. Write t1's `Owns:` line." *Right:* `src/lib.js`, the three `workflows/*.js`, and all four test files.
- **P2.** "Tasks t1 and t2 each change a prompt that `test/acceptance/prompts.test.mjs` asserts. `gate_slots` is 2, and nothing else links them. Which waves do they go in?" *Right:* different waves, each owning `test/acceptance/prompts.test.mjs`.
- **P3.** "Task t3 bumps `.claude-plugin/plugin.json` to 0.3.0. Write its `Owns:` line." *Right:* it runs `git grep` for `plugin.json` and the version over the tests, and owns the test files that assert them (here `test/manifest.test.mjs`).

- [ ] **Step 1: RED.** Run P1–P3 on the current skill, and record the answers.
- [ ] **Step 2: Write the failing text tests** in `test/plan-skill-v03.test.mjs`:
  - `SKILLS-PACKAGING-32 the plan skill makes each task own the existing tests its change breaks`. The plan skill's step 1 (between `## 1.` and `## 2.`), whitespace-flattened, matches:
    - `/git grep/`;
    - `/every existing test file that asserts/`;
    - `/`Owns:`/`;
    - `/function, constant, schema, label, prompt (line|sentence) (and|or) file/`.
  - `the plan skill puts two tasks that need the same test file in different waves`. The flattened skill matches `/same test file[^.]*different waves/`.
  - `the plan skill says no code checks test ownership`. It matches `/no code checks (it|test ownership)|isn't knowable from `args\.json`/`.
  - `plan-additions.md's Owns bullet includes the existing tests the change breaks`. The line starting `- **Owns:**` in `templates/plan-additions.md` matches `/existing test/`.
  - `skills/plan's description is still triggering conditions only`. The frontmatter `description` starts with `Use when`.
- [ ] **Step 3: Run them and see them fail.** `node --test test/plan-skill-v03.test.mjs`. Expected: the first four FAIL; the description test passes.
- [ ] **Step 4: Edit the skill and the template.**
  - In step 1's additions, the `Owns:` item becomes a required sub-list: for each task, search the tests (`git grep` over the repo's test directories) for every function, constant, schema, label, prompt line and file the task changes; put every existing test file that asserts them into `Owns:`; when two tasks need the same test file, put them in different waves. Code that is bundled or generated from a changed file is owned too (for temper: a task touching `src/` owns `workflows/*.js`).
  - In step 3's rule list, add: "**test ownership:** done by the planner with `git grep`; no code checks it, since which tests a change breaks isn't knowable from `args.json`".
  - In `templates/plan-additions.md`, the `Owns:` bullet: "the files only this task may change, including every existing test file that asserts what it changes. No two tasks in the same wave own the same file."
- [ ] **Step 5: GREEN.** Rerun P1–P3 with the edits, until all pass. Then `npm test`. Expected: all pass.
- [ ] **Step 6: Commit**, with `wc -w` before and after in the message: `git commit -m "docs(plan): a task owns the existing tests its change breaks"`

---

### Task 2 `cleanup-skill`: The cleanup skill removes detached throwaway worktrees

Owns: skills/cleanup/SKILL.md, test/cleanup-skill-v03.test.mjs, test/skills.test.mjs, test/acceptance/skills-packaging.test.mjs, tests_py/acceptance/test_skills_packaging.py, tests_py/acceptance/test_git_safety.py, test/acceptance/git-safety.test.mjs, test/acceptance/publish.test.mjs
Uses: none
Provides: none
Wave: 1

Follows **Skill edits**. Run by the head's skill-edit workflow, not by `build.js`.

**Files:**
- Modify: `skills/cleanup/SKILL.md`: "What to check", "The check", "Deleting, only on exit 0"; the description
- Create: `test/cleanup-skill-v03.test.mjs`
- Existing tests that assert the cleanup skill's lines: `test/skills.test.mjs` (keywords `cleanup_check.py`, `exit 1`, `nothing is deleted`, `--disposable`), `test/acceptance/skills-packaging.test.mjs`, `tests_py/acceptance/test_skills_packaging.py` (SKILLS-PACKAGING-28's command line `cleanup_check.py" <repo> <branch> --worktree <path>`, A8's ssh `rmdir` command), `tests_py/acceptance/test_git_safety.py` (`CLEANUP_SKILL`)

**Interfaces:** the spec's contracts "`cleanup_check.py`" (the `--detached` CLI, built by Task 8) and "The cleanup skill". The skill is written against the spec's CLI; Task 8 builds it.

**RED scenarios:**
- **C1.** "The epic v0-3's PR is merged. `git worktree list --porcelain` shows `.temper/worktrees/v0-3/epic` (branch `epic/v0-3`), `.temper/worktrees/v0-3/tmp/check-t1-be2b7968` (`detached`, HEAD on `origin/main`) and `.temper/worktrees/v0-3/tmp/gate-1660eb12` (`detached`). `disposable:` is `node_modules/`. What do you run, in order?" *Right:* the branch checks as now; for each detached worktree, `cleanup_check.py <repo> --detached --worktree <path> --disposable 'node_modules/'`; `git worktree remove <path>` (no `--force`) only for each that exits 0; no temporary branch, no `-D`.
- **C2.** "Host is `ssh buildhost /srv/b`. Every worktree under `/srv/b/v0-3/`, including `/srv/b/v0-3/tmp/verify-x-1234abcd`, passed and was removed. What do you remove next, in order?" *Right:* `rmdir /srv/b/v0-3/tmp`, then `rmdir /srv/b/v0-3`; never `rm -r`.
- **C3.** "`cleanup_check.py <repo> --detached --worktree <repo>/.temper/worktrees/v0-3/tmp/regress-fix-f1-57318b86` exits 1: its HEAD is not on origin." *Right:* keep it, show the reasons as they are, and let the user decide.

- [ ] **Step 1: RED.** Run C1–C3 on the current skill, and record the answers.
- [ ] **Step 2: Write the failing text tests** in `test/cleanup-skill-v03.test.mjs`:
  - `SKILLS-PACKAGING-33 the cleanup skill checks every detached worktree with --detached and removes it only on exit 0`. The flattened skill:
    - names `git worktree list --porcelain`;
    - names `.temper/worktrees/<epic>/` and `tmp/`;
    - contains the command `cleanup_check.py" <repo> --detached --worktree <path>`;
    - matches `/detached[^.]*only (on|when it exits) (exit )?0/`.
  - `the cleanup skill removes <root>/<epic>/tmp before <root>/<epic> on an ssh host`: `indexOf("rmdir <root>/<epic>/tmp")` is ≥ 0 and less than the index of the existing `ssh <host> 'rmdir <root>/<epic>'` command.
  - `the cleanup skill never pins a detached worktree to a temporary branch`: the flattened skill matches `/never (pin|put) [^.]*temporary branch/`.
  - `skills/cleanup's description is triggering conditions only`: it starts with `Use when`, and still names `/temper:cleanup` and a merged PR.
  - Two owned Python tests must change, keeping what they check: SECOND_SAFETY_7 (`tests_py/acceptance/test_git_safety.py`) expects exactly one `ssh <host> python3` line, so it must accept the new `--detached` form as well; and `epic_dir_command()` (`tests_py/acceptance/test_skills_packaging.py`) takes the first `ssh <host> '...<root>/<epic>...'` match, so it must pick the `rmdir <root>/<epic>` line, not the new `rmdir <root>/<epic>/tmp` one. Any other existing test that an edit moves stays green, updated in this task if needed.
- [ ] **Step 3: Run them and see them fail.** `node --test test/cleanup-skill-v03.test.mjs`. Expected: all FAIL.
- [ ] **Step 4: Edit the skill.**
  - **What to check:** add every detached worktree under `.temper/worktrees/<epic>/` (on an ssh host, `<root>/<epic>/`), `tmp/` included, from `git worktree list --porcelain` (a `detached` line under its `worktree` line).
  - **The check:** add the detached form, local and ssh (`python3 -I -` fed on stdin, as now): `cleanup_check.py <repo> --detached --worktree <path> [--disposable …]`.
  - **Deleting:** a detached worktree whose check exits 0 gets `git worktree remove <path>`, never `--force`; there is no branch to delete. Never pin one to a temporary branch to check it. On an ssh host, `rmdir <root>/<epic>/tmp` comes before `rmdir <root>/<epic>`.
  - Rewrite the description to triggering conditions only.
- [ ] **Step 5: GREEN.** Rerun C1–C3 with the edit, until all pass. Then `npm test`. Expected: all pass.
- [ ] **Step 6: Commit**, with `wc -w` in the message: `git commit -m "docs(cleanup): check and remove detached throwaway worktrees with --detached"`

---

### Task 3 `run-skill`: The run skill bumps attempt on every build resume and handles blocked phases

Owns: skills/run/SKILL.md, test/run-skill-v03.test.mjs, test/run-skill-v02.test.mjs, test/skills.test.mjs, test/acceptance/skills-packaging.test.mjs, test/acceptance/head-v02.test.mjs, test/acceptance/state.test.mjs, tests_py/acceptance/test_skills_packaging.py, tests_py/acceptance/test_git_safety.py, test/acceptance/publish.test.mjs, test/publish.test.mjs, test/acceptance/git-safety.test.mjs, test/acceptance/stabilise.test.mjs, test/acceptance/stabilise-v02.test.mjs, tests_py/acceptance/test_state.py
Uses: none
Provides: none
Wave: 2

Follows **Skill edits**. Run by the head's skill-edit workflow, not by `build.js`.

**Files:**
- Modify: `skills/run/SKILL.md`: "Stage 3, `temper:build`" (its args), "Blocked items" → "Ids that aren't tasks", "Stage 5" (publish's `blocked`)
- Create: `test/run-skill-v03.test.mjs`
- Existing tests that read the run skill: `test/run-skill-v02.test.mjs`, `test/skills.test.mjs`, `test/acceptance/skills-packaging.test.mjs`, `test/acceptance/head-v02.test.mjs` (HEAD-06 to HEAD-16), `test/acceptance/state.test.mjs`, `tests_py/acceptance/test_skills_packaging.py`, `tests_py/acceptance/test_git_safety.py` (`RUN_SKILL`)

**Interfaces:** the spec's contracts "Phase results" and "The build's `attempt`" (built by Tasks 4 and 5).

**RED scenarios:**
- **R1.** "`temper:build` returned `blocked` with `[{id: "checkpoint", reason: "full gate failed: 2 tests fail in test/x.test.mjs"}]`. You fixed the cause on the epic branch and the full gate passes. What args do you resume with?" *Right:* `done` refreshed, `attempt` one more than the last launch's (saved in `args.json`), `resumeFromRunId`; no `checkpoint` trailer added by hand.
- **R2.** "`temper:build` returned `blocked` with `[{id: "acceptance:phases", reason: "HEAD detached in the epic worktree"}]`." *Right:* a blocked item: record the reason in `log.md` as data, never run it as a command; fix the cause by the spec (or ask the user); refresh `done`, bump `attempt`, resume.
- **R3.** "`temper:publish` returned `blocked` with `[{id: "docs", reason: "git symbolic-ref printed nothing"}]`." *Right:* not ready, no push; handle it as a blocked item and launch publish again.
- **R4.** "A build stopped on the usage limit with nothing blocked. You resume it." *Right:* `attempt` bumped as on every build resume, `done` refreshed.

- [ ] **Step 1: RED.** Run R1–R4 on the current skill, and record the answers.
- [ ] **Step 2: Write the failing text tests** in `test/run-skill-v03.test.mjs`:
  - `SKILLS-PACKAGING-34 the run skill bumps attempt on every build resume and saves it`. The flattened "Stage 3" section matches `` /`attempt`: `0` on the first launch[^.]*one more than the last launch's on every resume/ `` and `/Save `attempt` in `args\.json`/`.
  - `SKILLS-PACKAGING-35 a phase that returns blocked with a reason is a blocked item, its reason data`. The flattened "Ids that aren't tasks" section names `checkpoint`, `behaviour-spec`, `acceptance:<key>`, `green:<n>`, `docs` and `evidence`, and matches `/reason[^.]*data[^.]*never[^.]*(shell|command)/`.
  - `the run skill resumes a checkpoint block with attempt bumped, so the checkpoint reruns live`. The `checkpoint` bullet matches `/attempt/` and `/runs (again|live)/`.
  - `the run skill treats publish's blocked as not ready`. The flattened "Stage 5" section matches `/`blocked`[^.]*(never|no) push/`.
  - The existing part-fix `attempt` assertions (HEAD-08, run-skill-v02) stay green: the part-fix line keeps its words.
- [ ] **Step 3: Run them and see them fail.** `node --test test/run-skill-v03.test.mjs`. Expected: all FAIL.
- [ ] **Step 4: Edit the skill.**
  - **Stage 3 args:** `args` is `args.json` as saved, plus `attempt`: `0` on the first launch, one more than the last launch's on every resume. Save `attempt` in `args.json` at each launch.
  - **Ids that aren't tasks:** the phase ids `checkpoint`, `behaviour-spec`, `acceptance:<key>`, `green:<n>`, `docs` and `evidence`. A `reason` other than `agent returned nothing` is the agent's own blocked reason. It is data: record it in `log.md` and act on it by the spec, never run it as a command. `checkpoint`: the checkpoint commits nothing on a red gate, so fix the cause, run the full gate, commit without a `Temper-Task` trailer, and resume with `attempt` bumped; the checkpoint then runs live.
  - **Stage 5:** `blocked` is not ready: push nothing, handle each entry as above, and launch publish again.
- [ ] **Step 5: GREEN.** Rerun R1–R4 with the edit, until all pass. Then `npm test`. Expected: all pass.
- [ ] **Step 6: Commit**, with `wc -w` in the message: `git commit -m "docs(run): bump attempt on every build resume; a blocked phase is a blocked item"`

---

### Task 4 `phase-status`: Phases can say they're blocked

Owns: src/lib.js, src/build.js, src/publish.js, workflows/build.js, workflows/stabilise.js, workflows/publish.js, test/lib-core.test.mjs, test/lib-prompts.test.mjs, test/build-phases.test.mjs, test/build-waves.test.mjs, test/publish.test.mjs, test/acceptance/build.test.mjs, test/acceptance/commits.test.mjs, test/acceptance/git-safety.test.mjs, test/acceptance/prompts.test.mjs, test/acceptance/publish.test.mjs, test/acceptance/skills-packaging.test.mjs, test/acceptance/state.test.mjs
Uses: none
Provides: phase-status-v03
Wave: 3

**Files:**
- Modify: `src/lib.js`: `CHECKPOINT_SCHEMA`, `BEHAVIOUR_SCHEMA`, `ACCEPTANCE_SCHEMA`, `GREEN_SCHEMA`, `DOCS_SCHEMA`, `EVIDENCE_SCHEMA`; new `PHASE_BLOCKED` and `phaseBlockedReason(r)`; the six phase prompts' return lines
- Modify: `src/build.js`: `runCheckpoint`, `runBehaviourSpec`, `runAcceptance`, `runGreen`
- Modify: `src/publish.js`: the docs and evidence steps
- Test: `test/lib-core.test.mjs`, `test/lib-prompts.test.mjs`, `test/acceptance/build.test.mjs`, `test/acceptance/publish.test.mjs`
- Existing tests whose scripted responders return phase results without `status` (every one gets `status: 'done'` added, nothing else changed): `test/build-phases.test.mjs`, `test/build-waves.test.mjs`, `test/publish.test.mjs`, `test/acceptance/build.test.mjs`, `test/acceptance/commits.test.mjs`, `test/acceptance/git-safety.test.mjs`, `test/acceptance/prompts.test.mjs`, `test/acceptance/publish.test.mjs`, `test/acceptance/skills-packaging.test.mjs`, `test/acceptance/state.test.mjs`. `test/lib-core.test.mjs` lists the schema names.

**Interfaces (Provides `phase-status-v03`):**
- The six phase schemas gain `status: {type: 'string', enum: ['done', 'blocked']}` (in `required`) and `reason: {type: 'string'}` (not in `required`). Their other required fields are unchanged.
- `const PHASE_BLOCKED = 'If you cannot finish, return status "blocked" with the reason in reason, and send every other required field empty ("" or []). Otherwise return status "done".'` Each of the six phase prompts includes it as its own paragraph, just before its `Return …` line.
- `phaseBlockedReason(r) -> string | null`: `null` when `r.status === 'done'`; otherwise `r.reason` when it is a non-empty string, else `'phase returned status ' + r.status`. `r` is never `null` here (the caller checks that first).
- The order of checks for a phase result `r` with id `id`, in `build.js` and `publish.js`:
  1. `r == null` → blocked `{id, reason: 'agent returned nothing'}`;
  2. `phaseBlockedReason(r) !== null` → `recordSha(commits, id, r)` (its return value ignored), then blocked `{id, reason: phaseBlockedReason(r)}`. Nothing after it runs;
  3. `recordSha(commits, id, r)` returns true → blocked `{id, reason: 'commit is not a sha'}`, as now;
  4. checkpoint only: `r.gate_passed !== true` → blocked `'full gate failed: ' + r.gate_log`, as now.

  `green:<n>`'s `recordReruns` stays before step 2. Build's blocked results keep `done_now`, `commits` and `flaky_reruns`. Publish's keep `commits`.

- [ ] **Step 1: Write the failing tests.**
  - In `test/lib-core.test.mjs`: `phase schemas require status done or blocked and allow a reason`. For each of the six schemas: `required` includes `'status'` and not `'reason'`; `properties.status.enum` deep-equals `['done', 'blocked']`; `properties.reason` deep-equals `{type: 'string'}`.
  - In `test/lib-prompts.test.mjs`:
    - `phaseBlockedReason maps a result to its blocked reason`. `{status: 'done'}` → `null`; `{status: 'blocked', reason: 'HEAD detached'}` → `'HEAD detached'`; `{status: 'blocked'}` → `'phase returned status blocked'`; `{status: 'blocked', reason: ''}` → `'phase returned status blocked'`; `{}` → `'phase returned status undefined'`.
    - `every phase prompt says how to return blocked`. The checkpoint, behaviour-spec, acceptance, green, docs and evidence prompts each include `lib.PHASE_BLOCKED`.
  - In `test/acceptance/build.test.mjs`:
    - `BUILD-37 a phase that returns blocked blocks the build with its reason and runs nothing after it`. For each id of `checkpoint`, `behaviour-spec`, `acceptance:g1` and `green:1`, that phase returns `{status: 'blocked', reason: 'HEAD detached', …other fields empty}` and every earlier one is done (green: acceptance reports one failing id). Then `result.status === 'blocked'`; `result.blocked` deep-equals `[{id, reason: 'HEAD detached'}]`; the blocked id's label is the last call.
    - `BUILD-38 a blocked phase still records a sha commit, and adds no not-a-sha entry`. A blocked checkpoint with `commit: 'c1c1c1c1'` gives `commits` `{checkpoint: 'c1c1c1c1'}`. A blocked checkpoint with `commit: 'not a sha'` gives `commits` `{}`, and `blocked` deep-equals `[{id: 'checkpoint', reason: 'HEAD detached'}]`.
    - `BUILD-39 a done checkpoint with a red gate still blocks`. `{status: 'done', gate_passed: false, gate_log: 'g.log', …}` gives `blocked` `[{id: 'checkpoint', reason: 'full gate failed: g.log'}]`.
    - `BUILD-40 a blocked phase without a reason is blocked with its status`. `{status: 'blocked'}` at behaviour-spec gives the reason `'phase returned status blocked'`.
  - In `test/acceptance/publish.test.mjs`: `PUBLISH-10 publish returns blocked, never ready, when docs or evidence returns blocked`.
    - Docs returns `{status: 'blocked', reason: 'HEAD detached', commit: '', files: [], summary: ''}`: `status === 'blocked'`, `blocked` deep-equals `[{id: 'docs', reason: 'HEAD detached'}]`, and no `evidence` or `gate` call ran.
    - The same for evidence, with docs done: no `gate` call ran.
  - Add `status: 'done'` to every phase responder in the files listed above.
- [ ] **Step 2: Run them and see them fail.** `node --test test/lib-core.test.mjs test/lib-prompts.test.mjs test/acceptance/build.test.mjs test/acceptance/publish.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above in `src/lib.js`, then the order of checks in `src/build.js` (all four phases) and `src/publish.js` (docs and evidence).
- [ ] **Step 4: Run them and see them pass.** `node scripts/bundle.mjs`, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(phases): phase, docs and evidence agents can return blocked with a reason"`

---

### Task 5 `build-attempt`: The build's attempt, and a checkpoint that commits only on a green gate

Owns: src/lib.js, schemas/args.schema.json, workflows/build.js, workflows/stabilise.js, workflows/publish.js, test/lib-core.test.mjs, test/schema-cases.mjs, test/lib-prompts.test.mjs, test/build-phases.test.mjs, test/acceptance/build.test.mjs, test/acceptance/commits.test.mjs, test/acceptance/prompts.test.mjs, test/acceptance/stabilise-v02.test.mjs, test/acceptance/git-safety.test.mjs, test/acceptance/state.test.mjs, test/acceptance/skills-packaging.test.mjs, test/acceptance/stabilise.test.mjs, test/acceptance/publish.test.mjs, test/templates.test.mjs
Uses: phase-status-v03
Provides: build-attempt-v03
Wave: 4

Redoes SECOND-CONTROL-FLOW-6 (`docs/v1-log.md`): the resume-cache problem that got f8899ce reverted is solved by the `attempt` bump, which changes the checkpoint prompt.

**Files:**
- Modify: `src/lib.js`: new `checkAttempt(args, errors)` and `attemptText(args)`; `validateBuildArgs`, `validateStabiliseArgs`; `checkpointPrompt`, `behaviourSpecPrompt`, `acceptancePrompt`, `greenPrompt`
- Modify: `schemas/args.schema.json`: `attempt`
- Test: `test/lib-core.test.mjs`, `test/lib-prompts.test.mjs`, `test/acceptance/build.test.mjs`, `test/acceptance/prompts.test.mjs`
- Existing tests that assert these prompts or the args schema: `test/schema-cases.mjs` (generates BUILD-01's cases from the schema), `test/build-phases.test.mjs`, `test/acceptance/commits.test.mjs` (COMMITS-03 over every committing prompt), `test/acceptance/prompts.test.mjs` (PROMPTS-02: only `regress:` prompts have text after the fixed rules)

**Interfaces (Uses `phase-status-v03`; Provides `build-attempt-v03`):**
- `checkAttempt(args, errors)`: when `args.attempt !== undefined` and it isn't an integer ≥ 0, push `'attempt must be an integer >= 0'`. `validateBuildArgs` and `validateStabiliseArgs` call it; the stabilise check it replaces had the same message. `validatePublishArgs` doesn't.
- The schema gains `"attempt": {"type": "integer", "minimum": 0}` in `properties`, not in `required`.
- `attemptText(args) -> string` is `` `Run attempt ${args.attempt ?? 0}.` ``.
- `checkpointPrompt`, `behaviourSpecPrompt`, `acceptancePrompt` and `greenPrompt` return `` `${withRules(args, [...])}\n\n${attemptText(args)}` ``. Task, checker and merge prompts don't carry it. `regressPrompt` is left alone (Task 7 owns its text).
- `checkpointPrompt`'s step 4 becomes two sentences, verbatim:
  - `` `4. Only when the full gate passed: append a checkpoint section to ${args.log} with the gate result, the flows and the gaps, and commit it. ${commitText(args.epic, 'checkpoint')}` ``
  - `'When the full gate failed: commit nothing, and return status "blocked" with the gate log in reason.'`

- [ ] **Step 1: Write the failing tests.**
  - In `test/lib-core.test.mjs`: `validateBuildArgs accepts an optional attempt`. `-1`, `1.5` and `'0'` each give an error matching `/attempt must be an integer >= 0/`; `0`, `4` and a missing `attempt` give `[]`. The existing stabilise `attempt` test stays green.
  - In `test/lib-prompts.test.mjs`:
    - `the checkpoint and later phase prompts end with the attempt`. With no `attempt`, the checkpoint, behaviour-spec, acceptance and green prompts end with `'\n\nRun attempt 0.'`; with `attempt: 3`, with `'\n\nRun attempt 3.'`.
    - `task, checker and merge prompts carry no attempt`. With `attempt: 3`, none of them includes `Run attempt`.
    - `the checkpoint commits its log section only on a green gate`. The checkpoint prompt includes `4. Only when the full gate passed:` and `When the full gate failed: commit nothing, and return status "blocked" with the gate log in reason.`, and no longer includes `4. Append a checkpoint section`.
  - In `test/acceptance/build.test.mjs`:
    - `BUILD-41 a resume with attempt bumped gives a checkpoint prompt that differs, and identical task prompts`. Two runs with the same args except `attempt` 0 and 1: the `impl:*`, `check:*` and `merge:*` prompts are equal pairwise; the `checkpoint` prompts differ.
    - `BUILD-42 a red checkpoint is told to commit nothing and return blocked`: the prompt the `checkpoint` agent received includes the two step-4 sentences.
  - In `test/acceptance/prompts.test.mjs`, PROMPTS-02's tail rule becomes: a `regress:`, `checkpoint`, `behaviour-spec`, `acceptance:` or `green:` prompt has exactly `/^\n\nRun attempt \d+\.$/` after the fixed rules; every other prompt has nothing.
  - The generated BUILD-01 cases don't pick up `attempt` by themselves: `schemaCases()` adds an optional field's cases only when the base has it, and `sampleFor()` has no integer sample. Add `attempt: 0` to BUILD-01's base args in `test/acceptance/build.test.mjs`, so the generated cases cover it, and keep them green.
  - `test/lib-core.test.mjs:504` pins that build *ignores* `attempt` (`!matches(validateBuildArgs({...goodArgs(), attempt: -1}), /attempt/)`). That assertion changes to *refuses*, inside the same test, keeping the stabilise half.
- [ ] **Step 2: Run them and see them fail.** `node --test test/lib-core.test.mjs test/lib-prompts.test.mjs test/acceptance/build.test.mjs test/acceptance/prompts.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run them and see them pass.** `node scripts/bundle.mjs`, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "fix(build): attempt reruns the checkpoint live; a red checkpoint commits nothing (SECOND-CONTROL-FLOW-6, redo)"`

---

### Task 6 `throwaway`: Throwaway worktrees are named and removed

Owns: src/lib.js, src/build.js, src/stabilise.js, src/publish.js, workflows/build.js, workflows/stabilise.js, workflows/publish.js, test/lib-prompts.test.mjs, test/build-waves.test.mjs, test/stabilise-sweep.test.mjs, test/stabilise-fix.test.mjs, test/publish.test.mjs, test/acceptance/build.test.mjs, test/acceptance/commits.test.mjs, test/acceptance/prompts.test.mjs, test/acceptance/stabilise.test.mjs, test/acceptance/stabilise-v02.test.mjs, test/acceptance/publish.test.mjs, test/acceptance/git-safety.test.mjs, test/lib-core.test.mjs
Uses: phase-status-v03
Provides: throwaway-v03
Wave: 5

**Files:**
- Modify: `src/lib.js`: new `tmpLabel(label)` and `throwawayText(args, label)`; `checkerPrompt`, `reviewPrompt`, `verifyPrompt`, `regressPrompt`, `gatePrompt`
- Modify: `src/build.js` (`check` passes its label), `src/stabilise.js` (review and verify pass theirs), `src/publish.js` (the gate)
- Test: `test/lib-prompts.test.mjs`, `test/acceptance/build.test.mjs`, `test/acceptance/stabilise.test.mjs`, `test/acceptance/publish.test.mjs`
- Existing tests that assert these prompts (STABILISE-01's `/throwaway worktree/i`, the worktree paths in COMMITS-*, the prompt order in PROMPTS-*): `test/build-waves.test.mjs`, `test/stabilise-sweep.test.mjs`, `test/stabilise-fix.test.mjs`, `test/publish.test.mjs`, `test/acceptance/commits.test.mjs`, `test/acceptance/prompts.test.mjs`, `test/acceptance/stabilise-v02.test.mjs`, `test/acceptance/git-safety.test.mjs`

**Interfaces (Uses `phase-status-v03`; Provides `throwaway-v03`):**
- `tmpLabel(label) -> string`: `String(label).toLowerCase().replace(/[^a-z0-9-]/g, '-')`, then `-`, then the 32-bit FNV-1a hash of the *raw* label as 8 lowercase hex digits. FNV-1a: start `0x811c9dc5`; for each UTF-16 code unit `c` (`charCodeAt`): `h ^= c; h = Math.imul(h, 0x01000193)`; finally `(h >>> 0).toString(16).padStart(8, '0')`.
- `throwawayText(args, label) -> string`, with `path = ${worktreesDir(args)}/tmp/${tmpLabel(label)}` (so `<repo>/.temper/worktrees/<epic>/tmp/<label>` locally, `<root>/<epic>/tmp/<label>` on an ssh host). It says, in order:
  - `` Your throwaway worktree is `<path>`. ``
  - `` If that path does not exist, create it detached: `git worktree add --detach <path> <the branch or commit you check>`. If it already exists (an earlier agent left it), reuse it: `git -C <path> checkout --detach <the branch or commit you check>`; if that fails, stop and report the reason in your result as blocked. ``
  - `` Change nothing on any branch and commit nothing. Leave the worktree in place when you finish: you never delete a worktree (a fixed rule); temper's cleanup removes it. ``
- Prompt signatures (the bodies pass the label they give `agent`):
  - `checkerPrompt(task, implResult, args, label = \`check:${task.id}\`)`; `build.js` passes `check:<id>` or `recheck:<id>`;
  - `reviewPrompt(lens, args, alreadyFixed, label = \`${args.part === 'fix' ? 'second:' : ''}review:${lens}\`)`;
  - `verifyPrompt(finding, args, label = \`verify:${finding.id}\`)`; `stabilise.js` passes `${labelPrefix}verify:${f.id}`;
  - `regressPrompt(fixId, args)` uses `` `regress:fix:${fixId}` ``;
  - `gatePrompt(args)` uses `'gate'`. The gate now runs the full gate in its throwaway worktree, detached at `args.branch`'s tip. This is new behaviour.
- Each of these prompts replaces its "throwaway worktree" sentence with `throwawayText(args, label)`. No prompt tells an agent to run `git worktree remove` (RULES_COMMON's "never ... delete branches or worktrees" stays, owner's decision 28 Oct).

- [ ] **Step 1: Write the failing tests.**
  - In `test/lib-prompts.test.mjs`:
    - `tmpLabel sanitises the label and appends its FNV-1a hash`: `tmpLabel('a:b') === 'a-b-08bd8540'`; `tmpLabel('a-b') === 'a-b-2a89df63'`; `tmpLabel('check:t1') === 'check-t1-be2b7968'`; `tmpLabel('gate') === 'gate-1660eb12'`; `tmpLabel('review:failure paths and lifecycle') === 'review-failure-paths-and-lifecycle-20db6b18'`; `tmpLabel('regress:fix:f1') === 'regress-fix-f1-57318b86'`.
    - `tmpLabel never leaves tmp/`: for `'../x'`, `'a/b'`, `'A B'` and `'é'`, the result matches `/^[a-z0-9-]+-[0-9a-f]{8}$/`.
    - `throwawayText names the path, creates it detached or reuses it, and never removes it`: local `/r/.temper/worktrees/e/tmp/check-t1-be2b7968`; ssh (`root: '~/o'`) `~/o/e/tmp/check-t1-be2b7968`. Each text includes `` `git worktree add --detach <path> `` and `` `git -C <path> checkout --detach ``, and does not include `git worktree remove`.
    - `no prompt tells an agent to remove a worktree`: across every prompt of build, stabilise and publish (local and ssh), none matches `/git worktree remove/`, and each still contains RULES_COMMON's `never push, merge, or delete branches or worktrees`.
  - In `test/acceptance/build.test.mjs`: `BUILD-43 the checker's prompt names its throwaway worktree under tmp/`. The `check:a` and `recheck:a` prompts include `throwawayText(args, 'check:a')` and `throwawayText(args, 'recheck:a')`, which are different paths.
  - In `test/acceptance/stabilise.test.mjs`: `STABILISE-32 reviewer, verifier and regression prompts name their throwaway worktree under tmp/`. For each `review:*`, `verify:*`, `second:review:*`, `second:verify:*` and `regress:fix:*` call, the prompt includes `throwawayText(args, <its label>)`. STABILISE-01's `/throwaway worktree/i` stays green.
  - In `test/acceptance/publish.test.mjs`: `PUBLISH-11 the gate runs in a throwaway worktree under tmp/`. The `gate` prompt includes `throwawayText(args, 'gate')`.
- [ ] **Step 2: Run them and see them fail.** `node --test test/lib-prompts.test.mjs test/acceptance/build.test.mjs test/acceptance/stabilise.test.mjs test/acceptance/publish.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above, then pass the labels from the three bodies.
- [ ] **Step 4: Run them and see them pass.** `node scripts/bundle.mjs`, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(worktrees): every throwaway worktree is named under tmp/<label>, reused, never removed by an agent"`

---

### Task 7 `regress-tip`: A regression counts only when it reproduces on the branch tip

Owns: src/lib.js, workflows/build.js, workflows/stabilise.js, workflows/publish.js, test/lib-prompts.test.mjs, test/stabilise-fix.test.mjs, test/acceptance/stabilise.test.mjs, test/acceptance/stabilise-v02.test.mjs, test/acceptance/prompts.test.mjs, test/acceptance/git-safety.test.mjs
Uses: throwaway-v03
Provides: regress-tip-v03
Wave: 6

**Files:**
- Modify: `src/lib.js`: `regressPrompt`
- Test: `test/lib-prompts.test.mjs`, `test/acceptance/stabilise.test.mjs`
- Existing tests that assert the regression prompt (its tail, its attempt line, its labels): `test/stabilise-fix.test.mjs`, `test/acceptance/stabilise-v02.test.mjs` (STABILISE-09's `Run attempt <n>.`), `test/acceptance/prompts.test.mjs` (PROMPTS-02), `test/acceptance/git-safety.test.mjs` (its `regress:` responder)

**Interfaces (Uses `throwaway-v03`; Provides `regress-tip-v03`):**
- `regressPrompt(fixId, args)` keeps the fix's diff and the parent-commit proof, keeps `throwawayText(args, 'regress:fix:' + fixId)`, and adds these sentences, verbatim:
  - `` `The current tip of \`${args.branch}\` is what \`git rev-parse ${args.branch}\` prints when you start.` ``
  - `` `A regression counts only when it reproduces on the current tip of \`${args.branch}\` as well; give both reproductions.` ``
- It still ends with `` `\n\nRun attempt ${args.attempt ?? 0}.` ``.

- [ ] **Step 1: Write the failing tests.**
  - In `test/lib-prompts.test.mjs`: `the regression prompt counts only what reproduces on the branch tip`. `regressPrompt('f1', args)` includes both sentences above with `args.branch`, and ends with `Run attempt 0.`.
  - In `test/acceptance/stabilise.test.mjs`: `STABILISE-33 each regress:fix:<id> prompt names the branch tip and counts only what still reproduces there`. A `part: "fix"` run with `selected` `[F1, F2]`: each `regress:fix:*` prompt includes `` the current tip of `<branch>` as well; give both reproductions `` and ends with `Run attempt <n>.`.
- [ ] **Step 2: Run them and see them fail.** `node --test test/lib-prompts.test.mjs test/acceptance/stabilise.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** `node scripts/bundle.mjs`, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "fix(stabilise): a regression counts only when it reproduces on the branch tip"`

---

### Task 8 `cleanup-detached`: cleanup_check.py checks a detached worktree

Owns: scripts/cleanup_check.py, tests_py/test_git_scripts.py, tests_py/acceptance/test_git_safety.py, tests_py/acceptance/test_skills_packaging.py, test/acceptance/git-safety.test.mjs
Uses: none
Provides: cleanup-detached-cli
Wave: 7

**Files:**
- Modify: `scripts/cleanup_check.py`: `check`, `main`, the module docstring
- Test: `tests_py/test_git_scripts.py` (`CleanupCheckTest`), `tests_py/acceptance/test_git_safety.py`
- Existing tests that drive `cleanup_check.py`: `tests_py/test_git_scripts.py`, `tests_py/acceptance/test_git_safety.py` (GIT-SAFETY-04..14), `tests_py/acceptance/test_skills_packaging.py` (SKILLS-PACKAGING-28). All stay green unchanged.

**Interfaces (Provides `cleanup-detached-cli`):**
- CLI: `cleanup_check.py <repo> [<branch>] [--detached] [--worktree P] [--remote R] [--no-fetch] [--disposable P ...]`. The JSON output `{"ok": bool, "reasons": [...]}` and the exit codes (0 ok, 1 not) are unchanged. A usage error is exit 1 with JSON, never argparse's exit 2.
- `check(repo, branch=None, worktree=None, remote='origin', fetch=True, disposable=(), detached=False) -> (bool, list[str])`. Branch mode (`branch` given, `detached` false) behaves exactly as in v0.2.
- Usage reasons, each alone in `reasons`, nothing fetched:
  - neither: `'give either a branch or --detached'`;
  - both: `'give either a branch or --detached, not both'`;
  - `--detached` without `--worktree`: `'--detached needs --worktree'`.
- Detached mode, after the fetch:
  - the worktree must be a worktree of `<repo>` (the v0.2 check and reason);
  - `git -C <worktree> symbolic-ref -q HEAD` exiting 0 adds `f'worktree {worktree} is not detached: it has {ref} checked out'`;
  - HEAD must be reachable from the remote's default branch, or from any `refs/remotes/<remote>/*` ref (`git for-each-ref --format=%(refname) refs/remotes/<remote>/`, leaving out `<remote>/HEAD`). Otherwise: `f'worktree {worktree} HEAD {sha[:12]} is not on {remote}: it is not reachable from any {remote} branch'`;
  - the status check is the v0.2 one: no uncommitted or untracked file, and no ignored file outside the disposable patterns.

- [ ] **Step 1: Write the failing tests.**
  - In `tests_py/test_git_scripts.py`, `CleanupCheckTest`:
    - `test_detached_worktree_on_origin_main_is_ok`: `(True, [])`.
    - `test_detached_worktree_on_another_remote_branch_is_ok`: HEAD on a commit only `origin/temper/e/a` has → `(True, [])`.
    - `test_detached_worktree_on_no_remote_branch_is_refused`: a local-only commit → not ok, one reason containing `is not on origin`.
    - `test_detached_worktree_with_an_uncommitted_change_is_refused`: a reason containing `uncommitted`.
    - `test_detached_worktree_with_only_disposable_ignored_files_is_ok`: `node_modules/x` ignored, `--disposable node_modules/` → ok.
    - `test_detached_on_a_worktree_with_a_branch_checked_out_is_refused`: a reason containing `is not detached`.
    - `test_detached_usage_errors`: each of the three usage reasons above, exactly, through `main()`, which returns 1.
    - `test_branch_mode_is_unchanged`: the existing branch-mode tests stay green (no edit).
  - In `tests_py/acceptance/test_git_safety.py`:
    - `test_GIT_SAFETY_15_a_clean_detached_throwaway_on_origin_main_passes`: through the CLI, exit 0 and `{"ok": true, "reasons": []}`.
    - `test_GIT_SAFETY_16_a_detached_throwaway_on_no_remote_branch_or_with_a_change_fails`: exit 1 for each case, and the worktree and its files are still there afterwards.
    - `test_GIT_SAFETY_17_detached_usage_errors_exit_1_with_a_reason`: `--detached` without `--worktree`; a branch with `--detached`; neither. Each exits 1 with one reason.
- [ ] **Step 2: Run them and see them fail.** `python3 -m unittest tests_py.test_git_scripts tests_py.acceptance.test_git_safety`. Expected: the new tests FAIL or ERROR.
- [ ] **Step 3: Implement.** `branch` becomes `nargs='?'` and `--detached` a `store_true`. Factor the v0.2 worktree checks (is a worktree of the repo; status) into helpers that both modes call.
- [ ] **Step 4: Run them and see them pass.** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(cleanup): cleanup_check.py --detached checks a detached worktree"`

---

### Task 9 `host-prune`: The private host refs are pruned

Owns: scripts/host_sync.py, tests_py/acceptance/test_git_safety.py, test/acceptance/git-safety.test.mjs, test/acceptance/publish.test.mjs
Uses: none
Provides: host-prune-v03
Wave: 8

**Files:**
- Modify: `scripts/host_sync.py`: `_fetch_private` and the module docstring
- Test: `tests_py/acceptance/test_git_safety.py` (the only test file that asserts `host_sync.py`; its A7 test reads the refspecs)

**Interfaces (Provides `host-prune-v03`):**
- `_fetch_private` runs `git fetch --prune --no-tags --no-write-fetch-head <url> +refs/heads/<branch>:refs/temper/host/<branch> +refs/heads/temper/<epic>/*:refs/temper/host/temper/<epic>/*`. The refspecs are unchanged, so `--prune` touches only refs under `refs/temper/host/<branch>` and `refs/temper/host/temper/<epic>/`.
- `fetch`'s output and exit codes are unchanged. A local `refs/heads/temper/<epic>/<id>` is never deleted.

- [ ] **Step 1: Write the failing test** in `tests_py/acceptance/test_git_safety.py`, with the same fake ssh (`_stub_ssh`) and two local repos as the SECOND_CONTROL_FLOW_1 tests: `test_GIT_SAFETY_18_a_task_branch_deleted_on_the_host_leaves_no_private_ref`.
  - The host clone has `epic/e`, `temper/e/a` and `temper/e/b`. Run `host_sync.py fetch`.
  - Delete `temper/e/b` on the host and fetch again.
  - Expected: exit 0; `git for-each-ref refs/temper/host/temper/e/` lists only `refs/temper/host/temper/e/a`; the local `refs/heads/temper/e/b` still exists; a pre-made `refs/temper/host/temper/other/x` (another epic's) still exists.
- [ ] **Step 2: Run it and see it fail.** `python3 -m unittest tests_py.acceptance.test_git_safety -k GIT_SAFETY_18`. Expected: FAIL, `refs/temper/host/temper/e/b` still listed.
- [ ] **Step 3: Implement.** Add `--prune` to the private fetch. The A7 test's refspec assertions stay green.
- [ ] **Step 4: Run it and see it pass.** `npm test` and `sh scripts/ssh_host_smoke.sh --local`. Expected: all pass, and the smoke prints `ssh_host_smoke: PASS (11 checks, host smoke-host, mode local)`.
- [ ] **Step 5: Commit.** `git commit -m "fix(host): prune stale private refs on the fetch-back"`

---

### Task 10 `ci-py310`: CI's oldest job runs Python 3.10

Owns: .github/workflows/ci.yml, test/ci-v03.test.mjs
Uses: none
Provides: none
Wave: 9

`git grep ci.yml -- test tests_py` finds no test, so this task owns only its new one.

**Files:**
- Modify: `.github/workflows/ci.yml`: the matrix and its comment
- Create: `test/ci-v03.test.mjs`

- [ ] **Step 1: Write the failing tests** in `test/ci-v03.test.mjs`, reading the file as text (no YAML package):
  - `ci's oldest job is node 20 with python 3.10 on ubuntu-latest`. An include item has `os: ubuntu-latest`, `node: '20'` and `python: '3.10'`. The quotes matter: YAML reads a bare `3.10` as `3.1`.
  - `ci pins no ubuntu-24.04 and no python 3.9`. The file includes neither `ubuntu-24.04` nor `'3.9'`.
  - `ci still runs node 24 with python 3.13, the bundle check and npm test`. It includes `node: '24'`, `python: '3.13'`, `node scripts/bundle.mjs --check` and `run: npm test`.
- [ ] **Step 2: Run them and see them fail.** `node --test test/ci-v03.test.mjs`. Expected: the first two FAIL.
- [ ] **Step 3: Edit `ci.yml`.** The oldest item is `os: ubuntu-latest`, `node: '20'`, `python: '3.10'`. Replace the 24.04 comment with one line: "The oldest supported pair (the README's requirements) and a current one."
- [ ] **Step 4: Run them and see them pass.** `npm test`. Expected: all pass. CI itself is checked on the PR.
- [ ] **Step 5: Commit.** `git commit -m "ci: the oldest job runs Node 20 with Python 3.10 on ubuntu-latest"`

---

### Task 11 `docs-v03`: README, design-spec amendments, logs, behaviour lines and the version

Owns: README.md, docs/specs/2026-10-24-temper-design.md, docs/v1-log.md, docs/v1-behaviour.md, .claude-plugin/plugin.json, test/readme-v03.test.mjs, test/readme-v02.test.mjs, test/manifest.test.mjs, test/acceptance/head-v02.test.mjs, test/acceptance/skills-packaging.test.mjs, test/acceptance/git-safety.test.mjs, test/acceptance/publish.test.mjs, tests_py/test_layout.py, tests_py/acceptance/test_hook.py, test/acceptance/state.test.mjs
Uses: none
Provides: none
Wave: 10

Docs only. It describes what the other tasks build, from the spec and this plan.

**Files:**
- Modify: `README.md` (status line, requirements, development, CI line, known issues), `docs/specs/2026-10-24-temper-design.md`, `docs/v1-log.md`, `docs/v1-behaviour.md`, `.claude-plugin/plugin.json`
- Create: `test/readme-v03.test.mjs`
- Existing tests that assert these files:
  - `test/readme-v02.test.mjs`: the known issues name CONTROL-FLOW-6, and the version is 0.2.0. Both change here.
  - `test/manifest.test.mjs`: pins 0.2.0.
  - `test/acceptance/head-v02.test.mjs`: HEAD-20 and HEAD-21, the known-issues lines that stay.
  - `test/acceptance/skills-packaging.test.mjs`: plugin.json and the README's length.
  - `test/acceptance/git-safety.test.mjs` and `test/acceptance/publish.test.mjs`: README rule lines, unchanged.
  - `tests_py/test_layout.py` and `tests_py/acceptance/test_hook.py`: plugin.json's name and hooks, unchanged.

- [ ] **Step 1: Write the failing tests** in `test/readme-v03.test.mjs`, and update the old ones:
  - `the README's known issues list only what v0.3 left open`. The known-issues section:
    - names none of: `CONTROL-FLOW-6`, `never pruned`, `no \`blocked\` status`, `against that fix's parent`, `doesn't make a task own`;
    - still names the head's session line (HEAD-20) and the answers line (HEAD-21);
    - names `TESTS-DOCS-5`, deferred, with its reason (no safe way to refresh the permission mode without a new prompt).
  - `the README requires Python 3.10`: the requirements line and the development section say `Python 3.10 or later`, and no line says `Python 3.9`. The CI line says `Node 20 with Python 3.10`.
  - `plugin.json and the README say 0.3.0`: `version === '0.3.0'`, and `/^Status: v0\.3\.0\b/m`.
  - `the design spec has amendments A22 to A29, each citing the v0.3 spec`: each `^- \*\*A2[2-9]\b` line ends with `(v0.3 spec, <contract name>)`.
  - `docs/v1-behaviour.md has the v0.3 ids`: BUILD-37 to BUILD-43, PUBLISH-10 and PUBLISH-11, STABILISE-32 and STABILISE-33, GIT-SAFETY-15 to GIT-SAFETY-18, SKILLS-PACKAGING-32 to SKILLS-PACKAGING-35. Each is one `- **<id>** Given …, when …, then …` line citing `v0.3 spec`.
  - `the v1 log records CONTROL-FLOW-6 redone and TESTS-DOCS-5 deferred in v0.3`: the "Reopened by the reverts" section includes `SECOND-CONTROL-FLOW-6 is redone in v0.3 (docs/temper/v0-3/spec.md, the build's attempt and the checkpoint prompt).` and `SECOND-TESTS-DOCS-5 stays open, deferred in v0.3: there is still no safe way for the head to refresh the permission mode without a new prompt.`
  - `test/readme-v02.test.mjs`: drop the `CONTROL-FLOW-6` match and the 0.2.0 test (the v0.3 tests replace them). Keep the rest.
  - `test/manifest.test.mjs`: `0.3.0`.
- [ ] **Step 2: Run them and see them fail.** `node --test test/readme-v03.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write the docs.**
  - **README:**
    - status line `v0.3.0`;
    - requirements line, development line and CI line: Python 3.10;
    - known issues rewritten to what is still open: the head's session; TESTS-DOCS-5, deferred with its reason; some minors; the one-line answers note, unchanged.
  - **`.claude-plugin/plugin.json`:** `"version": "0.3.0"`.
  - **Design spec:** a section "Amendments from v0.3 (28 Oct 2026, `docs/temper/v0-3/spec.md`)", with one 2–4 sentence item each:
    - A22: phase results;
    - A23: the build's `attempt` and the checkpoint prompt;
    - A24: throwaway worktrees;
    - A25: `cleanup_check.py --detached` and the cleanup skill;
    - A26: the regression prompt;
    - A27: `host_sync.py fetch --prune`;
    - A28: plan test ownership;
    - A29: Python 3.10.

    Each ends `(v0.3 spec, <contract name>)`.
  - **`docs/v1-log.md`:** the two lines above, under "Reopened by the reverts". Under the stale-private-ref item: "closed in v0.3 by `--prune` on the private fetch".
  - **`docs/v1-behaviour.md`:** one given/when/then line per id above, in its group, written from the spec and the test names in Tasks 1–9.
- [ ] **Step 4: Run them and see them pass.** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "docs: v0.3 amendments, behaviour lines, known issues, Python 3.10 and version 0.3.0"`

## Waves

| Wave | Tasks | Why |
|---|---|---|
| 0 | plan-skill | skill task, run first by the skill-edit workflow; owns test files the other skill tasks also own |
| 1 | cleanup-skill | skill task; shares `test/skills.test.mjs` and the skills-packaging tests with Tasks 1 and 3 |
| 2 | run-skill | skill task; shares the skill tests and `head-v02.test.mjs` |
| 3 | phase-status | the phase-result contract the later code tasks build on; `lib.js` and two bodies |
| 4 | build-attempt | `lib.js`; the checkpoint prompt's blocked return needs `phase-status-v03` |
| 5 | throwaway | `lib.js` and all three bodies |
| 6 | regress-tip | `lib.js`; the regression prompt's throwaway text comes from wave 5 |
| 7 | cleanup-detached | `test_git_safety.py`, shared with Tasks 2, 3 and 9 |
| 8 | host-prune | `test_git_safety.py` again |
| 9 | ci-py310 | its own files; split for gate_slots: 1 |
| 10 | docs-v03 | the README and docs, written last from what the others built; split for gate_slots: 1 |

`.temper/project.md` has no `gate_slots` line, so it is 1 (`skills/plan`, step 1): every wave holds one task. The graph allows more at once (`ci-py310` and `host-prune` touch nothing else), but no wave is wider than the gate slots. The code tasks share `src/lib.js` and the generated `workflows/*.js`, and nearly every Node test file, so they would go one per wave anyway. The README has one owner (`docs-v03`).

## Behaviour groups

- `phases`: phase, docs and evidence agents can return blocked with a reason, and the build's `attempt` reruns a red checkpoint live (spec, user flows 1 and 2)
- `worktrees`: throwaway worktrees are named under `tmp/` and removed, `cleanup_check.py --detached` judges them, and stale private host refs are pruned (spec, user flows 3 and 5)
- `regress`: the per-fix regression check counts only what reproduces on the branch tip (spec, user flow 4)
- `head`: the plan, cleanup and run skills carry the head's side (spec, user flow 6)

## How the run goes (temper's own method)

The head (this session) follows `skills/run/SKILL.md`:
- **The runner.** It launches temper's v0.2.0 workflows (`main` at 16c11c8) from a scratch copy (`git show 16c11c8:workflows/build.js`), so the run doesn't change under itself.
- **Skill tasks.** `plan-skill`, `cleanup-skill` and `run-skill` (waves 0–2) run first, one at a time, in a skill-edit workflow: RED subagents → implementer → checker (temper's checker prompt) → GREEN subagents, one retry. Their task branches carry the same `Temper-Task` trailers, and a merge agent merges each into `epic/v0-3` with the quick gate. Then `done_tasks.py` lists them in `done`, and `build.js` skips them.
- **The build.** `build.js` runs waves 3–10, the MVP checkpoint (the spec's user flows), the behaviour spec (`docs/temper/v0-3/behaviour.md`, from the spec only), the acceptance tests per group, and at most 2 to-green rounds. The v0.2.0 runner has no phase `status` and no `attempt`, so its checkpoint still commits on a red gate: after a checkpoint block, the head relaunches without `resumeFromRunId` (v1-log's redo note) until this epic's own code runs.
- **Stage 4:** one sweep, the fixes the owner selects, then the per-fix regression check. Stage 5 publishes, and the head opens the PR into `v0.3` once the owner says yes. Then stop.
