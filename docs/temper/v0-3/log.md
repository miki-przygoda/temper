# v0-3 log

## 28 Oct 2026: plan (planner)

- **The plan.** 11 tasks, one per wave: `.temper/project.md` has no `gate_slots` line, so it is 1 (`skills/plan`, step 1).
  - Waves 0–2 are the skill tasks: `plan-skill`, `cleanup-skill`, `run-skill`. Each has RED scenarios and its own new test file.
  - Waves 3–6 are the workflow code: `phase-status`, `build-attempt`, `throwaway`, `regress-tip`.
  - Waves 7–8 are the scripts: `cleanup-detached`, `host-prune`.
  - Wave 9 is `ci-py310`; wave 10 is `docs-v03`, the README's only owner.
- **Test ownership** (the spec's new plan rule, applied to this plan). For every task, `git grep` over `test/` and `tests_py/` for each function, constant, schema, label, prompt line and file it changes. Every existing test file that asserts them is in its `Owns:`.
  - The widest is `phase-status`. Every scripted responder that returns a phase result without `status` breaks once `status` is required, which is ten Node test files.
  - Every code task that touches `src/` also owns the three `workflows/*.js`.
- **Choices the spec left to the plan.**
  - **Throwaway labels.** Prompt builders take the agent's label as an optional last argument, defaulting to the label the body uses. `check:` and `recheck:` therefore get different paths.
  - **Where `attempt` goes.** Only the build's checkpoint, behaviour-spec, acceptance and green prompts end with `Run attempt <n>.`, and `regressPrompt` keeps its own.
  - **A `checkAttempt` helper** is shared by build and stabilise. Publish takes no `attempt`.
  - **The prune check** is a unit test with the fake ssh and two local repos. `ssh_host_smoke.sh` is unchanged, so its 11-check count stays.
  - **New behaviour ids** start after the highest in `docs/v1-behaviour.md`: BUILD-37..43, PUBLISH-10..11, STABILISE-32..33, GIT-SAFETY-15..18, SKILLS-PACKAGING-32..35.
- **A gap in the spec, noted in Review Focus.** A failed removal is to be reported in the agent's result. The reviewer and gate results have no free-text field for it, and the spec adds none. The cleanup skill's `tmp/` pass catches what they leave.
- **The check.** `validateBuildArgs` on `args.json` returns `[]`.
- **The runner.** v0.2.0's committed workflows (`main` at 16c11c8), from a scratch copy. That runner still commits a red checkpoint, so after a checkpoint block the head relaunches without `resumeFromRunId`.
- **The owner's plan review** is pending.

## 28 Oct 2026: plan audit and the owner's decision (head)

- **The audit.** An independent ownership audit (git grep over `test/` and `tests_py/`) found 22 existing test files that tasks assert against but didn't own. Each is now in its task's owns. With one task per wave, no conflicts arise. `validateBuildArgs` reports no errors.
- **The owner's decision: keep the fixed rule.** "Never delete branches or worktrees" stays in every prompt. Agents name their throwaway worktree under `tmp/<label>`, reuse it if it exists, and never remove it. The cleanup skill removes them with `cleanup_check.py --detached`. Spec §Contracts and plan Task 6 are changed to match.
- **Plan wording fixed by the head.**
  - `build-attempt` changes the existing `lib-core` test that pins "build ignores attempt", and adds `attempt: 0` to BUILD-01's base so the generated cases cover it.
  - `cleanup-skill` edits SECOND_SAFETY_7 and `epic_dir_command()` to accept its new lines.

## 29 Oct 2026: skill tasks (head)

- **The run.** The skill-edit workflow (wf_822135f7-8a8): writing-skills RED/GREEN around temper's implementer, checker, one retry and merge.
  - `plan-skill`: RED failed P1 3/3 (the bundled `workflows/*.js` left out of owns), P2 1/3 and P3 3/3. GREEN failed 0/3 on each. Merged at 7466b04.
  - `cleanup-skill`: RED failed C1 and C2 3/3; C3 0/3 needed no change. GREEN failed 0/3. Merged at 6dd1849.
  - `run-skill`: RED failed R1 and R2 3/3; R3 and R4 0/3 needed no change. GREEN failed 0/3. Merged at 695ef14.
- **The build launch.** `done` is `["cleanup-skill", "plan-skill", "run-skill"]`. The runner is v0.2.0's committed `workflows/build.js` (16c11c8), from a scratch copy.
  - **Known limit of that runner:** its checkpoint commits even on a red gate, so after a checkpoint block the head relaunches without `resumeFromRunId`.
  - **The host.** This Mac has 16 CPUs and the build runs one task per wave (`gate_slots` is unset, so 1).

## 29 Oct 2026, 02:41: the build resumed after the owner's pause (head)

- **The pause.** The owner paused the build at 00:18. The head stopped run wf_fce0c7e8-830 as wave 3 (`phase-status`) began; no task branch or commit came from it.
- **The resume.** It ran at 02:41, as the owner scheduled. `done` is `["cleanup-skill", "plan-skill", "run-skill"]` (unchanged) and `attempt` is 1.
- **The relaunch.** A fresh launch of v0.2.0's `build.js` (the scratch copy, the same as 16c11c8), not a resume, since the stopped run ended mid-wave.

## 29 Oct 2026: MVP checkpoint (checkpoint agent)

- **The full gate: passed** (exit 0, run once). `npm test` passed 485 Node tests and 118 Python tests. `node scripts/bundle.mjs --check` passed. `claude plugin validate . --strict` printed `✔ Validation passed`, with one non-blocking plugin-directory warning, `ICON_MISSING`. The log is in the checkpoint agent's scratchpad, as `gate.log`.
- **The flows.** All 6 are ok. Flows 1–4 drove the committed `workflows/*.js` through `test/harness.mjs` with scripted responders. Flows 3 and 5 ran the scripts against throwaway git repos.
  1. **A phase blocks: ok.**
     - Build: the checkpoint responder returned `{status: "blocked", reason: "HEAD detached"}`. The result was `{status: "blocked", blocked: [{id: "checkpoint", reason: "HEAD detached"}]}`, and the labels ended at `checkpoint` (no `behaviour-spec`).
     - Publish: docs returned blocked. The result was `{status: "blocked", blocked: [{id: "docs", reason: "cannot write docs"}], commits: {}}`, and the only label was `docs` (no evidence or gate, never `ready`).
  2. **A red checkpoint commits nothing, and a resume reruns it: ok.**
     - A `done` checkpoint with `gate_passed: false` gave `blocked [{id: "checkpoint", reason: "full gate failed: logs/full.log"}]`.
     - The prompt says "4. Only when the full gate passed: … commit it", and "When the full gate failed: commit nothing, and return status \"blocked\" with the gate log in reason."
     - A resume with `done: ["a"], attempt: 1` ran `checkpoint`, `behaviour-spec` and `acceptance:g1`. Its checkpoint prompt differs from the first one: it ends `Run attempt 1.` where the first ends `Run attempt 0.`
  3. **Throwaway worktrees are named, and cleanup removes them: ok.**
     - Every throwaway prompt names a path under `.temper/worktrees/e/tmp/<label>`: `check:a` (`tmp/check-a-26f20d52`), `recheck:a`, `review:<lens>` ×3, `verify:f1`, `regress:fix:f1`, `second:review:<lens>` ×3, and publish's `gate` (`tmp/gate-1660eb12`). None says `git worktree remove` or `rm -rf`. Each says "you never delete a worktree (a fixed rule); temper's cleanup removes it". The rule "never push, merge, or delete branches or worktrees" is still in `src/lib.js`.
     - `tmpLabel('a:b')` = `a-b-08bd8540` and `tmpLabel('a-b')` = `a-b-2a89df63`, so the two labels get different paths.
     - `cleanup_check.py repo --detached --worktree <tmp/clean>` (detached on `origin/main`) printed `{"ok": true, "reasons": []}`, exit 0.
     - A worktree with a local-only commit: exit 1, with "HEAD 63d0eaa4303b is not on origin: it is not reachable from any origin branch".
     - A worktree with an uncommitted change: exit 1, with "has 1 uncommitted and 0 untracked file(s)".
     - `--detached` without `--worktree`: exit 1, with "--detached needs --worktree".
     - A branch together with `--detached`: exit 1, with "give either a branch or --detached, not both".
  4. **The regression check counts only what still reproduces: ok.** The `regress:fix:f1` prompt says "The current tip of `temper/e` is what `git rev-parse temper/e` prints when you start." and "A regression counts only when it reproduces on the current tip of `temper/e` as well; give both reproductions." It ends `Run attempt 0.`
  5. **Stale private refs are pruned: ok.** The setup was two local repos and a fake `ssh` on PATH.
     - The first `host_sync.py fetch` created `temper/e/a` and `temper/e/b`, with private refs `refs/temper/host/{epic/e,temper/e/a,temper/e/b}`.
     - After `git branch -D temper/e/b` on the host, the second fetch left only `refs/temper/host/epic/e` and `refs/temper/host/temper/e/a`. The local `refs/heads/temper/e/b` was kept.
     - `sh scripts/ssh_host_smoke.sh --local` printed `ssh_host_smoke: PASS (11 checks, host smoke-host, mode local)`.
  6. **The head's side: ok** (skill text).
     - The plan skill (lines 28–32): `git grep` over the tests, each asserting test file goes into `Owns:`, and tasks that share a test file go in different waves.
     - The cleanup skill (lines 17, 37–41, 55): every detached worktree from `git worktree list --porcelain`, `tmp/` included, is checked with `cleanup_check.py --detached --worktree`. On the host, `rmdir <root>/<epic>/tmp` runs before `rmdir <root>/<epic>`.
     - The run skill (lines 64, 94–107): `attempt` goes up on every resume, and a phase's own `reason` is data that is recorded and acted on as a blocked item.
- **Gaps: none.** Two observations, not gaps:
  - The `checkpoint` bullet in the run skill's "Ids that aren't tasks" describes only a failed full gate. A checkpoint blocked for another reason (such as `HEAD detached`) is covered only by the general rule about the agent's reason just above it.
  - `claude plugin validate --strict` warns `ICON_MISSING`. It doesn't fail the gate.
- **The runner.** This checkpoint ran under v0.2.0's committed `build.js`, whose prompt commits on every run. The gate was green, so this commit agrees with v0.3's rule as well.

## 29 Oct 2026: build report (head)

- **Result.** Run wf_eccdc93e-654 (v0.2.0's `build.js`, a fresh launch with `attempt: 1`) returned `mvp`. All 11 tasks are merged. This launch merged waves 3–10: `phase-status`, `build-attempt`, `throwaway`, `regress-tip`, `cleanup-detached`, `host-prune`, `ci-py310` and `docs-v03`. No task blocked and no questions came back.
- **Checkpoint.** The full gate passed, and all six user flows were ok with no gaps.
- **Acceptance.** 45 passing, none failing, none untestable. No to-green rounds were needed.
- **The head's check at 9085d06.**
  - `npm test`: 519/519 Node and 129/129 Python.
  - The bundle check exits 0, and `claude plugin validate --strict` passes. The `ICON_MISSING` warning doesn't fail it.
  - Every task and phase trailer is in `done_tasks.py`'s output.
  - The diff from `v0.3` has no attribution lines, home paths, host names or private project names. The one match was the rule against attribution lines itself.
  - The version is 0.3.0.
- **Stage 4's runner.** It is this branch's own v0.3 `stabilise.js` (a snapshot at 9085d06), with `sweeps: 1` and `gate_slots: 1`. That gives one sweep, the owner's selected fixes, then the per-fix regression check. Its throwaway worktrees go under `.temper/worktrees/v0-3/tmp/`, and cleanup removes them.
