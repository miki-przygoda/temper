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

## Section 3: stage 4, `/temper:stabilise` (approved 24 Oct 2026)

It runs in two parts, with a pause between them so the user can choose what gets fixed.

### 4a: sweep, then the list

1. **Sweep.** Reviewers run in parallel, each in its own throwaway worktree, each with one lens.
   - Default lenses: security; failure paths and lifecycle; test strength and docs. `.temper/project.md` can add lenses for the language.
   - A finding needs an input and the wrong result it produces. Style points don't count.
2. **Verify.** A separate agent tries to disprove each finding. It reproduces the finding and re-rates its severity against the rubric plus the project's notes. Duplicates are merged.
3. **The list, ordered by severity.** The run ends here.
   - With the user present, the head shows the list as a multiple-choice box and the user picks what gets fixed.
   - Overnight, the head picks according to the user's preferences (by default everything Critical and Important) and logs its choice. Minor findings go to the open items.

### 4b: careful fixes, one at a time, in severity order

For each fix:
1. **Trace its origin.** `git blame` leads to the `Temper-Task` trailer, which leads to the task and its contract. If the contract itself is wrong, the change goes to the user or the spec, never into a quiet code fix.
2. Write a failing test first.
3. Make the smallest fix.
4. **Check the impact.** Look at what depends on the changed code, using the plan's contract graph. Then run the whole acceptance suite and the quick gate.
5. If anything else breaks, revert and rethink. Move on to the next item only once this one is clean.

### The second sweep and the stop

1. **The second sweep** uses fresh agents. They are given the list of what was fixed, so they don't report it again.
2. **What happens next:**
   - **Nothing severe:** the stage is done. Non-severe findings go to the open items, not into the code.
   - **Something severe:** fix it with the same five steps, then check only those fixes' own diffs. Then stop and hand over to the user. There is never a third sweep.
3. **It returns** the fixed branch, plus open items in `log.md`.

## Section 4: the skills around the scripts, stages 1, 2 and 5 (approved 24 Oct 2026)

### Stage 1, `ground`: from an idea to specs

It wraps `superpowers:brainstorming` and adds:
- **Question style from the user's preferences:** open text while ideas are being dumped, multiple-choice questionnaires once there is a base.
- **Research agents, in parallel:** best practices, prior art, and documented facts with their sources. The notes go to `docs/temper/<epic>/research.md`, and the spec cites them.
- **A size recommendation:** run the whole lifecycle, or stop at the specs (epics for a board). The user decides.
- **The epic split:** `epics.md` lists each epic and what it needs from the others, written as contracts.
- **A spec template with required sections:**
  - goal;
  - user flows (the MVP checkpoint runs these);
  - contracts between parts;
  - non-goals;
  - security notes.

  A spec is handed on only when it has no open questions. Each one is answered, or explicitly deferred with a reason.

### Stage 2, `plan`: from a spec to a plan

It wraps `superpowers:writing-plans` and adds:
- a written contract at every boundary between tasks;
- file ownership: no two tasks in the same wave own the same file;
- waves taken from the dependency graph, with blocking tasks first;
- the names of the behaviour groups;
- task ids for the commit trailers;
- the gate commands from `project.md`.

It generates `args.json`. The workflow script checks `args.json` itself before it starts any agent, so nothing extra has to be installed. The user reviews the plan before stage 3 starts, unless their preferences let overnight runs go ahead without that review.

### Stage 5, `publish`: from a branch to a PR

- Docs are written against the final code.
- Steps that need root, real accounts or real infrastructure go into a script and a checklist for the user.
- Then the full gate. Only on a green gate does it push the branch and open the PR.

Pushing is outward-facing, so the head asks first, unless the preferences allow pushing branches and opening PRs. It never merges.

### Cleanup

`/temper:cleanup` runs after the user merges. It removes worktrees, branches and build directories, but only after the coded git check passes:
- the branch is reachable from `origin/master`, or matches the remote;
- nothing is left uncommitted or untracked.

If the check fails, nothing is deleted and the user is told.
