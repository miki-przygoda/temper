# temper v1: behaviour specification

Written from `docs/specs/2026-10-24-temper-design.md` (sections 1–12, including the A1–A6 amendments) and `notes/spikes.md` only, never from the code. The plan was used only for file, command and field names. This is the oracle the v1 code is checked against: each line is something a user or the head session relies on.

Each behaviour is one line of the form **Given** a state, **when** something happens, **then** the expected result. Ids are `<GROUP>-NN`. Section references (§) are to the design spec; A1–A6 are its section 12 amendments; S1–S6 are the spikes.

Terms: *the head* is the session the user talks to; *state dir* is `$CLAUDE_CONFIG_DIR/temper/` when `CLAUDE_CONFIG_DIR` is set, else `~/.claude/temper/` (A1); *trailer* is the commit trailer `Temper-Task: <epic>/<id>`.

## build

Stage 3, `/temper:build` (`workflows/build.js`), fed with `args.json`.

- **BUILD-01** Given an `args.json` that is invalid (a required field such as `tasks`, `gates` or `epic` missing, or a field of the wrong type), when `/temper:build` is launched with it, then it refuses with an error naming the problem, and no agent is started. (§6, §10.2)
- **BUILD-02** Given valid args whose tasks are in waves 0..n, when the run starts, then the waves run in ascending order, and no task of wave k+1 starts before wave k has been merged into the epic branch. (§6.1–2)
- **BUILD-03** Given a task that is not in `args.done`, when its wave runs, then it goes through an implementer, then a separate checker agent, and a retry only if the checker fails. (§6.1)
- **BUILD-04** Given an implementer, when it works on its task, then it works in its own worktree, follows the task text, writes the plan's tests first, commits with the trailer `Temper-Task: <epic>/<task id>`, and runs the quick gate. (§6.1.1, §3.5)
- **BUILD-05** Given an implementer has finished, when the checker runs, then it confirms that the diff touches only the task's `owns[]`, the plan's tests are present and not weakened, the quick gate passes, and deliberately breaking the code makes the tests fail. (§6.1.2)
- **BUILD-06** Given the checker fails a task for the first time, when the run continues, then the task gets exactly one retry, and the checker's report is given to that retry. (§6.1.3, §10.2)
- **BUILD-07** Given the retry also fails the checker, when the run continues, then the task counts as blocked; there is no third attempt. (§6.1.3)
- **BUILD-08** Given an agent of a task returns `{status: "blocked", question, context}`, when the rest of that wave is still running, then the other tasks of the wave finish, and the run then ends with the list of blocked tasks (each with its question) instead of starting the next wave. (§3.6.1–2, §10.2)
- **BUILD-09** Given a task's work is not confirmed by its checker (it failed twice, it was blocked, or an agent returned nothing), when the run reports, then that task is never reported as done. (§6.1, §1 success criteria)
- **BUILD-10** Given a task id is in `args.done`, when the run is launched or resumed, then no agent is started for that task and its work is not redone. (§3.5, §10.2)
- **BUILD-11** Given a phase id (checkpoint, behaviour spec, an acceptance group, a to-green round) is in `args.done`, when the run reaches that phase, then the phase is skipped. (A6)
- **BUILD-12** Given the phases after the waves (checkpoint, behaviour spec, acceptance groups, to-green rounds, fixes), when each commits, then the commit carries the trailer `Temper-Task: <epic>/<phase id>`. (A6)
- **BUILD-13** Given `args.answers[<task id>]` holds an answer, when the run resumes, then that answer is put into that task's prompt and into no other task's prompt. (§3.6.4)
- **BUILD-14** Given a run that ended blocked, when the head resumes it with the finished ids in `args.done` and the answers in `args.answers`, then finished tasks are not run again and the blocked tasks run again with their answers. (§3.5, §3.6.5, §1 success criteria)
- **BUILD-15** Given every task in a wave has passed, when the wave is merged, then a merge agent merges the task worktrees into the epic branch in dependency order and runs the quick gate after each merge. (§6.2)
- **BUILD-16** Given a merge hits a conflict, when the merge agent reports it, then it counts as blocked, the run ends with it in the blocked list, and the next wave does not start. (§6.2, §10.2)
- **BUILD-17** Given all waves are merged, when the MVP checkpoint runs, then it runs the full gate plus a manual run of each user flow from the spec, records the gaps, and changes no product code. (§6.3)
- **BUILD-18** Given the checkpoint has run, when the behaviour spec is written, then a separate agent writes it from `spec.md` only, never from the code, in the plan's behaviour groups. (§6.4)
- **BUILD-19** Given the behaviour spec, when the acceptance tests are written, then there is one agent per behaviour group, and none of them touches product code. (§6.5)
- **BUILD-20** Given an acceptance test that fails because of the product, when the acceptance agent finishes, then the test stays in the suite, marked ignored with its behaviour id; it is not deleted or weakened. (§6.5)
- **BUILD-21** Given failing behaviours after the acceptance tests, when to-green runs, then each failure is handled as one of: the product is wrong (the smallest fix), the test is wrong (corrected, citing the spec line), or the spec doesn't decide (it becomes a question in the report). (§6.6)
- **BUILD-22** Given a to-green fix breaks anything else, when that is found, then the fix is reverted, never patched on top. (§6.6)
- **BUILD-23** Given failures remain after the second to-green round, when the run continues, then there is no third round; the remaining failures go into the report. (§6.6, §1, §10.2)
- **BUILD-24** Given the run finishes, when it returns, then it returns a build report with the tasks, the gates, the checkpoint flows, the acceptance pass and fail counts, the questions and the blocked items. (§6.7)
- **BUILD-25** Given an implementer would need to change a contract, add a dependency, touch a file outside `owns[]`, edit the tests it is judged by, or do anything privileged or outside the project, when it reaches that point, then it stops and returns blocked instead. (§6)
- **BUILD-26** Given something the task text, the contracts and the tests settle, when the implementer meets it, then it decides itself and does not return blocked. (§6)
- **BUILD-27** Given `host` is `local`, when a task runs, then its worktree is a git worktree under a temper-owned directory; given `host` is `ssh <host>`, then the worktree is on that host and commands run over ssh with a per-epic build directory. (§3.4)

