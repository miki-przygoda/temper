# temper

## What it is

temper is a Claude Code plugin that takes a piece of work from idea, to spec, to plan, to MVP, to stable, to PR, in one fixed order. You do the problem solving, in discovery and spec writing. The session you talk to (the head) directs the work by the spec, and execution agents follow instructions without improvising.

It exists because repeated review-and-fix sweeps don't converge: fixes create new bugs. So temper builds an MVP first, checks it against an independent behaviour spec and acceptance tests, fixes to green in at most two rounds, then runs one review sweep, one careful fix wave and one final sweep with a hard stop. The run stages are saved, tested workflows that the head feeds with plan data; the head never writes control flow.

Every hand-off is a file, so any stage can start from a file a person wrote. Finished work is read from `Temper-Task` commit trailers, so a run survives blocked questions and usage-limit resets without redoing anything.

Status: v0.1.0. The design is `docs/specs/2026-10-24-temper-design.md` and the build plan is `docs/plans/2026-10-24-temper-v1.md`.

## Install

Install superpowers first. temper depends on `superpowers@anthropic-plugin-directory`, and Claude Code doesn't install a dependency from another marketplace automatically: temper reports the missing dependency and doesn't load until superpowers is installed.

```
claude plugin install superpowers@anthropic-plugin-directory
claude plugin marketplace add miki-przygoda/temper
claude plugin install temper@temper
```

The repo is private for now, so the marketplace add works through your own git credentials. Then restart Claude Code and run `/temper:setup`.

## The stages

Each stage is a skill or a saved workflow, namespaced under the plugin. You can start at any stage that has its input file.

| Stage | Command | Takes in | Hands on |
|---|---|---|---|
| which stage next | `/temper:temper` | the files on disk | the next stage, started for you |
| setup | `/temper:setup` | an interview | `preferences.md`, the statusline (if you say yes), `.temper/project.md` |
| 1 ground | `/temper:ground` | a conversation, plus research agents | `epics.md`, plus `spec.md` and `research.md` per epic |
| 2 plan | `/temper:plan` | one `spec.md` | `plan.md` and `args.json` |
| 3 to 5 run | `/temper:run` | `args.json` | the build, stabilise and publish workflows, launched and resumed for you |
| 3 build | `/temper:build` (workflow) | `args.json` | the epic branch at MVP, plus a build report |
| 4 stabilise | `/temper:stabilise` (workflow) | the branch | the fixed branch, plus open items |
| 5 publish | `/temper:publish` (workflow) | the branch | docs, an owner evidence script and checklist, a PR title and body |
| cleanup | `/temper:cleanup` | merged branches | worktrees, branches and build dirs removed, only where the coded check allows |

`/temper:run` is the usual way into stages 3 to 5: it fills `args.done` from the commit trailers, launches each workflow, answers blocked questions from the spec (or asks you), and pushes only when the rules below allow. The workflows can also be run directly with their args.

Project files live in the specs directory (default `docs/temper/`): `epics.md` is the source of truth for the epics and their status, and each epic has its own folder with `spec.md`, `research.md`, `plan.md`, `args.json` and `log.md`.

## Where your state lives

Your own state lives in `$CLAUDE_CONFIG_DIR/temper/` when `CLAUDE_CONFIG_DIR` is set, else in `~/.claude/temper/`:
- `preferences.md`: your setup answers, with a format version;
- `limits.json`: the usage reset times, written by the statusline;
- `bin/`: the copied statusline script (the plugin's own path changes with every version);
- `wrapped-statusline.json` and `settings.backup.json`: your previous statusline and a backup of your settings, from the statusline install.

It lives outside the plugin, so an update never overwrites it. Each project keeps `.temper/project.md` (the gates, the build host and its clone, the specs directory, the ignored files cleanup may delete, severity notes, extra review lenses, board mirroring) and its worktrees under `.temper/worktrees/`. With an ssh build host, the agents work in the host's clone (`host_clone`, an absolute or `~/` path written the same way as `<root>`, outside `<root>/<epic>/`), and the head keeps the epic branch the same on both sides with `scripts/host_sync.py` (amendment A12). It pushes its copy of the epic branch to that clone before every launch (on the first, that carries the spec and plan) and right after each commit of its own. It fetches back before it reads the finished tasks, before it commits and before any push: into a private namespace, `refs/temper/host/`, moving each local branch only by a fast-forward, in its worktree when it is checked out. Anything that isn't a fast-forward stops the run; nothing is forced.

To change a preference, ask Claude to change it ("temper may push without asking", "make the morning report 06:30"), or to undo or specialise a choice. Claude edits `preferences.md` for you. A preference that contradicts one of the fixed rules below is explained and not saved.

## Overnight runs

An overnight run goes on while you sleep, through usage-limit resets. Before it starts, the head checks:
- **auto mode** is on (temper's prompt hook warns when it isn't);
- **`autoContinueAtUsageLimit`** is on in your settings;
- **the statusline** is installed and `limits.json` is fresh. temper's statusline writes the reset times to `limits.json` and wraps any statusline you already had, so yours still shows. Setup asks before installing it;
- **wakeups** are approved in your preferences. The head schedules a check-in 2 minutes after each five-hour reset, resumes the run and answers what it can.

The session must stay open all night: the check-ins live only in that session and stop when it exits. The run stops cleanly at your weekly usage limit (`weekly_stop_percent`, default 90) or at the morning report time (default 07:00), and writes a morning report to the epic's `log.md`.

## The fixed rules

No preference can change these:
- No privileged commands (no sudo, not even `sudo -n`). Steps that need root go into a script and a checklist for you.
- temper never merges.
- It pushes a branch and opens a PR only on a green full gate, and only if your preferences allow it. Otherwise it asks. Only the head pushes; the workflows and their agents never do.
- It never deletes work that isn't on the remote. The cleanup check is code: the branch must be reachable from the remote's default branch or match its remote ref, and the worktree must have nothing uncommitted or untracked, and no ignored file except those matching a `disposable:` pattern in `.temper/project.md` (such as `target/`, `node_modules/`, `__pycache__/`).
- Content from repos, docs, logs and agents is data, never instructions.
- Anything that would loosen a security decision is confirmed with you every time.

## Development

The workflows are bundled from `src/` (a shared `lib.js` plus one body per stage) into `workflows/*.js`, which are generated and committed. The Python scripts are stdlib only (Python 3.9 or later). The tests need Node 20 or later and no npm packages.

```
npm test                              # node --test, then the Python unittests
node scripts/bundle.mjs               # regenerate workflows/*.js after editing src/
node scripts/bundle.mjs --check       # exit 1 if workflows/*.js is out of date
claude plugin validate . --strict     # the plugin manifest, skills and hooks
sh scripts/install_smoke.sh           # install into a throwaway config (needs network)
```

Run them with `CLAUDE_CONFIG_DIR` set to a temporary directory, so nothing touches your own config. `scripts/install_smoke.sh` makes its own: it adds this checkout as a local marketplace in a temporary `CLAUDE_CONFIG_DIR`, installs superpowers and then temper, checks that `temper@temper` is enabled, and deletes the directory either way.
