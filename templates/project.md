---
# Where temper writes epics.md and each epic's spec, research, plan and log.
specs_dir: docs/temper
# The quick gate: a fast check run after every task and every merge.
gate_quick:
# The full gate: everything CI runs, used at the checkpoint and before a PR.
gate_full:
# Where tasks run: local, or ssh <host> <root> for a build host.
host: local
# For an ssh host: the repo's clone on the host (absolute or ~/, the same way as <root>), outside <root>/<epic>/.
# The head fetches the epic and task branches back from it. Leave it empty for a local host.
host_clone:
# Ignored files cleanup may delete with a worktree, comma-separated, e.g. target/, node_modules/, __pycache__/.
# A trailing / matches a directory, a leading / anchors to the worktree root; * never matches /, only ** spans directories.
# Any other ignored file blocks cleanup.
disposable:
# Board mirroring of epic status: off, github or jira. A board failure never blocks a run.
board: off
# Extra review lenses for stage 4, comma-separated. They run as well as the defaults.
lenses:
# Review sweeps in stage 4: 2 (a second sweep after the fixes) or 1 (one sweep, then a regression check).
sweeps: 2
# How many gates the project's scripts run at once (see templates/gate-slots.md); empty means 1.
gate_slots:
# Per-task checks in stage 3: each (a checker after every task, with one retry) or none (each task's own
# quick gate and the merge's gate only; review happens once, in stage 4's sweep). Empty means each.
task_checks:
# Known flaky tests, comma-separated, named as the test runner prints them; a quick gate that fails only on these is rerun once.
flaky:
---

# Project settings for temper

The front block above is read by the head session when it plans and runs an epic. Edit it by hand, or ask Claude to change it.

## Severity notes

<!-- Language or project notes added to the default severity rubric (severe, critical, important, minor), e.g. "a panic on user input is critical". -->

## Build rule

<!-- How agents build and test in this project, as free text, e.g. "build only through the gate scripts; never set a private target dir". The plan copies it into args.json as build_rule, and every agent's prompt carries it, so task texts never repeat it. Leave it empty when there is no rule. -->