## stabilise

Stage 4, `/temper:stabilise` (`workflows/stabilise.js`), on the epic branch.

- **STABILISE-01** Given the branch, when the first sweep (4a) runs, then reviewers run in parallel, each with one lens and each in a throwaway worktree. (§7 4a.1)
- **STABILISE-02** Given no extra lenses in `.temper/project.md`, when the sweep runs, then the lenses are: security; failure paths and lifecycle; test strength and docs. Given extra lenses in `project.md`, then those run as well as the defaults. (§7 4a.1)
- **STABILISE-03** Given a reviewer's finding that does not give an input and the wrong result it produces, when findings are collected, then it is not accepted as a finding. (§7 4a.1)
- **STABILISE-04** Given the reviewers' findings, when the verify step runs, then a separate agent tries to disprove each one and reproduces it; findings it disproves do not reach the list, and duplicates are merged into one. (§7 4a.2)
- **STABILISE-05** Given a verified finding, when it is rated, then its severity is re-rated against the rubric (Severe, Critical, Important, Minor; §7.1) plus the project's severity notes, not taken from the reviewer. (§7 4a.2, §7.1)
- **STABILISE-06** Given the verified findings, when 4a ends, then the list is ordered by severity (Severe first, Minor last) and the run ends without fixing anything. (§7 4a.3)
- **STABILISE-07** Given the list and the user present, when the head continues, then it shows a multi-select question box of the findings. (§7 4a.3)
- **STABILISE-08** Given the list and an overnight run, when the head continues, then it picks the findings to fix by the preferences (default: Critical and Important) and logs its choice in `log.md`; Minor findings go to the open items. (§7 4a.3, §9)
- **STABILISE-09** Given a Minor finding, when 4b runs, then it is never fixed in the code; it goes to the open items. (§7.1)
- **STABILISE-10** Given the chosen findings, when 4b runs, then they are fixed one at a time, in severity order. (§7 4b)
- **STABILISE-11** Given a finding to fix, when its fix starts, then its origin is traced: `git blame` leads to the `Temper-Task` trailer, which leads to the task and its contract. (§7 4b.1)
- **STABILISE-12** Given the traced contract is itself wrong, when that is found, then the item goes to the user or the spec, never into a quiet code fix. (§7 4b.1)
- **STABILISE-13** Given a finding to fix, when it is fixed, then a failing test is written first, and then the smallest fix. (§7 4b.2–3)
- **STABILISE-14** Given a fix, when it is checked, then the dependants from the plan's contract graph are checked, then the whole acceptance suite and the quick gate run. (§7 4b.4)
- **STABILISE-15** Given a fix breaks anything else, when the impact check finds it, then the fix is reverted and rethought; the next finding starts only when this one is clean. (§7 4b.5)
- **STABILISE-16** Given 4b is finished, when the second sweep runs, then it uses fresh agents that are told what was already fixed. (§7 second sweep.1)
- **STABILISE-17** Given the second sweep finds nothing severe, when it ends, then the stage is done and the non-severe findings go to the open items. (§7 second sweep.2)
- **STABILISE-18** Given the second sweep finds something severe, when it ends, then those findings are fixed with the same five steps, only those fixes' diffs are checked, and the run stops and hands over to the user. (§7 second sweep.2)
- **STABILISE-19** Given any outcome of the second sweep, when the stage continues or is resumed, then there is never a third sweep. (§7, §1, §10.2)
- **STABILISE-20** Given a Severe finding, when it is found, then the user is contacted per the `severe_contact` preference (a push notification, the morning report only, or a push for anything blocking). (§7.1, §9)
- **STABILISE-21** Given fixes committed with their trailers, when the stage is resumed with those ids in `args.done`, then those fixes are not redone. (A6, §3.5)

