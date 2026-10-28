# v0-2 log

## 28 Oct 2026: plan (head)

- **The scope.** The spec is the owner's questionnaire answers (28 Oct), and a builder check was folded in. The S7 spike ran first (spec §3.7a). It confirmed the `attempt` counter, and found item 7 needs no code.
- **How it runs.** The run uses temper's own method. The head runs v0.1.0's committed workflows from a scratch copy.
  - The two skill tasks run first, in a skill-edit workflow, because workflow agents have no Agent tool for writing-skills' RED and GREEN subagents.
  - `args.json`'s `repo` is `.`, so no absolute home path is committed. Agents start in the repo root.
- **Preferences.** This account has no temper `preferences.md`. The owner is present, so pushes and PRs are asked for each time (`may_push: ask`, the default).

## 28 Oct 2026: skill tasks (head)

- **The run.** The skill-edit workflow (wf_1095f779-382) ran `run-skill`.
  - **RED:** scenarios B, C, D, E and F failed 3/3 on the old skill; A passed 3/3.
  - **First attempt (e20850c):** GREEN was clean, but the checker found the commit-check text (spec §3.1) missing. The implementer had skipped A because A passed RED.
  - **Retry (8399422):** the recheck passed, but GREEN E was 1/3. The failing answer offered the unverified finding correctly, but didn't restate the overnight rule.
  - **Result:** blocked, after two failed attempts.
- **The head's answer** (the spec settles it, §3.9):
  - state the unverified rule once, as a user-present / overnight pair;
  - say `flaky` is an array of strings.

  The run resumed with the answer in `answers["run-skill"]`.
- **`run-skill` after the resume.** Merged at b2d6590 (4c35d5b). GREEN was 0/3 failures on B–F, and the checker passed.
- **`project-skills`.** RED failed G 3/3, H 2/3 and I 3/3. GREEN failed 0/3 on each, the checker passed, and it merged at 216e0fd (a3fa8ba) with the quick gate green.

## 28 Oct 2026: build launch (head)

- **Done.** `done` is `["project-skills", "run-skill"]`, from `done_tasks.py`.
- **The host.** This Mac has 16 CPUs and plenty of free disk. A quick gate is `npm test`, about 1 minute. Waves hold at most 2 tasks to launch (wave 0: `args-fields` and `docs-v02`), so no re-cut is needed.
- **The runner.** v0.1.0's `workflows/build.js` (26714a9), from a scratch copy.
- **Task texts.** `args.json` task texts point at their plan sections, so the launch args stay small enough to pass inline. The implementer reads the plan and the spec anyway. The launch passes the absolute `repo`.

## 28 Oct 2026: build blocked at wave 0 (head)

- **Wave 0.** `args-fields` merged (0d77370). `docs-v02` blocked: bumping `plugin.json` to 0.2.0 means changing `test/manifest.test.mjs`, which pins 0.1.0 and isn't in its owns.
- **The head's call.** This was a plan error, so the plan is fixed, not the check: `test/manifest.test.mjs` is added to `docs-v02`'s owns (no other task owns it). The answer goes in `answers["docs-v02"]`, `done` is refreshed, and the run resumes.

## 28 Oct 2026: build blocked at wave 3 (head)

- **Waves 0–2.** `docs-v02`, `prompts-rule-wait` and `commits` merged (HEAD 5d804e8).
- **Wave 3.** `regress-sweeps` blocked: its quick gate needs a two-line change in `test/acceptance/git-safety.test.mjs`, whose scripted responder knows only the old `regress` label. That file isn't in its owns.
- **The head's call.** This was a plan error again: the shared stabilise test files belong to every stabilise task. The tasks in waves 3–7 run one per wave, so each of them now owns `test/acceptance/git-safety.test.mjs`, `test/stabilise-sweep.test.mjs`, `test/stabilise-fix.test.mjs` and `test/acceptance/stabilise.test.mjs`. `validateBuildArgs` still reports no errors. The answer goes in `answers["regress-sweeps"]`, `done` is refreshed, and the run resumes.

## 28 Oct 2026: MVP checkpoint (checkpoint agent)

