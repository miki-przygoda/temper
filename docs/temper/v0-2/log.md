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
