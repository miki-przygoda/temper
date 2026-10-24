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
