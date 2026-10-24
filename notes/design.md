# temper design, section by section

Each section is approved by the owner before the next one is written. Once every section is approved, the sections become the spec in `docs/specs/`.

## Section 1: what lives where, and how a stage hands on to the next (approved 24 Oct 2026)

### State: three places, each with one job

| Where | File | Holds |
|---|---|---|
| The user's account | `~/.claude/temper/preferences.md` | the setup interview's answers and any later changes |
| The user's account | `~/.claude/temper/limits.json` | usage reset times, written by the statusline script |
| The project | `.temper/project.md` | gate and quick-check commands, build host, where specs go (default `docs/temper/`), severity notes, board mirror on or off |
| The project | `docs/temper/epics.md` | the epics, the dependencies between them as contracts, and each epic's status. This file is the source of truth; a Jira or GitHub Projects board only mirrors it. |
| The project | `docs/temper/<epic>/spec.md`, `plan.md` | the outputs of stages 1 and 2 |
| The project | `docs/temper/<epic>/log.md` | the run's decisions, blocked questions and answers, and the open items for the user |

### Hand-offs between stages

```
ground  → epics.md + spec.md per epic
plan    → plan.md: tasks, contracts, dependency waves, behaviour groups
        → args.json, generated from plan.md and checked against a schema
/temper:build      args.json → branch at MVP + build report
/temper:stabilise  branch → fix list → fixed branch + open items
/temper:publish    branch → docs, gate, PR (the user merges)
```

Every arrow is a file. Any stage can start from a file a person wrote by hand, and Cairn can later pass a spec from one session to another.

### Checkpoints

- Every task's commit carries a `Temper-Task: <id>` trailer.
- Before launching or resuming a run, the head reads the trailers from git and passes the finished task ids as `args.done`. The script skips those tasks.
- So answering a blocked question, or editing a prompt, never reruns finished work. The list of finished work comes from git, where the work actually lives, not from the workflow engine's cache, which only replays the longest unchanged prefix of calls.

### Blocked questions inside a run

1. An agent returns `blocked` with its question.
2. The script lets the rest of the current wave finish, then ends the run and returns the blocked list.
3. The head answers from the spec. A question the spec doesn't settle goes to the user if it's severe; otherwise the head decides and records the decision in `log.md`.
4. The head writes each answer into `args.answers[<task id>]`. An answer appears only in that task's prompt, so no other cached call changes. Then the head resumes the run.
