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

## Fix run on fix/second-sweep (25 Oct)

Branch fix/second-sweep, made from feat/v1 at 170eb69. Four fix groups ran one after the other (ssh-host, validation, stabilise, publish-scripts), then a regression check over every fix, then a revert pass. Each fix has its own commit with a test that was seen failing on the old code first. The full gate passed after every commit. Nothing was pushed and no sudo was used.

### Per finding

- **SECOND-SAFETY-8:** fixed, 98eef22. A relative root or clone is refused, and so is a ~/ path mixed with an absolute one (the host's home isn't known locally). One old expectation changed: clone `~/repo` with root `/srv/o` is now refused.
- **SECOND-SAFETY-7:** fixed, 157546d (`python3 -I` on the host).
- **SECOND-CONTROL-FLOW-1:** fixed, 6724141 (new `scripts/host_sync.py fetch`: the fetch goes into refs/temper/host/, and local branches move only by `merge --ff-only` or a checked `update-ref`). **It has a proven regression that is still open; see below.**
- **SECOND-TESTS-DOCS-1:** fixed, 5da51af (`host_sync.py push` on the first launch; the A7 test no longer makes epic/e on the host by hand).
- **A7-REGRESSION** (the open regression from the 24 Oct run): fixed, f9fae65. The fetch-back leaves a local branch that is ahead of the host's copy alone and lists it under `ahead`.
- **SECOND-CONTROL-FLOW-2:** fixed, 8f49441. The head pushes before every launch, ssh agents leave the epic branch detached on the host, and stage 5 publishes only what the host had. This is spec amendment A12.
- Not a finding: 4308db3 adds `scripts/ssh_host_smoke.sh` (`<host>` or `--local`; the `--local` form runs in npm test).
- **SECOND-SAFETY-4:** fixed, c1c1857. ID_RE is enforced on finding, selected, second-sweep and done ids. A reviewer finding with any other id is never verified and blocks its lens. The id reaches the prompts only inside the data block and the trailer. This also covers SECOND-CONTROL-FLOW-3's cause, though that finding had no fix of its own.
- **SECOND-CONTROL-FLOW-6:** fixed in f8899ce, **then reverted in 99382ae** (regression).
- **SECOND-SAFETY-5:** fixed, 03d0e05. Branch spellings are normalised. A new optional `default_branch` arg is written by the plan skill. Older args.json files without it are compared with the base only.
- **SECOND-SAFETY-6:** fixed, da2b941. sudo, doas, su and pkexec are refused as a word anywhere in a gate. Escape tricks like `$'\163udo'` aren't caught; the fixed-rules prompt text still covers them.
- **SECOND-TESTS-DOCS-3:** fixed, 4aa1acf (each check pinned by a test that a mutant dropping it fails).
- **SECOND-TESTS-DOCS-11:** fixed, f06ddb2 (the dedupe key and the ownership key are pinned by mutant tests).
- **SECOND-TESTS-DOCS-2 and SECOND-CONTROL-FLOW-7:** fixed together in ec33aad (a `second:` id namespace), **then reverted in d340d7e** (regression).
- **SECOND-CONTROL-FLOW-4:** fixed, 7b4a267. A blocked first-sweep fix stops part fix with status `blocked`, and a resume runs `regress:fix` before the second sweep. Known gap: a run whose only selected fix died with no answer looks like a first run on resume, so it gets no extra regression check (the second sweep still reviews it).
- **SECOND-CONTROL-FLOW-5:** fixed in c8f9e53, **then reverted in e1a5054** (regression).
- **SECOND-SAFETY-2:** fixed, 53884d2 (gitignore-style matching, segment by segment).
- **SECOND-SAFETY-3:** fixed, 38128a4 (the backup is made 0600 with O_EXCL, then given the settings file's mode).
- **SECOND-CONTROL-FLOW-9:** fixed, 93b2e1a. The fix is in `done_tasks.py`, not publish.js: docs and evidence count only while every commit after theirs is also a docs or evidence commit.
- **SECOND-TESTS-DOCS-5:** fixed in 2edbbb7 (`scripts/session_mode.py`), **then reverted in 2b86b11** (regression).
- **SECOND-TESTS-DOCS-4:** fixed, 234db26. BUILD-01's cases are now generated from `schemas/args.schema.json`, and stabilise and publish get the same common-field cases. validateBuildArgs now checks that each behaviour entry is `{id, text}`.

### The regression check

Five regressions were proven. Each was reproduced a second time with an independent probe on `git archive` exports of the parent and the fix.

- **REGRESS-STAB-2** (ec33aad): a part 'fix' resume whose branch has a second-sweep trailer in the old `fix:second-<slug>-NN` form, with no `second_sweep_findings`, ran a third sweep and skipped that fix's regression check. That breaks spec 7's "never sweep again". **Reverted** (d340d7e). One conflict in test/stabilise-fix.test.mjs was resolved by keeping the later CONTROL-FLOW-4 tests. A compatible redo would also count a legacy `fix:second-*` trailer whose id is not in `args.selected`.
- **REGRESS-STAB-1** (c8f9e53): unverified findings were deduped only among themselves. So one bug that two lenses report, verified by one verifier while the other returned nothing, showed up twice and turned a stable second sweep into handover. **Reverted** (e1a5054). A redo should dedupe the unverified list against the verified one.
- **SECOND-TESTS-DOCS-5** (2edbbb7): the mode record is written only on a user prompt. An auto-mode overnight run that the plan skill starts in the same turn stalls at the pre-flight once ground and plan take over 600 s, waiting for a confirmation nobody gives. **Reverted** (2b86b11). A redo needs a refresh that doesn't depend on a new prompt, or no age limit inside the same session.
- **SECOND-CONTROL-FLOW-6** (f8899ce): once a failed checkpoint commits nothing, the resumed run has the same args. If the failing checkpoint was the run's first agent call (a second failure, or a resume with every task already done), the resume cache returns the old `gate_passed: false` with the stale gate log every time. This was shown on a model of the documented resume cache, not on the real runtime. **Reverted** (99382ae). A redo needs the head's fix to change the args, or a relaunch without `resumeFromRunId` after a checkpoint block.
- **SECOND-CONTROL-FLOW-1-stale-private-ref** (6724141): `_fetch_private` uses refspecs without `+` into refs/temper/host/, and nothing ever prunes or resets them. Once the host's copy of a branch is rewritten or recreated, every later fetch-back is refused as non-fast-forward, even when local and host agree or the local branch is missing. Two cases show it: a divergence that the user resolves by force-pushing the head's branch to the host, and a task branch deleted on both sides and remade on the host. **Blocked, not reverted, still present at HEAD.** A clean revert would also need 5da51af, f9fae65, 8f49441 and 4308db3 reverted, and the old plain fetch would bring A7-REGRESSION back. The owner chooses between:
  - a cascade revert of those four commits, or
  - the one-line forward fix: add `+` to the two private refspecs, or delete refs/temper/host/<epic> before each fetch. refs/heads/ would still move only by `--ff-only` or a checked `update-ref`.

  Until then, recover by hand with `git update-ref -d` on the stale refs/temper/host/ ref.

  Update: closed in v0.3 by `--prune` on the private fetch (the `+` refspecs follow a rewritten host branch, and `--prune` drops the copy of one the host deleted; docs/temper/v0-3/spec.md, `host_sync.py fetch`).

### Gate and smoke at 99382ae

- `npm test`: 282 of 282 Node tests and 106 of 106 Python tests passed, rc 0. The counts dropped from 287 and 114 at 234db26 because the reverts took their tests with them.
- `node scripts/bundle.mjs`, then `--check`: rc 0, and the working tree was clean afterwards.
- `claude plugin validate --strict .` with a fresh CLAUDE_CONFIG_DIR: passed, rc 0. The LICENSE_MISSING and ICON_MISSING directory notes were already there and don't change the result.
- `sh scripts/install_smoke.sh`: rc 0 (the marketplace was added, and superpowers and temper@temper were installed and enabled).
- `sh scripts/ssh_host_smoke.sh <host>` against the build host: PASS, 11 of 11 checks, mode ssh, rc 0, with no temper-smoke directories left on the build host. The smoke doesn't cover the stale-private-ref cases above.

### Reopened by the reverts, left for the owner

- SECOND-CONTROL-FLOW-5, SECOND-CONTROL-FLOW-6, SECOND-TESTS-DOCS-2, SECOND-CONTROL-FLOW-7 and SECOND-TESTS-DOCS-5 are open again, in their 24 Oct form.
- SECOND-CONTROL-FLOW-1 is fixed but carries the open stale-private-ref regression.
- SECOND-CONTROL-FLOW-5, SECOND-TESTS-DOCS-2 and SECOND-CONTROL-FLOW-7 are redone in v0.2 (docs/temper/v0-2/spec.md §3.9).
- SECOND-CONTROL-FLOW-6 is redone in v0.3 (docs/temper/v0-3/spec.md, the build's attempt and the checkpoint prompt).
- SECOND-TESTS-DOCS-5 stays open, deferred in v0.3: there is still no safe way for the head to refresh the permission mode without a new prompt.

### Second-sweep findings this run did not touch (minors, left for the owner)

- SECOND-SAFETY-9 (statusline timeout leaves children running).
- SECOND-CONTROL-FLOW-3 (no fix of its own; c1c1857's ID_RE check removes its cause).
- SECOND-CONTROL-FLOW-8 (runWaves ignores `merge.merged`).
- SECOND-TESTS-DOCS-6, 7, 8, 9 and 10 (run-skill blocked reasons, the empty 4a selection, args.contracts, the strict result checks, untested prompt lines).
- SECOND-TESTS-DOCS-12 (untested cleanup-check paths).
