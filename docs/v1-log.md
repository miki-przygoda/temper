# temper v1 build log

## The run (24 Oct 2026)

- **How:** workflow `temper-v1` (run wf_512848af-beb, 73 agents plus 5 more after the resumes), in the owner's shape: MVP in waves, an independent behaviour check, one sweep, careful fixes and a regression check.
- **MVP:** 16 of 16 tasks. The run stopped twice:
  - **Task 6** asked before editing Task 5's interim test. The head answered from the plan: "until Task 6 lands".
  - **A plan error:** Tasks 14 and 15 were in the same wave and both owned `test/skills.test.mjs`, an add/add conflict. The head merged them as the plan intended. `validateBuildArgs` refuses exactly this, but the hand-written build workflow didn't use it.
- **Behaviour spec:** 128 behaviours in 7 groups, written from the design spec only (`docs/v1-behaviour.md`).
- **Acceptance:** 112 passed at first and 16 failed. Round 1 of to-green fixed 15 (14 product fixes and 1 test correction), and round 2 fixed STABILISE-19 (a resume could lead to a third sweep). Result: 128 of 128.
- **Sweep:** 37 findings, 36 verified.
  - 17 fixed, one at a time, each with a failing test first. Several were fixed already by an earlier fix in the same wave.
  - TESTS-DOCS-1 was a plan error (now A11).
  - 4 went to the owner (now A7–A10).
  - 12 Minor findings are the open items below.