## publish

Stage 5, `/temper:publish` (`workflows/publish.js`), on the epic branch.

- **PUBLISH-01** Given a stabilised branch, when `/temper:publish` runs, then it writes docs against the final code, an evidence script and checklist, and a PR title and body file. (§3.2, A5)
- **PUBLISH-02** Given publish has finished, when it returns, then it returns `ready` with a PR title and the path of the PR body file, and it has neither pushed nor opened a PR. (A5)
- **PUBLISH-03** Given any prompt that `publish.js` gives an agent, when it is read, then it never instructs the agent to push or to open a PR. (A5, §8)
- **PUBLISH-04** Given publish returned `ready` and the full gate is green, when `may_push` is `yes` in the preferences, then the head pushes the branch and opens the PR. (A5, §8)
- **PUBLISH-05** Given publish returned `ready` and the full gate is green, when `may_push` is not `yes`, then the head asks the user, and pushes and opens the PR only if the user says yes. (A5, §8)
- **PUBLISH-06** Given the full gate is not green, when publish ends, then nothing is pushed and no PR is opened, whatever the preferences say. (A5, §8)
- **PUBLISH-07** Given steps that need root, when the evidence is written, then they go into a script and a checklist for the user, and no agent runs them. (§8)
- **PUBLISH-08** Given a PR is open, when the run ends, then temper does not merge it. (§8)

## state

The state directory, preferences, project files and the statusline.

