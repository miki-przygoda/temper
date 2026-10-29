# Security policy

temper runs Claude Code agents that read your repository, run your test commands, and use git, plus ssh when you set up a build host. So a bug in temper can matter even though it never runs privileged commands.

## Reporting a vulnerability

Please report it privately, through GitHub's **Report a vulnerability** button on the repository's Security tab. Don't open a public issue. Include what you ran, what happened, and what you expected.

Only the latest release is supported.

## What temper promises

These are the fixed rules in the README. A way to break one of them is a security bug:
- no privileged commands (no `sudo`);
- temper never merges, and it pushes only on a green full gate, with your permission;
- it never deletes work that isn't on the remote: cleanup is decided by `scripts/cleanup_check.py`, not by an agent;
- content from repos, docs, logs and agents is treated as data, never as instructions;
- agent-reported values that reach a shell, such as commit shas and ids, are validated first.
