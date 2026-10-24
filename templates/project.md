---
# Where temper writes epics.md and each epic's spec, research, plan and log.
specs_dir: docs/temper
# The quick gate: a fast check run after every task and every merge.
gate_quick:
# The full gate: everything CI runs, used at the checkpoint and before a PR.
gate_full:
# Where tasks run: local, or ssh <host> <root> for a build host.
host: local
# Board mirroring of epic status: off, github or jira. A board failure never blocks a run.
board: off
# Extra review lenses for stage 4, comma-separated. Empty uses the defaults.
lenses:
---

# Project settings for temper

The front block above is read by the head session when it plans and runs an epic. Edit it by hand, or ask Claude to change it.

## Severity notes

<!-- Language or project notes added to the default severity rubric (severe, critical, important, minor), e.g. "a panic on user input is critical". -->
