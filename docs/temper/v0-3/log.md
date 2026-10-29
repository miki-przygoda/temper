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
