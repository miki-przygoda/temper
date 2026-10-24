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

## Section 2: stage 3, `/temper:build` (approved 24 Oct 2026)

### Input: `args.json`, generated from `plan.md`

- the tasks, each with an id, a wave, the files it owns, and the contracts it uses and provides;
- the quick and full gate commands, and where tasks run (local, or an ssh host);
- the behaviour groups;
- `done` (finished task ids) and `answers` (answers to blocked questions).

### Flow

1. **Contracts first.** Wave 0 builds the shared contracts (types, interfaces, formats) that other tasks depend on.
2. **Each wave runs its tasks in parallel.** Every task goes through three steps:
   1. **The implementer** works in its own worktree. It follows the task's text, writes the plan's tests first, commits with the `Temper-Task` trailer and runs the quick gate.
   2. **A separate checker** confirms that:
      - the diff touches only the files the task owns;
      - the plan's tests are present and not weakened;
      - the quick gate passes;
      - deliberately breaking the code makes the tests fail (a spot-check).
   3. **If the check fails,** the implementer gets **one retry** with the checker's report. A second failure counts as `blocked`.
3. **Merging.** After each wave, a merge agent merges the worktrees into the epic branch in dependency order, running the quick gate after each merge. **Every merge conflict counts as `blocked`.** No agent resolves a conflict on its own judgement.
4. **MVP checkpoint.** The full gate, plus a manual run of the real program through each flow the spec describes. It records gaps and fixes nothing.
5. **Behaviour spec.** A separate agent writes it from `spec.md`, never from the code.
6. **Acceptance tests.** One agent per behaviour group writes them, without touching product code. A test that fails because of the product stays in the suite, marked ignored with its behaviour id.
7. **Fix to green, at most 2 rounds.** For each failing test, decide which case it is:
   - **the product is wrong:** make the smallest fix;
   - **the test is wrong:** correct it, citing the spec line;
   - **the spec doesn't decide:** it becomes a question.

   A fix that breaks anything else is reverted, not patched on top.
8. **It returns a build report.**

### When an implementer must stop and return `blocked`

- changing a contract;
- adding a dependency;
- touching a file it doesn't own;
- editing the tests it is judged by;
- anything privileged, or outside the project.

Anything the task text, the contracts and the tests already settle is the implementer's to decide.
