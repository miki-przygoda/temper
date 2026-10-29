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

## 29 Oct 2026: stage 4a, the sweep (head)

- **The sweep.** Run wf_da8cbea7-a45 (v0.3's `stabilise.js`, `part: "sweep"`) found 10 verified findings: none severe, 7 important and 3 minor. None were refuted, unverified or blocked.
- **Throwaway reuse is unsafe** (failure-paths-and-lifecycle-01, test-strength-and-docs-02 and -03). `git -C <path> checkout --detach` keeps a dead agent's uncommitted edits instead of failing. On a local host, if a plain directory sits at the path, it acts on the main checkout instead.
- **The throwaway agents can't say blocked** (test-strength-and-docs-01). The check, findings, verdict, regress and gate schemas have no status, so a failed reuse reads as a clean result.
- **Publish has no `attempt`** (failure-paths-and-lifecycle-02 and test-strength-and-docs-04). A blocked docs or evidence phase replays its cached result on every resume.
- **The task id `tmp`** (security-01) collides with the throwaway root, as `epic` did before BUILD-36.
- **Minor.**
  - failure-paths-and-lifecycle-03: agents may leave throwaways dirty, so cleanup refuses them.
  - failure-paths-and-lifecycle-04: two findings with one id share a verify path.
  - test-strength-and-docs-05 (kind `owner`): the spec's "whatever merge style" claim is false for squash merges whose head branch is deleted.

## 29 Oct 2026: stage 4b, the fix wave (head)

- **The owner's selection.** The owner chose all 7 important findings:
  - failure-paths-and-lifecycle-01 and -02;
  - security-01;
  - test-strength-and-docs-01, -02, -03 and -04.

  For test-strength-and-docs-05, the owner chose "spec wording only": no code change. Throwaways under a squash merge whose head branch was deleted are left to the owner, and are never force-removed.
- **Open items** (not selected):
  - failure-paths-and-lifecycle-03: throwaway agents may leave their worktree dirty, so cleanup refuses it.
  - failure-paths-and-lifecycle-04: two findings with the same id share a verify path.
- **Result.** Run wf_ccf4905f-34e (v0.3's `stabilise.js`, `part: "fix"`, `attempt: 0`, `sweeps: 1`) returned `stable`. All 8 are fixed, with none reverted, no contract items, nothing blocked and no regressions. Each fix's `regress:fix:<id>` agent returned `{regressions: []}`.
  - 6e5acf5: a throwaway is reused only when it is its own clean worktree. Otherwise the agent returns blocked (failure-paths-and-lifecycle-01, test-strength-and-docs-02 and -03).
  - ef33554: the check, findings, verdict, regress and gate results carry `status`, and a blocked one blocks its id. A blocked verifier leaves its finding unverified (test-strength-and-docs-01).
  - a07cc55: publish has `attempt`, and the run skill bumps it on every publish resume (failure-paths-and-lifecycle-02, test-strength-and-docs-04).
  - 8aa8722: `tmp` is a reserved task id (security-01).
  - 827da7b: the spec and amendment wording on squash merges (test-strength-and-docs-05).
- **The head's check.**
  - `npm test`: 524/524 Node, and the Python suite passes.
  - The bundle check and `validate --strict` pass.
  - Every fix commit is on the branch.
  - The diff has no attribution lines or private names.
- **Stage 4 is stable.** It ran one sweep, as `sweeps: 1` asks, so no second sweep is expected (`second_sweep: null`).

## 29 Oct 2026: run skill check after the fix wave (head)

- **Why.** The fix wave edited `skills/run/SKILL.md` (a07cc55, ef33554). Fix agents can't start subagents, so the head ran the scenario check afterwards (run wf_5cfd3562-a8f): one run on the skill before the fix wave (7b7dd24) and two on the new one, for each of three scenarios.
- **P1: publish blocked at `docs`.**
  - RED: the run resumed with `attempt: 1`, but only by inference. It flagged that stage 5's args don't list `attempt`.
  - GREEN 2/2: it cited the stage 5 line and bumped `attempt`.
- **R1: `regress:fix:<id>` blocked because the throwaway path isn't its own worktree.**
  - RED: no rule covers it, so the run asks the user.
  - GREEN 2/2: no answer, the path is left alone, and it resumes once with `attempt` bumped.
- **C1: `check:<task>` blocked on a dirty throwaway.**
  - RED: the id is unclassified, so the run asks the user.
  - GREEN 2/2: the directory is never cleaned or removed, the answer is keyed by the task (`args.answers["auth"]`), and it resumes after the cause is gone.
- **Observation, not a gap.** A resume of R1 while the path is still bad blocks again, and then the skill's "if the same id blocks again, stop and tell the user" applies.
- **Open item.** `args.json` has one `attempt` field, but stages 3, 4b and 5 each say to save their own counter there. The counters only need to change between a stage's own launches, so sharing the field is harmless, but the skill doesn't say so. The head kept the stage 4 and 5 counters in its launch args.

## 29 Oct 2026: stage 5 (head)

- **Result.** Run wf_c7788ee8-b58 (v0.3's `publish.js`, `attempt: 0`) returned `ready`.
  - The docs went in at e6932a6: README, amendments, behaviour lines, known issues and `pr-body.md`.
  - The evidence went in at fd84a4f: `owner-steps.sh` and `owner-checklist.md`.
  - The full gate passed at fd84a4f (exit 0), in a throwaway under `tmp/`.
- **The head's check.**
  - Both commits are on the branch.
  - `pr-body.md` and the diff from `v0.3` have no attribution lines, home paths, host names or private project names.
  - This log entry is the only commit after the gated tip.
- **Push.** It waits for the owner's yes: push `epic/v0-3`, then open the PR into `v0.3`, never merging it.

## 29 Oct 2026: merged and cleaned up (head)

- **Merged, at the owner's request.** #7 (`epic/v0-3` into `v0.3`) went in as merge commit 62ecc7e, and #8 (`v0.3` into `main`, temper v0.3.0) as dfc5a51. CI passed on both: Node 20 with Python 3.10, and Node 24 with Python 3.13.
- **Cleanup**, by v0.3's own cleanup skill and `cleanup_check.py` from `main`, with `--disposable` set to `node_modules/` and `__pycache__/`:
  - 28 detached worktrees passed `--detached` and were removed: 7 `check-*` from v0.2.0's build runner and 21 under `tmp/` from v0.3's sweep, fix and publish runs.
  - The epic branch and its worktree, the 11 task branches with their worktrees, and `docs/v0.3-spec` passed and were deleted.
  - Nothing exited 1. There was no `--force` and no `-D`.
  - `rmdir .temper/worktrees/v0-3/tmp` ran first, then `rmdir .temper/worktrees/v0-3`.
- **Remote.** At the owner's request, the merged `epic/v0-3` and `docs/v0.3-spec` were deleted on the remote. The release branches `v0.2` and `v0.3` were kept.