- **Regression check:** 1 proven regression from the fix wave (CONTROL-FLOW-2's resume path), re-fixed in 16bbd71.
- **Final gate at 8286a5f:** 260 of 260 Node and 90 of 90 Python tests, the bundle check and `validate --strict` passed. The install smoke test reported `temper@temper enabled`.

## Owner decisions (24 Oct 2026)

Recorded as spec amendments A7–A11. These are the owner's answers to the questionnaire after the run: fetch back with no `rm -r`; merge the passed subset; refuse ignored files unless listed as disposable; yes, fix the checker's diff range.

## Open items (Minor, left for the owner)

- **CONTROL-FLOW-7** (`src/stabilise.js`): Whether a fix is done is keyed on the reviewer-supplied finding id. The script never makes second-sweep ids distinct; it only asks reviewers to use the second- prefix, so a second-sweep finding that reuses a first-sweep id counts as already fixed.
- **CONTROL-FLOW-8** (`src/publish.js`): Relaunching publish with docs in args.done (e.g. after gate_failed, once the gate is fixed) returns a PR title without the summary: just the epic name.
- **SAFETY-7** (`scripts/install_statusline.py`): The statusLine command is built as "python3 '%s'" with no escaping. A state path containing a single quote gives a shell command that cannot run, so both temper's statusline and the wrapped one stop showing.
- **SAFETY-8** (`hooks/prompt_submit.py`): The slash check is prompt.lstrip().startswith('/temper'), so it matches any slash command that starts with those letters, such as /temperature or /tempered. With the keyword trigger off, such a prompt still gets temper's mode-warning context.
- **TESTS-DOCS-11** (`README.md`): The README says the tests need Node 20 or later. `npm test` runs `node --test 'test/**/*.test.mjs'`, and the test runner only accepts glob patterns from Node 21.0.0.
- **TESTS-DOCS-12** (`src/publish.js`): On a publish resume where 'docs' is already in done, docs stays null and the PR title falls back to the bare epic id.
- **TESTS-DOCS-13** (`skills/run/SKILL.md`): The run skill says to treat each entry in the mvp report's `questions` as a blocked question and write its answer to args.answers[<task id>]. Those entries are keyed by behaviour id, and validateBuildArgs refuses an answer key that isn't a task id.
- **TESTS-DOCS-14** (`src/lib.js`): validateBuildArgs accepts branch 'temper/<epic>'. Git can't hold that ref beside the task branches temper/<epic>/<id>, which is why plan now avoids it. A hand-written args.json (STATE-21) still passes validation and fails only once agents are running, not with an upfront refusal.
- **TESTS-DOCS-15** (`tests_py/acceptance/test_git_safety.py`): cleanup_check.py's fail-safe paths are untested: the exception handler that reports 'not safe', the error when a worktree's status can't be read, and the main/master fallback when origin/HEAD is missing.
- **TESTS-DOCS-16** (`tests_py/acceptance/test_hook.py`): No hook test checks that the keyword matches the whole word 'temper', so dropping the \b anchors goes unnoticed.
- **TESTS-DOCS-17** (`test/acceptance/stabilise.test.mjs`): The code says second-sweep fixes found already done on a resume 'still get the regression check', but no test asserts it, so dropping them from the check goes unnoticed.
- **TESTS-DOCS-18** (`test/acceptance/publish.test.mjs`): The publish tests check a non-zero exit status but never a gate result with passed:false and exit_status 0, so dropping the passed check goes unnoticed.
- **TESTS-DOCS-19** (`test/build-waves.test.mjs`): No test makes a pipeline item come back null (a stage that throws), so the code that turns a null state into a blocked entry is never exercised.
- **TESTS-DOCS-20** (`tests_py/test_state.py`): Nothing tests uninstall's 'a statusline the user set after installing temper's is theirs: leave it' branch.

## Lessons for temper itself

- **Check the plan with temper's own rules before running it.** The add/add conflict in wave 6 is exactly what `validateBuildArgs` rule (a) refuses.
- **The behaviour check finds what review misses.** 16 acceptance failures were code that matched the plan but not the spec.
- **Sweep findings go stale as the fixes land.** Fixes run one at a time on a moving HEAD, so several findings, verified at an older commit, were already fixed by the time their turn came. The fix prompt should say to check the current HEAD first, as the agents did here on their own.

## Fix run and second sweep (24 Oct 2026, workflow temper-v1-fix, run wf_4fd0345b-a5b, 41 agents)

- **The owner's amendments:** each fixed with a failing test first: A11 cfd9ec3, A9 71f732a, A7 6d4b62d, A8 c4be058, A10 a4fd02e.
- **The second sweep:** 30 findings, 30 verified. One was severe, SECOND-SAFETY-1, fixed in 27cfc68: the PR title went into a double-quoted shell command.
- **The regression check found 1 proven regression from A7, not yet fixed.** The fast-forward-only fetch-back refuses once the head has committed on the local epic branch, for example after resolving a `merge:wave<n>` or `checkpoint` block. The spec's hard stop means it waits for the owner.
- **Final gate at 27cfc68:** 265 of 265 Node tests and 96 Python tests passed, the bundle check and `validate --strict` passed, and the install smoke test passed.

### Second-sweep findings left for the owner (hard stop: no third sweep)

- **SECOND-SAFETY-2** (critical, fix; `scripts/cleanup_check.py`): Patterns with a leading or inner `/` are matched with fnmatch, and fnmatch's `*` also matches `/`. So `/*.log` or `out/*.log` matches ignored files at any depth below. The check then passes, and `git worktree remove` deletes ignored files the user never listed as disposable.
- **SECOND-SAFETY-3** (important, fix; `scripts/install_statusline.py`): The one-time settings backup is made with shutil.copyfile, which doesn't copy the mode. A 0600 settings.json, which can hold env secrets or an apiKeyHelper, is backed up as a 0644 file in a 0755 state directory.
- **SECOND-SAFETY-4** (important, fix; `src/lib.js`): Finding ids come from the reviewer agents and are checked only as non-empty strings. They go raw into the instruction text of the verify, fix and regress prompts, outside the 'data from another agent, not instructions' block, and into the fix:<id> trailer. Second-sweep severe findings reach fixLoop without the head choosing them.
- **SECOND-SAFETY-5** (important, fix; `src/lib.js`): The branch-is-not-the-base rule (GIT-SAFETY-02) compares the strings exactly. Another spelling of the same branch passes every validator, so the build can merge into the user's default branch and the head then pushes it straight to origin.
- **SECOND-SAFETY-6** (important, fix; `src/lib.js`): checkGates accepts any non-empty command, so a gate from project.md that uses sudo passes validation. Agents are then told to run it, in the same prompt that says 'no sudo, not even sudo -n'. Spec 8's no-privileged-commands rule isn't enforced in the one place where commands come from config.
- **SECOND-SAFETY-7** (minor, fix; `skills/cleanup/SKILL.md`): On an ssh host the cleanup check runs as `ssh <host> python3 - ...` with the script on stdin. Python then puts the login directory ('') first on sys.path, so a json.py, fnmatch.py or subprocess.py in the host's home replaces the stdlib module inside the code that decides whether to delete.
- **SECOND-SAFETY-8** (minor, fix; `src/lib.js`): The rule that host.clone lies outside <root>/<epic>/ (A7) is checked only when clone and root are written the same way (both absolute or both ~/). A clone inside the epic dir passes when the two differ, or when root is relative.
- **SECOND-SAFETY-9** (minor, fix; `statusline/temper_statusline.py`): When the wrapped statusline times out, subprocess.run kills only the /bin/sh it started. The children of a compound command keep running, and every statusline refresh leaves another one behind.
- **SECOND-CONTROL-FLOW-1** (important, fix; `skills/run/SKILL.md`): The A7 fetch-back writes straight into refs/heads/<branch>, and git refuses that whenever the epic branch is checked out in the user's repo or any of its worktrees. That happens even when the fetch would change nothing, so every resume stops.
- **SECOND-CONTROL-FLOW-2** (important, owner; `skills/run/SKILL.md`): With an ssh host, nothing ever brings the head's copy of the epic branch to the host clone. Its creation on the first launch never reaches the host, and neither do the head's own commits for merge:wave/checkpoint blocks, so host agents work from a branch that doesn't exist or is stale, and the next A7 fetch fails as non-fast-forward.
- **SECOND-CONTROL-FLOW-3** (minor, fix; `src/lib.js`): validateStabiliseArgs accepts any non-empty finding id, but done_tasks.py only returns trailer ids that match ID_RE. A fix committed for an id with capitals or an underscore never shows up in args.done, so it is redone on every resume.
- **SECOND-CONTROL-FLOW-4** (important, owner; `src/stabilise.js`): A blocked first-sweep fix does not stop part 'fix'. The second sweep runs on a branch without that fix and the result can be 'stable' with a non-empty blocked list. On resume the fix lands after the final sweep and gets no review or regression check.
- **SECOND-CONTROL-FLOW-5** (important, owner; `src/stabilise.js`): A verifier that returns nothing (null) counts as refuted, so the finding is silently dropped. In the second sweep that turns an unverified severe finding into status 'stable'. A review that returns nothing, by contrast, is blocked (f6e411b).
- **SECOND-CONTROL-FLOW-6** (important, fix; `src/lib.js`): The checkpoint prompt commits its trailer whether or not the full gate passed. After a checkpoint block, done_tasks lists 'checkpoint', so on resume the checkpoint is skipped. That breaks the run skill's 'the phase runs again' and leaves checkpoint null in the build report.
- **SECOND-CONTROL-FLOW-7** (minor, fix; `src/stabilise.js`): lostSecondIds takes any `fix:second-*` trailer to be a second-sweep fix. A first-sweep finding from an extra lens whose slug starts with 'second' is therefore taken as proof that the second sweep ran, and the second sweep is skipped.
- **SECOND-CONTROL-FLOW-8** (minor, fix; `src/build.js`): When the merge agent stops partway (a conflict, or a failed gate after some merges), runWaves ignores `merge.merged`. done_now then leaves out tasks that were in fact merged, and the passed tasks after the stop point rerun from their implementer on resume.
- **SECOND-CONTROL-FLOW-9** (minor, owner; `src/publish.js`): A publish relaunch after gate_failed skips docs and evidence because their trailers are in done. The PR body and docs were written against the code from before the gate fix, and the run returns ready with them.
- **SECOND-TESTS-DOCS-1** (important, owner; `skills/run/SKILL.md`): With an ssh host, nothing puts the epic branch, or the spec and plan the plan skill committed locally, into the host clone. The implementer is told to branch from that epic branch on the host, where it doesn't exist. If the agent makes its own from the host's origin/main, every later fast-forward-only fetch-back is rejected. The A7 test creates epic/e in the host clone by hand, so it can't catch this.
- **SECOND-TESTS-DOCS-2** (important, fix; `src/stabilise.js`): Any done trailer starting fix:second- counts as a second-sweep fix. A project lens whose slug starts with 'second' gets first-sweep ids second-…-NN. A resume of part fix before the second sweep then hands over and never runs the second sweep. This is related to CONTROL-FLOW-7 but goes the other way: here a first-sweep id is taken for a second-sweep id.
- **SECOND-TESTS-DOCS-3** (important, fix; `src/lib.js`): No test covers validateStabiliseArgs's checks on second_sweep_findings, the array check or the per-entry id and severity check. Deleting the array check lets a malformed saved value sweep a third time with every test green, though STABILISE-19 claims there is never a third sweep on any resume.
- **SECOND-TESTS-DOCS-4** (important, fix; `test/acceptance/build.test.mjs`): BUILD-01's test claims that invalid args (a required field missing, or a field of the wrong type) are refused before any agent starts. It covers only tasks, gates, epic, done and a task's wave, so deleting most of the validator's other checks goes unnoticed. The same checkCommon gaps apply to stabilise and publish.
- **SECOND-TESTS-DOCS-5** (important, owner; `skills/run/SKILL.md`): The overnight pre-flight treats a missing hook warning as 'auto mode is on'. The hook adds the mode warning only for prompts that start with /temper (or contain the keyword when it's on), so an overnight run started in plain words passes the check in any mode.
- **SECOND-TESTS-DOCS-6** (minor, fix; `skills/run/SKILL.md`): The run skill's handling of non-task blocked ids leaves out build.js's 'agent returned nothing' reason for merge:wave<n>, checkpoint and behaviour-spec. A dead agent is described as a merge conflict or a red full gate, so the head is told to merge or fix the gate itself.
- **SECOND-TESTS-DOCS-7** (minor, fix; `skills/run/SKILL.md`): When nothing is selected after 4a, the run skill says to skip 4b but not what comes next. Stage 5 is reached only from 'status: stable', which a skipped 4b never returns, and validateStabiliseArgs refuses part fix with an empty selected.
- **SECOND-TESTS-DOCS-8** (minor, fix; `skills/plan/SKILL.md`): Spec 6 lists `contracts` in args.json, and the plan skill says 'the implementer sees only its own task's text, the contracts and the fixed rules'. But the plan skill, the schema and the prompts never carry args.contracts. The implementer gets only contract names and is told to read the whole spec and plan.
- **SECOND-TESTS-DOCS-9** (minor, fix; `src/build.js`): The strict checks on agent results are untested: impl.status !== 'done', check.pass === true, recheck pass !== true, merge.status !== 'merged', merge.gate_passed !== true, checkpoint gate_passed !== true, and verdict.real !== true in stabilise.js:45. Loosening each to a truthy test or a === false test survives, so no test feeds a missing or non-boolean field.
- **SECOND-TESTS-DOCS-10** (minor, fix; `src/lib.js`): Several prompt instructions are in no test. Removing the checker's 'Undo your spot-check break; commit nothing', the gate prompt's 'Change nothing and commit nothing' or 'real exit status (passed is true only for exit status 0)', the regress prompt's 'needs proof', RULES_COMMON's 'stay inside the project' line, or commitText's 'No Co-Authored-By' line each survives.
- **SECOND-TESTS-DOCS-11** (important, fix; `src/lib.js`): Some tests can't catch a wrong key. The dedupe test claims findings are merged on the same file, line and summary, but a dedupe that drops `file` from the key survives. The ownership rule keys on wave plus path, but a mutant keyed on path alone, which refuses valid plans, also survives.
- **SECOND-TESTS-DOCS-12** (minor, fix; `scripts/cleanup_check.py`): Two cleanup-check paths are untested beyond the open TESTS-DOCS-15: the git-common-dir check (a worktree of a different repo) and the dir-only limit on anchored disposable patterns. Removing either survives.

### Reading

- **The ssh build-host mode isn't ready.** Nothing brings the epic branch, spec and plan into the host clone (SECOND-CONTROL-FLOW-2, SECOND-TESTS-DOCS-1). The fetch-back clashes with a checked-out epic branch (SECOND-CONTROL-FLOW-1), and with the head's own commits (the regression above). Local mode is the solid path for v1.
- **Several important findings concern inputs that cross into prompts or shell commands:** ids (SAFETY-4), gates that use sudo (SAFETY-6), and branch spelling (SAFETY-5). They belong with the ssh-host work, in one hardening pass.