- **STATE-01** Given `CLAUDE_CONFIG_DIR` is set (e.g. `~/.claude-work`), when temper reads or writes user state, then it uses `$CLAUDE_CONFIG_DIR/temper/`. (A1)
- **STATE-02** Given `CLAUDE_CONFIG_DIR` is unset or empty, when temper reads or writes user state, then it uses `~/.claude/temper/`. (A1)
- **STATE-03** Given setup has run, when the state dir is listed, then it holds `preferences.md` with the setup answers and a format version. (§3.3, §9)
- **STATE-04** Given no `preferences.md`, when temper loads preferences, then it uses the defaults: keyword trigger off, morning report time 07:00 local, overnight fixes Critical and Important, weekly stop at 90 per cent of the seven-day limit. (§9)
- **STATE-05** Given a user's `preferences.md`, when the plugin is updated, then the file is unchanged, since it lives outside the plugin directory. (§3.3)
- **STATE-06** Given the user asks Claude to change, undo or specialise a preference, when the head does it, then the change is written to `preferences.md` in the state dir. (§9, §3.3)
- **STATE-07** Given the user asks for a preference that contradicts a fixed rule (e.g. allow sudo, let temper merge, push on a red gate), when the head handles it, then it explains why and does not save it. (§8)
- **STATE-08** Given the statusline script receives input with `rate_limits`, when it runs, then it writes `<state>/limits.json` holding the `five_hour` and `seven_day` values as received (`used_percentage`, `resets_at`) and a `seen_at` time. (S3, §9)
- **STATE-09** Given the user already had a statusline before temper's was installed, when temper's statusline runs, then it runs the user's statusline with the same input and prints that statusline's output. (§9, S3)
- **STATE-10** Given the user's wrapped statusline fails or hangs, when temper's statusline runs, then `limits.json` is still written and the statusline still returns. (§9)
- **STATE-11** Given setup installs the statusline, when it does, then it copies the script into `<state>/bin/` and points the `statusLine` setting at that copy, not at the plugin's cache path. (A4)
- **STATE-12** Given an existing `statusLine` setting, when the statusline is installed, then the user's command is kept for wrapping, and every other setting is left as it was. (§9, A4)
- **STATE-13** Given temper's statusline is already installed, when it is installed again, then the wrapped command stays the user's own, not temper's (it never wraps itself). (§9)
- **STATE-14** Given the statusline is installed, when it is uninstalled (`install_statusline.py uninstall`), then the user's original `statusLine` comes back, or the key is removed if they had none. (§9, A4)
- **STATE-15** Given the copy in `<state>/bin/` is from a different plugin version, when `/temper:run` starts, then it copies the current script again. (A4)
- **STATE-16** Given `limits.json` with a `seen_at` older than about 10 minutes, when the overnight pre-flight checks it, then it counts as not fresh. (S3, §9)
- **STATE-17** Given a project, when temper sets it up, then `.temper/project.md` holds the quick and full gate commands, the build host, the specs directory (default `docs/temper/`), severity notes, extra review lenses and board mirroring on or off. (§3.3)
- **STATE-18** Given a project, when stages run, then `docs/temper/epics.md` is the source of truth for the epics, their contracts and their status, and each epic's `spec.md`, `research.md`, `plan.md` and `log.md` live in `docs/temper/<epic>/`. (§3.3)
- **STATE-19** Given decisions, blocked questions and answers, morning reports and open items, when they happen, then they are recorded in the epic's `log.md`. (§3.3)
- **STATE-20** Given an epic's status changes, when board mirroring is on, then the head updates the board after the change to `epics.md`; a board that fails to update never blocks the run, and the failure is noted in `log.md`. (§3.3)
- **STATE-21** Given a hand-written `spec.md`, `plan.md` or `args.json`, when the matching stage is started on it, then it runs from that file as if an earlier stage had written it. (§1, §3.2)

## hook

The `UserPromptSubmit` hook (`hooks/hooks.json`, `hooks/prompt_submit.py`).

- **HOOK-01** Given the plugin is installed, when a prompt is submitted, then the `UserPromptSubmit` hook from `hooks/hooks.json` runs, with its script found through `${CLAUDE_PLUGIN_ROOT}`. (§11)
- **HOOK-02** Given the keyword trigger is off (the default, or no `preferences.md`), when a prompt contains "temper", then the hook adds no keyword context. (§9, §2)
- **HOOK-03** Given the keyword trigger is on, when the prompt contains "temper", then the hook returns `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":...}}` telling the head to use temper. (§9, S2)
- **HOOK-04** Given the keyword trigger is on, when the hook input's `cwd`, `transcript_path` or another field contains "temper" but the `prompt` does not, then no keyword context is added: only the `prompt` field is matched. (A3, S2)
- **HOOK-05** Given `permission_mode` is not `auto`, when the prompt starts a temper run (e.g. `/temper:build`), then the hook adds a warning naming the current mode and that overnight runs need auto mode. (§9, S2)
- **HOOK-06** Given `permission_mode` is `auto`, when the prompt starts a temper run, then no mode warning is added. (§9)
- **HOOK-07** Given there is nothing to add, when the hook runs, then it prints nothing and exits successfully, so the prompt goes through unchanged. (§9)
- **HOOK-08** Given `CLAUDE_CONFIG_DIR` is set, when the hook reads preferences, then it reads them from `$CLAUDE_CONFIG_DIR/temper/preferences.md`. (A1)
- **HOOK-09** Given a missing or unreadable `preferences.md`, or hook input it cannot parse, when the hook runs, then it does not block the prompt or fail the turn. (§9)

## git-safety

The fixed rules (§8), finished work from git, and the cleanup check.

