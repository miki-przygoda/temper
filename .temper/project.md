---
# Where temper writes epics.md and each epic's spec, research, plan and log.
specs_dir: docs/temper
# The quick gate: a fast check run after every task and every merge.
gate_quick: npm test
# The full gate: everything CI runs, used at the checkpoint and before a PR.
gate_full: npm test && node scripts/bundle.mjs --check && CLAUDE_CONFIG_DIR="$(mktemp -d)" claude plugin validate . --strict
# Where tasks run: local, or ssh <host> <root> for a build host.
host: local
# For an ssh host: the repo's clone on the host (absolute or ~/, the same way as <root>), outside <root>/<epic>/.
# The head fetches the epic and task branches back from it. Leave it empty for a local host.
host_clone:
# Ignored files cleanup may delete with a worktree, comma-separated, e.g. target/, node_modules/, __pycache__/.
# A trailing / matches a directory, a leading / anchors to the worktree root; * never matches /, only ** spans directories.
# Any other ignored file blocks cleanup.
disposable: node_modules/, __pycache__/
# Board mirroring of epic status: off, github or jira. A board failure never blocks a run.
board: off
# Extra review lenses for stage 4, comma-separated. They run as well as the defaults.
lenses:
---

# Project settings for temper

The front block above is read by the head session when it plans and runs an epic. Edit it by hand, or ask Claude to change it.

## Severity notes

<!-- Language or project notes added to the default severity rubric (severe, critical, important, minor), e.g. "a panic on user input is critical". -->
