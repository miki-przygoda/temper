# temper v0.3: behaviour spec

Written from `docs/temper/v0-3/spec.md` only. Each behaviour has an id `<GROUP>-NN` and given/when/then lines.

## phases

Phase, docs and evidence agents can return blocked with a reason, and the build's `attempt` reruns a red checkpoint live (spec, Contracts: phase results, the build's `attempt`, the checkpoint prompt; user flows 1 and 2).

### PHASES-01
- Given: `CHECKPOINT_SCHEMA`, `BEHAVIOUR_SCHEMA`, `ACCEPTANCE_SCHEMA`, `GREEN_SCHEMA`, `DOCS_SCHEMA` and `EVIDENCE_SCHEMA`.
- When: they are read.
- Then: each has a required `status` of `'done'` or `'blocked'` and an optional string `reason`.

### PHASES-02
- Given: a build in which the checkpoint agent returns `status: "blocked"` with `reason: "HEAD detached"`.
- When: the build runs.
- Then: it returns `status: "blocked"` with the entry `{id: "checkpoint", reason: "HEAD detached"}`, and runs no phase after the checkpoint.

### PHASES-03
- Given: a publish in which the docs agent returns `status: "blocked"` with a reason.
- When: publish runs.
- Then: it returns `blocked`, never `ready`, with an entry `{id: <the docs phase id>, reason: <the agent's reason>}`, and runs nothing after the docs phase.

### PHASES-04
- Given: a publish in which the evidence agent returns `status: "blocked"` with a reason.
- When: publish runs.
- Then: it returns `blocked`, never `ready`, with the evidence phase's id and the agent's reason, and runs nothing after it.

### PHASES-05
- Given: a phase in `build.js` or `publish.js` that returns a `status` other than `done` and no `reason`.
- When: its result is checked.
- Then: the run is blocked with `{id: <phase id>, reason: 'phase returned status ' + <status>}`.

### PHASES-06
- Given: a phase agent that returns nothing (`null`).
- When: its result is checked.
- Then: the run is blocked with the reason `agent returned nothing`, before any status check.

### PHASES-07
- Given: a blocked phase result that reports a `commit` that is a sha.
- When: its result is checked.
- Then: the commit is recorded through `recordSha` into `commits`, and the run is still blocked.

### PHASES-08
- Given: a blocked phase result whose `commit` is not a sha (for example `""`).
- When: its result is checked.
- Then: the run has exactly one blocked entry for that phase, the agent's, and no second `commit is not a sha` entry.

### PHASES-09
- Given: a checkpoint result with `status: "done"` and `gate_passed` not `true`.
- When: its result is checked.
- Then: the build is blocked, as in v0.2.

### PHASES-10
- Given: a phase agent that is blocked.
- When: its prompt's "Return ..." line is read.
- Then: it tells the agent to keep its other required fields, sent empty (`""`, `[]`), alongside `status: "blocked"` and a `reason`.

### PHASES-11
- Given: a checkpoint prompt.
- When: it is built.
- Then: it tells the agent to commit its log section with the trailer only when the full gate passed, and on a red gate to commit nothing and return blocked with the gate log in `reason`.

### PHASES-12
- Given: build args with no `attempt`, or with `attempt` an integer of 0 or more.
- When: `validateBuildArgs` checks them.
- Then: they are accepted, and a missing `attempt` counts as 0.

### PHASES-13
- Given: build args with an `attempt` that is not an integer of 0 or more (negative, fractional, or not a number).
- When: `validateBuildArgs` checks them.
- Then: they are rejected, as stabilise rejects them.

### PHASES-14
- Given: a build with `attempt` n.
- When: the checkpoint prompt and every phase prompt after it are built.
- Then: each ends with `Run attempt <n>.`; task prompts do not carry it.

### PHASES-15
- Given: a build whose checkpoint returned blocked on a red gate.
- When: it is resumed with `attempt` bumped.
- Then: the checkpoint prompt differs from the first one, so the checkpoint runs live, while finished phases are still skipped through `done`.

## worktrees