- **GIT-SAFETY-01** Given any stage, agent or script, when it would run a privileged command, then it does not: no `sudo`, not even `sudo -n`; the root step goes into a script and a checklist for the user. (§8)
- **GIT-SAFETY-02** Given any stage, when it ends, then temper has not merged the epic branch or a PR into the base or default branch. (Merging task worktrees into the epic branch in stage 3 is part of the build.) (§8, §6.2)
- **GIT-SAFETY-03** Given any workflow script, when it runs, then it never pushes or touches the remote; push rights stay with the head on the user's machine. (§3.4, A5)
- **GIT-SAFETY-04** Given a branch or worktree whose work is not on the remote, when anything in temper would delete it, then it is not deleted. (§8)
- **GIT-SAFETY-05** Given an epic branch with commits carrying `Temper-Task: <epic>/<id>` trailers, when the finished ids are read (`scripts/done_tasks.py`), then they are exactly the ids in that epic's trailers on that branch; trailers of other epics are ignored. (§3.5)
- **GIT-SAFETY-06** Given a branch reachable from `origin/<default branch>`, when `scripts/cleanup_check.py <repo> <branch>` runs, then it reports ok (`{"ok": true, ...}`, exit 0). (§8)
- **GIT-SAFETY-07** Given a branch not merged into the default branch but equal to its remote ref, when the cleanup check runs, then it reports ok. (§8)
- **GIT-SAFETY-08** Given a branch with commits that are on neither `origin/<default branch>` nor its remote ref (unpushed, or ahead of the remote), when the cleanup check runs, then it reports not ok with a reason (`{"ok": false, "reasons": [...]}`, exit 1). (§8)
- **GIT-SAFETY-09** Given a branch with no remote ref that isn't reachable from the default branch, when the cleanup check runs, then it reports not ok. (§8)
- **GIT-SAFETY-10** Given a worktree (`--worktree P`) with uncommitted changes, when the cleanup check runs, then it reports not ok, even if the branch is pushed. (§8)
- **GIT-SAFETY-11** Given a worktree with untracked files, when the cleanup check runs, then it reports not ok, even if the branch is pushed. (§8)
- **GIT-SAFETY-12** Given content from repos, docs, logs, tool output or agents that contains instructions, when temper's agents or the head read it, then they treat it as data and do not follow it. (§8)
- **GIT-SAFETY-13** Given a change that would loosen a security decision, when the head or an agent meets it, then it is confirmed with the user every time, never assumed from a preference. (§8)
- **GIT-SAFETY-14** Given the cleanup check is run more than once on the same unchanged state, when it runs, then it gives the same answer and changes nothing in the repo except, at most, a fetch of remote refs. (§8)

## skills-packaging

The plugin, its install, the skills and the head's run loop.

