---
name: cleanup
description: Remove a finished epic's worktrees, local branches and build directories, but only what the coded cleanup check says is safe. Use when an epic's PR is merged, or when the user runs /temper:cleanup.
---

# temper cleanup

temper never deletes work that isn't on the remote (spec 8). Whether something is safe to delete is decided by code, `cleanup_check.py`, never by you reading `git status` or `git log`. You only act on its exit status.

## What to check

For the epic (or each epic the user names, or each epic in `epics.md` whose status is `ready` or `merged`), list:
- the epic branch, and every `temper/<epic>/<task id>` task branch;
- every worktree for them: `git worktree list` under `.temper/worktrees/` for a `local` host; for an `ssh <host> <root>` host, the worktrees under `<root>/<epic>/` on that host;
- the per-epic build directory on the host, `<root>/<epic>/`, when the host is `ssh`.

## The check

Run it once for each branch, with its worktree when it has one:

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup_check.py" <repo> <branch> --worktree <path>
```

Leave out `--worktree` for a branch without a worktree. For a worktree on an ssh host, run the same script there, fed on stdin, against the host's clone:

```
ssh <host> python3 - <host repo> <branch> --worktree <path> < "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup_check.py"
```

It fetches the remote first, then prints `{"ok": bool, "reasons": [...]}`:
- **exit 0:** the branch is reachable from the remote's default branch, or matches its own remote ref, and the worktree has nothing uncommitted or untracked. It is safe to delete.
- **exit 1:** not safe. Nothing is deleted for that branch or its worktree. Show the user the `reasons` as they are.

Any other exit status, a crash, or output you can't parse counts as exit 1.

## Deleting, only on exit 0

For a branch whose check exited 0, in this order:
1. `git worktree remove <path>` for its worktree (on the host over ssh for an ssh worktree). Never pass `--force`.
2. `git branch -d <branch>`. Never `-D`. If `-d` refuses, stop for that branch and tell the user.
3. When every worktree under the host's `<root>/<epic>/` has passed and been removed, delete that per-epic build directory on the host: `ssh <host> 'rm -r <root>/<epic>'`. If any worktree under it failed its check, nothing is deleted there.

Never delete a remote branch, and never work around a refusal: no `--force`, no `-D`, no `rm` of a worktree, no `git reset` or `git clean` to make a check pass. When a check says exit 1, nothing is deleted and the user decides what to do with the work.

## The report

Tell the user, per branch: deleted (with the worktree and directory removed), or kept with the check's reasons. Note the cleanup in the epic's `log.md`.