Throwaway worktrees are named under `tmp/` and removed, `cleanup_check.py --detached` judges them, and stale private host refs are pruned (spec, Contracts: throwaway worktrees, `cleanup_check.py`, `host_sync.py fetch`; user flows 3 and 5).

### WORKTREES-01
- Given: a local run and an agent label.
- When: `throwawayText(args, label)` is called.
- Then: it names the path `<repo>/.temper/worktrees/<epic>/tmp/<tmpLabel(label)>`.

### WORKTREES-02
- Given: a run on an ssh host with root `<root>`.
- When: `throwawayText(args, label)` is called.
- Then: it names the path `<root>/<epic>/tmp/<tmpLabel(label)>`.

### WORKTREES-03
- Given: any `throwawayText` output.
- When: it is read.
- Then: it says to create the worktree detached and to leave it in place when done, because cleanup removes it and agents never delete a worktree.

### WORKTREES-04
- Given: the checker, reviewer, verifier, regression and gate prompts.
- When: each is built.
- Then: each names its throwaway worktree through `throwawayText`, under `.temper/worktrees/<epic>/tmp/<label>` (or `<root>/<epic>/tmp/<label>` on an ssh host); the gate prompt, which named no worktree in v0.2, now does.

### WORKTREES-05
- Given: any prompt that uses a throwaway worktree.
- When: it is read.
- Then: it never tells the agent to remove a worktree; the fixed rule "never delete branches or worktrees" stays.

### WORKTREES-06
- Given: a label.
- When: `tmpLabel(label)` is called.
- Then: the result is the label lowercased, with every character outside `[a-z0-9-]` replaced by `-`, followed by `-` and 8 hex characters of the 32-bit FNV-1a hash of the raw label, so it contains only `[a-z0-9-]`.

### WORKTREES-07
- Given: the labels `a:b` and `a-b`.
- When: `tmpLabel` is called on each.
- Then: the results differ, so the two never share a path.

### WORKTREES-08
- Given: a throwaway path that already exists (left by an agent that died, or an earlier run with the same label).
- When: a prompt using `throwawayText` is read.
- Then: it tells the agent to reuse the path with `git -C <path> checkout --detach <the branch or commit it checks>`, never to remove it, and to return blocked with the reason if that fails (uncommitted changes, or not a worktree). Before the checkout, it checks that `git -C <path> rev-parse --show-toplevel` prints the same directory as `cd <path> && pwd -P` and that `git -C <path> status --porcelain` prints nothing, and returns blocked, never deleting or cleaning the path, if either fails (A30). The checker, reviewer, verifier, regression and gate results carry `status: 'done' | 'blocked'` and an optional `reason`, and the workflow takes any status but `done` as a blocked entry with that agent's id (`check:<task>`, `recheck:<task>`, `review:<lens>`, `verify:<id>`, `regress:fix:<id>`, `gate`) and its reason, never as a clean result: a blocked verifier leaves its finding unverified, not refuted (test-strength-and-docs-01).

### WORKTREES-09
- Given: a clean detached worktree of `<repo>` whose HEAD is on `origin/main`.
- When: `cleanup_check.py <repo> --detached --worktree <path>` runs.
- Then: it exits 0.

### WORKTREES-10
- Given: a clean detached worktree of `<repo>` whose HEAD is reachable from a remote-tracking branch of the remote other than its default branch (`refs/remotes/<remote>/*`, such as a pushed task or epic branch).
- When: `cleanup_check.py <repo> --detached --worktree <path>` runs.
- Then: it exits 0.

### WORKTREES-11
- Given: a detached worktree whose HEAD is on no remote branch.
- When: `cleanup_check.py <repo> --detached --worktree <path>` runs.
- Then: it exits 1.

### WORKTREES-12
- Given: a detached worktree whose HEAD is on `origin/main` but which has an uncommitted change.
- When: `cleanup_check.py <repo> --detached --worktree <path>` runs.
- Then: it exits 1.

### WORKTREES-13
- Given: a detached worktree whose HEAD is on a remote branch and whose only changes are ignored files matched by `--disposable`.
- When: `cleanup_check.py <repo> --detached --worktree <path> --disposable <P>` runs.
- Then: it exits 0.

