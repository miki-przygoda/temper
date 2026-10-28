# temper v0.3: spec

Date: 28 Oct 2026. Status: written from the owner's questionnaire answers of 28 Oct, for the owner's review. Sources:
- the open items of v0.2 (`docs/temper/v0-2/log.md` and PR #4);
- the v1 leftovers in `docs/v1-log.md`.

Every change here gets an amendment in `docs/specs/2026-10-24-temper-design.md`, numbered from **A22**. Where this spec and an earlier one disagree, this spec wins.

## Goal

v0.3 closes what the v0.2 build left for the head to do by hand:
- phases that can't say they're blocked;
- plans whose tasks don't own the tests they break;
- throwaway worktrees left behind, which the cleanup check couldn't judge;
- a regression check that re-reports regressions already fixed;
- the v1 leftovers that are now safe to redo.

It also raises the Python minimum to 3.10.

**Success criteria:**
- Each change below has a test that fails on v0.2.0's code (`main` at 16c11c8) and passes on v0.3's. For skill text, the test is a RED/GREEN subagent check (superpowers:writing-skills), plus a text-asserting test.
- `npm test`, `node scripts/bundle.mjs --check` and `claude plugin validate . --strict` pass, and CI is green.
- No fixed rule is loosened.

## User flows

The checkpoint runs these. It drives the committed `workflows/*.js` through `test/harness.mjs` with scripted responders, and runs the scripts against throwaway git repos.

1. **A phase blocks.** A build in which the checkpoint agent returns `status: "blocked"` with `reason: "HEAD detached"` returns `status: "blocked"` with `{id: "checkpoint", reason: "HEAD detached"}`, and runs no later phase. The same holds in publish when the docs agent returns blocked: publish returns `blocked`, never `ready`.
2. **A red checkpoint commits nothing, and a resume reruns it.** A checkpoint whose gate failed returns blocked. Its prompt tells it to commit the trailer only on a green gate. A resume with `attempt` bumped gives a checkpoint prompt that differs from the first one, so it runs live.
3. **Throwaway worktrees are removed.** Every prompt that uses a throwaway worktree names its path under `.temper/worktrees/<epic>/tmp/<label>` and says to remove it with `git worktree remove` (never `--force`) before returning.
   - `cleanup_check.py <repo> --detached --worktree <path>` exits 0 for a clean detached worktree whose HEAD is on `origin/main`.
   - It exits 1 for one whose HEAD is on no remote branch, or one with an uncommitted change.
4. **The regression check counts only what still reproduces.** Each `regress:fix:<id>` prompt names the branch's current tip and says a regression counts only when it reproduces there too.
5. **Stale private refs are pruned.** After a task branch is deleted on the host, `host_sync.py fetch` leaves no `refs/temper/host/temper/<epic>/<that id>` ref behind. Checked with `ssh_host_smoke.sh --local`, or a unit test against two local repos.
6. **The head's side.**
   - The plan skill makes a task own the existing tests its change breaks.
   - The cleanup skill uses `--detached` for detached worktrees.
   - The run skill bumps `attempt` on a build resume after a checkpoint block, and treats a phase's `blocked` with a reason as a blocked item.

## Contracts between parts

- **Phase results.**
  - `CHECKPOINT_SCHEMA`, `BEHAVIOUR_SCHEMA`, `ACCEPTANCE_SCHEMA`, `GREEN_SCHEMA`, `DOCS_SCHEMA` and `EVIDENCE_SCHEMA` gain `status: 'done' | 'blocked'` (required) and `reason: string` (optional).
  - `build.js` and `publish.js` treat `status !== 'done'` as blocked, with `{id: <phase id>, reason: r.reason || 'phase returned status ' + r.status}`, and run nothing after it.
  - A `commit` such a phase reported still goes through `recordSha` into `commits`.
  - **A blocked phase keeps its other required fields,** sent empty (`""`, `[]`). The prompts' "Return …" lines say so. *My call:* the schemas and their schema-case tests change least this way.
  - **The order of checks for a phase result:**
    1. `null` → `agent returned nothing`;
    2. `status !== 'done'` → blocked with the agent's `reason`;
    3. record the commit, if it is a sha. A blocked phase adds no second `commit is not a sha` entry: it has one blocked entry, the agent's.
    4. For the checkpoint only, `gate_passed !== true` → blocked, as today.

    A `done` checkpoint with a red gate still blocks. *My call.*
- **The build's `attempt`.** `validateBuildArgs` accepts an optional `attempt` (an integer of 0 or more, missing means 0), as stabilise already does. `checkpointPrompt` ends with `Run attempt <n>.`, and so does every phase prompt after it, so a resume after a red checkpoint runs the checkpoint live. The run skill bumps `attempt` on **every** build resume, as it does for `part: "fix"`. Task prompts don't carry it, and finished phases are skipped through `done`, so a bump reruns only what isn't done. *My call:* one rule is simpler than "only after a checkpoint block".
- **The checkpoint prompt.** It commits its log section with the trailer only when the full gate passed. On a red gate, it commits nothing and returns blocked, with the gate log in `reason`. This changes behaviour: v0.2 commits on every run.
- **Throwaway worktrees.**
  - `throwawayText(args, label) -> string` names `<repo>/.temper/worktrees/<epic>/tmp/<label>` (for an ssh host, `<root>/<epic>/tmp/<label>`). It says to create it detached, and to remove it with `git worktree remove <path>` before returning, never `--force`.
  - If removal fails, the agent says so in its result: as one of `problems` for the checker, or in `reason`/`note`/`evidence` for the others.
  - It is used by the checker, reviewer, verifier, regression and gate prompts. The gate prompt names no worktree today, so for the gate this is new behaviour.
  - **The label.** `tmpLabel(label) -> string` lowercases the agent's label, replaces every character outside `[a-z0-9-]` with `-`, and appends `-` plus 8 hex characters of a 32-bit FNV-1a hash of the raw label. So `a:b` and `a-b` never share a path. *My call.*
  - **When the path already exists** (an agent that died left it), the agent first removes it with `git worktree remove <path>`, never `--force`. If that fails, it returns blocked with the reason. *My call.*
- **`cleanup_check.py`.**
  - `cleanup_check.py <repo> --detached --worktree <path> [--remote R] [--no-fetch] [--disposable P ...]` checks a detached worktree:
    - its HEAD must be reachable from the remote's default branch, or from any other remote-tracking branch of that remote (`refs/remotes/<remote>/*`). So a throwaway on a task or epic commit passes once that branch is pushed, whatever merge style the project uses. *My call.*
    - its status must be clean, except for disposable ignored files;
    - it must be a worktree of `<repo>`.
  - The JSON output and exit codes are unchanged. The `branch` positional becomes optional; exactly one of `branch` and `--detached` must be given.
  - `--detached` without `--worktree`, a branch argument together with `--detached`, or a worktree that isn't detached gives exit 1 with a reason.
- **The regression prompt.** `regressPrompt(fixId, args)` also names the branch tip. Its rule is: "A regression counts only when it reproduces on the current tip of `<branch>` as well; give both reproductions." It still ends with `Run attempt <n>.`
- **`host_sync.py fetch`** passes `--prune` to the private fetch. Only refs under `refs/temper/host/<branch>` and `refs/temper/host/temper/<epic>/` are touched; `refs/heads/` never is.
- **Plan test ownership.** The plan skill tells the planner, for each task:
  - to search the tests for every function, label, prompt line and file the task changes (`git grep`);
  - to put each existing test file that asserts them into the task's `Owns:`;
  - when two tasks need the same test file, to put them in different waves.
- **The cleanup skill.** It also lists every detached worktree under `.temper/worktrees/<epic>/` (on an ssh host, `<root>/<epic>/`), including `tmp/`, from `git worktree list --porcelain`. It checks each one with `--detached` and removes it only on exit 0. On an ssh host, `rmdir <root>/<epic>/tmp` comes before `rmdir <root>/<epic>`.

  No code checks this. The skill's RED/GREEN scenario and a text test pin it.
- **Python.** The minimum becomes 3.10:
  - the README says so;
  - CI's oldest job runs Node 20 with Python 3.10 on `ubuntu-latest`, and the `ubuntu-24.04` pin goes (setup-python has a 3.10.22 build for Ubuntu 26.04, checked 28 Oct);
  - the scripts stay stdlib only.

## Non-goals

- **Running the head on the build host** (the run ends with the head's session). It stays documented only.
- **TESTS-DOCS-5, the overnight mode check.** There is still no safe way for the head to refresh the permission mode without a new prompt (see `docs/v1-log.md`'s redo note). It stays open, with that reason.
- **A code check of plan test ownership.** Which tests a change breaks isn't knowable from `args.json`. The skill carries it.
- **Deleting remote branches in cleanup** (spec 8).

## Security notes

- **The phase's `reason` is agent text.** The head treats it as data. It goes into `blocked` and `log.md`, never into a shell command.
- **The throwaway worktree label is sanitised** to `[a-z0-9-]` before it reaches a path in a prompt. Finding ids already match `ID_RE`.
- **`cleanup_check.py --detached` deletes nothing.** The cleanup skill still removes a worktree only on exit 0, without `--force`.
- **`--prune` on the private fetch touches only `refs/temper/host/`.** The fast-forward-only rule for `refs/heads/` is unchanged.

## Deferred questions

- **TESTS-DOCS-5:** deferred (Non-goals), until a mode signal exists that doesn't depend on a new prompt.
- **Item 7 of v0.2 (answers without a new launch):** confirmed by the owner on 28 Oct as needing no code (v0.2 spec §3.7a). Nothing to do.