- **Full gate: passed** at 878b70a. `npm test && node scripts/bundle.mjs --check && CLAUDE_CONFIG_DIR="$(mktemp -d)" claude plugin validate . --strict` exited 0: node tests 355 pass, 0 fail; the Python suite ran 107 tests, OK; the bundle check passed; the plugin validator printed `✔ Validation passed`, with one directory warning that doesn't change the result (`ICON_MISSING`: no plugin icon). The log was written to the agent's scratchpad (`gate.log`) and isn't committed.
- **How the flows ran.** A throwaway script outside the repo (`flows.mjs` in the agent's scratchpad) drove the committed `workflows/*.js` through `test/harness.mjs` (`runWorkflow`, `loadLib`) with a scripted responder, as spec §7 says.
- **Flow 1, a v1 epic still runs: ok.** v1 build, stabilise (`part: "fix"`) and publish args, with no v0.2 fields: `validateBuildArgs`, `validateStabiliseArgs` and `validatePublishArgs` each printed `[]`. A build with every agent answering done or merged printed `build status: mvp`, with labels `impl:a, check:a, merge:wave0, impl:b, check:b, merge:wave1, checkpoint, behaviour-spec, acceptance:g1`.
- **Flow 2, the build rule and the flaky list reach the agents: ok.** A two-task build with `build_rule: "Use make test only."` and `flaky: ["t::a"]` returned `mvp`.
  - All 9 prompts carry the rule after the host text and before `Fixed rules (no exception):` (`order_ok=true` for each).
  - The quick-gate prompts (`impl:*`, `check:*`, `merge:wave*`) carry `- t::a` and the rerun-once rule. The checkpoint prompt carries neither and says `This is the full gate: it is never rerun.`
  - A `check:a` that reported `flaky_reruns: [{test: "t::a", gate: "quick"}]` shows up as `flaky_reruns: [{"id":"check:a","test":"t::a","gate":"quick"}]`.
- **Flow 3, commits are reported: ok.** In the same build, the commits are `{"checkpoint":"c0ffee1","behaviour-spec":"beef002","acceptance:g1":"acce003"}`: each phase id maps to the sha its agent reported.
- **Flow 4, one sweep: ok.** `part: "fix"`, `sweeps: 1`, `selected: [f2 (minor), f1 (critical)]`. The labels are `fix:f1, fix:f2, regress:fix:f1, regress:fix:f2`, so the critical runs first and there is one `regress:fix:<id>` agent per fix. No `second:` agent ran. The result is `status: "stable"` and `second_sweep: null`, with commits `{"fix:f1":"aa01","fix:f2":"aa02"}`.
- **Flow 5, a resume re-checks: ok.** The same run with `done: ["fix:f1", "fix:f2"]` and `attempt: 1` ran only `regress:fix:f2, regress:fix:f1`. Both prompts end `Run attempt 1.` (they ended `Run attempt 0.` in flow 4). No fix agent ran, and the status is `stable`.
- **Flow 6, the head's side: ok (read).** `skills/run/SKILL.md` names:
  - `flaky_reruns` (line 66: append to `log.md`, tell the user);
  - `commits` (line 73: `merge-base --is-ancestor` check, never cherry-pick; lines 128 and 135 for stages 4 and 5);
  - `unverified` (lines 113 and 117: offered as `unverified:` options when the user is present, never selected overnight);
  - `second_sweep: null` (line 130: record that one sweep ran).

  `templates/project.md` has `sweeps:` (line 22), `gate_slots:` (24), `flaky:` (26) and `## Build rule` (37).
- **Gaps.** None found. Nothing was fixed, and no product code or tests changed.

## 28–29 Oct 2026: build report (head)

- **Result.** Run wf_c6f6f1af-e23 (v0.1.0's `build.js`) returned `mvp`. All 11 tasks are merged: waves 3–7 merged `regress-sweeps`, `fix-minors`, `flaky-quick-gates`, `unverified-findings` and `second-namespace` in this resume.
- **Checkpoint.** The full gate passed, and all six user flows (spec §7) were ok with no gaps.
- **Acceptance.** 72 passing, 1 failing (HEAD-09), none untestable. To-green round 1 fixed HEAD-09 as a product fix, with no questions.
- **The head's check at 4aa467d.**
  - `npm test`: 428/428 Node and 107/107 Python.
  - The bundle check exits 0, and `claude plugin validate --strict` passes.
  - Every task and phase trailer is in `done_tasks.py`'s output, and the checkpoint commit 1f6c8fd is on the branch.
- **For stage 4.** New test lines reuse the old fixtures' example host name in about 7 places. The handover asked for no new mentions, so the head raises it as a finding for the owner's selection.
- **Stage 4's runner.** It is this branch's own v0.2 `stabilise.js` (a snapshot at 4aa467d), with `sweeps: 1`: one sweep, the selected fixes, then the per-fix regression check. That is the owner's method from the first run, now built in.

## 29 Oct 2026: stage 4a, the sweep (head)

- **The sweep.** Run wf_4cdc3439-099 (v0.2's `stabilise.js`, `part: "sweep"`) found 14 verified findings: 1 severe, 9 important, 4 minor. None were refuted, none blocked, none unverified.
- **security-01 (severe).** Agent-reported commit shas reach `commits` unchecked, and the run skill pastes them into a shell command. The owner was told when the list came back.
- **The owner's selection.** The owner chose these to fix:
  - security-01;
  - failure-paths-and-lifecycle-03 and test-strength-and-docs-01 (the task id `epic`);
  - test-strength-and-docs-02, -03, -06 and -07;
  - test-strength-and-docs-04 and -05;
  - failure-paths-and-lifecycle-05;
  - the head's head-fixture-host-01 (new test lines reuse the old fixtures' example host name).
- **Open items** (not selected):
  - **security-02** (a ref name passes the reachability check). security-01's fix, which limits `commits` to hex shas, should close it too: the regression check is asked to confirm.
  - **failure-paths-and-lifecycle-01, -02 and -04.** Phase, docs and evidence agents can't return `blocked`, because their schemas have no status, so a failed branch check is ignored. COMMITS-04 can't catch it.
- **The run skill edit (test-strength-and-docs-04).** It gets a GREEN scenario check after the fix wave, since fix agents can't start subagents.

## 29 Oct 2026: stage 4b, the fix wave (head)

- **The run.** wf_1dd578d4-e7b (`part: "fix"`, `sweeps: 1`, attempt 0) returned `stable`.
  - **Fixed (10):** failure-paths-and-lifecycle-03 and test-strength-and-docs-01 (one commit, 542e6f7), test-strength-and-docs-02, -03, -06, -04, -05 and -07, failure-paths-and-lifecycle-05 and head-fixture-host-01.
  - Nothing reverted. The ten per-fix regression agents each returned `regressions: []`.
- **security-01 came back as a contract item.** Task 3's contract let any non-empty string into `commits`, and its tests use non-hex fixtures, so the fix agent rightly changed nothing.
- **The owner's decision.** Hex shas only. Spec §8 is amended: a value that isn't a sha is left out and blocked with `commit is not a sha`. This should also close security-02.
- **The head's check at 3e30e75.** `npm test`: 436/436 Node and 107/107 Python; the bundle check exits 0. Every fix commit is on the branch, and no added line names the old example host.
- **The resume.** It continues with the same `selected`, `done` refreshed, `attempt: 1` (so the regression check runs again over every fix) and `answers["security-01"]`.

## 29 Oct 2026: the fix wave's regression check (head)

- **The resume.** It returned `handover`. security-01 was fixed in 06739d8 and test-strength-and-docs-01 in 1da789a.
- **The proven regression.** The per-fix regression agent reproduced it with a real SHA-256 repo. 06739d8 also tightened `shaOf()`, which builds the checker's tip check, from `/^[0-9a-f]{4,64}$/i` to `SHA_RE = /^[0-9a-f]{7,40}$/`, so 64-character and uppercase shas read as "no sha reported" and every task fails its check. The cause is the head's `{7,40}` recommendation, which left out SHA-256. The other 10 regression agents found nothing.
- **The owner's decision.** A forward fix, as with the stale-private-ref fix in v0.1: one pattern, `/^[0-9a-f]{7,64}$/`, for `commits` and the checker. Spec §8 is amended.
  - It runs as the selected finding `regress-security-01` (critical), with `attempt: 2`, so every fix's regression check runs again.
  - Then the stage stops: no further sweep.

## 29 Oct 2026: stage 4 ends (head)

- **The forward fix.** regress-security-01 was fixed in 83f30c4: one pattern, `/^[0-9a-f]{7,64}$/`, for `commits` and the checker. The run (`attempt: 2`) returned `handover` with one regression, against `fix:security-01`'s own diff (06739d8 vs 327a76d). It is the same regression, already fixed forward by 83f30c4, as that agent's evidence notes. The regression agent for 83f30c4 and the other ten found nothing.
- **The head's check at 83f30c4.**
  - `SHA_RE` is 7–64 lowercase hex in `src/` and all three bundles.
  - A real SHA-256 sha passes; uppercase, 6-character, `HEAD` and `$(curl x|sh)` are rejected.
  - `npm test`: 441/441 Node and 107/107 Python. The bundle check exits 0, and `validate --strict` passes.
- **Stage 4 stops here** (hard stop). The owner is present, and the handover is this log and the report to the owner.
- **New open item: the per-fix regression check.** Each agent checks its fix's diff against that fix's parent, not against the branch HEAD. So a regression that was later fixed forward is reported again on every rerun of the check. A redo would tell each agent the branch HEAD as well, and count only a regression that still reproduces there.
- **New open item: plan ownership.** The plan skill doesn't make a task own the existing tests its change will break. This build blocked twice on it (`docs-v02` and `test/manifest.test.mjs`; `regress-sweeps` and the shared stabilise tests).

## 29 Oct 2026: run skill check after the fix wave (head)

- **The check.** writing-skills RED/GREEN (wf_9d7dfc06-461), 3 subagents per scenario plus a judge.
  - **RED** was run on the skill at `13fe946^`: J (blocked `regress:fix:<id>`) failed 0/3, K (`second:verify:<id>`) 0/3, L (publish's `commit is not a sha`) 3/3.
  - **GREEN** at HEAD: J, K and L each failed 0/3.
- **Reading.** test-strength-and-docs-04's rewording wasn't needed for J and K: the older text already led there. L is a real fix, from security-01's run skill line.

## 29 Oct 2026: stage 5 (head)

- **The runner.** v0.2's `publish.js` at 132b895 (after the sha fix).
- **The publish result.** wf_fdfd62fa-d92 returned `ready`, with the full gate green (exit 0). docs is at 3aeb69e and evidence at 0394a31; both are on the branch.
- **The head's edit.** The docs agent ended `pr-body.md` with a Claude Code attribution line, which the owner's rules forbid, so the head removed it. Nothing else in the branch has attribution. The head reran `npm test` after the edit before pushing.