### WORKTREES-14
- Given: a detached worktree path that is not a worktree of `<repo>`.
- When: `cleanup_check.py <repo> --detached --worktree <path>` runs.
- Then: it exits 1.

### WORKTREES-15
- Given: `cleanup_check.py` called with `--detached` but no `--worktree`, or with both a branch argument and `--detached`, or with `--worktree` pointing at a worktree that is not detached.
- When: it runs.
- Then: it exits 1 with a reason.

### WORKTREES-16
- Given: `cleanup_check.py` called with neither a branch nor `--detached`.
- When: it runs.
- Then: it refuses, because exactly one of `branch` and `--detached` must be given; called with a branch and no `--detached`, it behaves as in v0.2.

### WORKTREES-17
- Given: any `cleanup_check.py --detached` run.
- When: it finishes.
- Then: its JSON output and exit codes have the same shape as for a branch check, and it has deleted nothing.

### WORKTREES-18
- Given: a task branch that was deleted on the host after its private ref `refs/temper/host/temper/<epic>/<id>` was fetched.
- When: `host_sync.py fetch` runs.
- Then: the private fetch passes `--prune`, and no `refs/temper/host/temper/<epic>/<id>` ref is left behind.

### WORKTREES-19
- Given: a `host_sync.py fetch` with `--prune`.
- When: it runs.
- Then: it touches only refs under `refs/temper/host/<branch>` and `refs/temper/host/temper/<epic>/`; `refs/heads/` is never touched, and its fast-forward-only rule is unchanged.

## regress

The per-fix regression check counts only what reproduces on the branch tip (spec, Contracts: the regression prompt; user flow 4).

### REGRESS-01
- Given: a fix id and run args with a branch.
- When: `regressPrompt(fixId, args)` builds the `regress:fix:<id>` prompt.
- Then: it names the branch's current tip.

### REGRESS-02
- Given: a `regress:fix:<id>` prompt.
- When: it is read.
- Then: it states the rule "A regression counts only when it reproduces on the current tip of `<branch>` as well; give both reproductions."

### REGRESS-03
- Given: a `regress:fix:<id>` prompt built with `attempt` n.
- When: it is read.
- Then: it still ends with `Run attempt <n>.`

## head

The plan, cleanup and run skills carry the head's side (spec, Contracts: plan test ownership, the cleanup skill, the build's `attempt`; Security notes; user flow 6).

### HEAD-01
- Given: the plan skill.
- When: it tells the planner how to write a task.
- Then: it says to search the tests (`git grep`) for every function, label, prompt line and file the task changes.

### HEAD-02
- Given: the plan skill.
- When: it tells the planner how to write a task.
- Then: it says to put each existing test file that asserts what the task changes into the task's `Owns:`.

### HEAD-03
- Given: the plan skill and two tasks that need the same test file.
- When: the planner assigns waves.
- Then: the skill says to put the two tasks in different waves.

### HEAD-04
- Given: the cleanup skill.
- When: it lists worktrees to clean.
- Then: it lists every detached worktree under `.temper/worktrees/<epic>/` (on an ssh host, `<root>/<epic>/`), including `tmp/`, from `git worktree list --porcelain`.

### HEAD-05
- Given: the cleanup skill and a detached worktree.
- When: it decides whether to remove it.
- Then: it checks it with `cleanup_check.py --detached --worktree <path>` and removes it only on exit 0, without `--force`.

### HEAD-06
- Given: the cleanup skill on an ssh host.
- When: it removes the epic's directories.
- Then: `rmdir <root>/<epic>/tmp` comes before `rmdir <root>/<epic>`.

### HEAD-07
- Given: the run skill and a build to resume.
- When: it resumes the build, after a checkpoint block or any other stop.
- Then: it bumps `attempt` on every build resume, as it does for `part: "fix"`.

### HEAD-08
- Given: the run skill and a phase that returned `blocked` with a reason.
- When: it handles the result.
- Then: it treats it as a blocked item, and treats the `reason` as agent text and data: it goes into `blocked` and `log.md`, never into a shell command.