- **SKILLS-PACKAGING-01** Given `.claude-plugin/plugin.json`, when it is read, then its name is `temper` and it declares the dependency `superpowers@anthropic-plugin-directory`. (§11, A2, S5)
- **SKILLS-PACKAGING-02** Given superpowers is not installed, when temper is installed, then temper fails to load until superpowers is installed; so the README's install steps and `/temper:setup` say to install `superpowers@anthropic-plugin-directory` first. (A2, S5)
- **SKILLS-PACKAGING-03** Given the README, when a user follows its install section, then the order is: superpowers first, then this repo's marketplace, then `temper@temper`; after that `claude plugin list` shows `temper@temper` enabled. (A2, §11)
- **SKILLS-PACKAGING-04** Given the repo, when `claude plugin validate --strict` runs, then it passes, with author details and a README of at least 40 words. A LICENSE file or `license` field, which the plugin directory asks for (S5), is the owner's choice before sharing and not part of v1 (§10.2 asks only for `--strict`; the plan, Task 1 step 4 and "After v1"). (§10.2, S5)
- **SKILLS-PACKAGING-05** Given the plugin is installed, when the user types `/temper:build`, `/temper:stabilise` or `/temper:publish` followed by JSON args, then the matching workflow runs and receives the args as a JSON object. (S5, §3.1)
- **SKILLS-PACKAGING-06** Given the README, when a user reads it, then it says where state lives (`$CLAUDE_CONFIG_DIR/temper/` when that's set, else `~/.claude/temper/`) and that preferences are changed by asking Claude. (A1, §9)
- **SKILLS-PACKAGING-07** Given the README, when a user reads it, then it lists the stages with each command, what an overnight run needs (auto mode, the session staying open, the statusline), and the fixed rules. (§3.2, §8, §9)
- **SKILLS-PACKAGING-08** Given no `preferences.md`, when temper is first used, then `/temper:setup` runs first. (§9)
- **SKILLS-PACKAGING-09** Given `/temper:setup`, when it runs, then it asks one questionnaire with tabs covering: question style; the overnight contact for severe items; whether an overnight run may start without the plan review; whether temper may push and open PRs; what gets fixed overnight by default; approval for overnight wakeups; the morning report time; whether the keyword trigger is on. (§9)
- **SKILLS-PACKAGING-10** Given setup has written the answers, when it finishes, then it tells the user where `preferences.md` is and that they can ask Claude to change, undo or specialise any choice. (§9)
- **SKILLS-PACKAGING-11** Given the project files, when the router skill picks the next stage, then it picks by the state of the files (e.g. no `epics.md` → ground; a spec but no `args.json` → plan). (§3.2)
- **SKILLS-PACKAGING-12** Given `/temper:ground`, when it runs, then it uses the preferred question style, runs research agents in parallel (best practices, prior art, documented facts each with a source link) into `research.md`, recommends the full lifecycle or specs only, and writes `epics.md` with the contracts between epics. (§4)
- **SKILLS-PACKAGING-13** Given a spec with open questions, when ground would hand it on, then it does not; a spec is handed on only with goal, user flows, contracts, non-goals, security notes and deferred questions with reasons, and no open questions. (§4)
- **SKILLS-PACKAGING-14** Given `/temper:plan` on a spec, when it writes the plan, then every task boundary has a written contract, no two tasks in the same wave own the same file, waves follow the dependency graph with wave 0 building the shared contracts, and the plan names the behaviour groups, the task ids and the gate commands from `project.md`. (§5)
- **SKILLS-PACKAGING-15** Given a finished plan, when plan ends, then it writes an `args.json` that follows `schemas/args.schema.json`, and the user reviews the plan before stage 3 unless their preferences let an overnight run go ahead without that review. (§5)
- **SKILLS-PACKAGING-16** Given an epic branch, when the head launches or resumes any run stage, then it first reads the trailers on that branch and passes the finished ids as `args.done`. (§3.5)
- **SKILLS-PACKAGING-17** Given a workflow finishes while the head is idle, when the completion notification arrives, then the head starts a turn on its own and reads the return value (including the blocked list) from it, with no file to poll. (S1)
- **SKILLS-PACKAGING-18** Given a blocked question that the spec settles, when the head handles it, then it answers it from the spec. (§3.6.3)
- **SKILLS-PACKAGING-19** Given a blocked question the spec doesn't settle and that is severe, when the head handles it, then it asks the user, or tells them per their preferences. (§3.6.3)
- **SKILLS-PACKAGING-20** Given a blocked question the spec doesn't settle and that isn't severe, when the head handles it, then it decides and records the decision in `log.md`. (§3.6.3)
- **SKILLS-PACKAGING-21** Given the answers, when the head resumes, then each answer is in `args.answers[<task id>]` for its own task, and the run is relaunched with the refreshed `args.done`. (§3.6.4–5)
- **SKILLS-PACKAGING-22** Given an overnight run is about to start, when the head runs the pre-flight, then it checks that auto mode is on, `autoContinueAtUsageLimit` is on, the statusline is installed and wraps any existing statusline, `limits.json` is fresh, and wakeups are approved, and it tells the user the session must stay open. (§9)
- **SKILLS-PACKAGING-23** Given an overnight run is launched, when the head schedules wakeups, then the first check-in is 2 minutes after `rate_limits.five_hour.resets_at`. (§9)
- **SKILLS-PACKAGING-24** Given a check-in fires, when it runs, then it reads the journal, resumes the run if it stopped on the limit, answers the blocked questions it can, and schedules the next check-in. (§9)
- **SKILLS-PACKAGING-25** Given `seven_day.used_percentage` is at or above the weekly stop (default 90, preferences can lower it), or the next five-hour reset falls after the morning report time, when a check-in runs, then the head stops cleanly and writes the morning report. (§9)
- **SKILLS-PACKAGING-26** Given the overnight run ends, when the morning report is written, then it is a summary in `log.md`, plus a push notification if the preferences ask for one. (§9)
- **SKILLS-PACKAGING-27** Given an epic moves to a new stage, when the head records it, then the epic's status in `epics.md` is updated. (§3.3)
- **SKILLS-PACKAGING-28** Given `/temper:cleanup`, when it runs, then it removes worktrees, branches and build directories only for items the cleanup check (`scripts/cleanup_check.py`) passes, keeps the others and reports why. (§3.2, §8)
