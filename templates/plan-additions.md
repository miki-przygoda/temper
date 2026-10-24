# What `/temper:plan` adds to a superpowers plan

<!-- /temper:plan writes the plan with superpowers:writing-plans, then adds the items below. The head turns them into args.json, which follows schemas/args.schema.json. -->

## Per task

Each task heading carries a task id (it becomes the commit trailer `Temper-Task: <epic>/<id>`), and each task adds these lines under its heading:

```
Owns: src/a.rs, tests/a_test.rs
Uses: A-contract
Provides: B-contract
Wave: 1
```

- **Owns:** the files only this task may change. No two tasks in the same wave own the same file.
- **Uses:** the contracts this task builds against. Each must be provided by a task in an earlier wave.
- **Provides:** the contracts this task defines, written out at the boundary (types, signatures, formats, errors).
- **Wave:** an integer from 0. Tasks that block others come first, and wave 0 builds the shared contracts.

## Waves

A table of which tasks run at the same time, taken from the dependency graph:

| Wave | Tasks | Why |
|---|---|---|
| 0 | a | the shared contracts |
| 1 | b, c | separate files, both using wave 0's contracts |

## Behaviour groups

A list of the behaviour groups the stage 3 behaviour spec is written in, each a key and a title:

- `g1`: <title>
- `g2`: <title>

## How each maps to `args.json`

| Plan item | `args.json` field |
|---|---|
| the epic's name | `epic` |
| the repo, epic branch and base branch | `repo`, `branch`, `base` |
| the spec, plan and log paths | `spec`, `plan`, `log` (`<specs_dir>/<epic>/spec.md`, `plan.md`, `log.md`) |
| `host` in `.temper/project.md` | `host`: `{"kind":"local"}` or `{"kind":"ssh","name":…,"root":…}` |
| `gate_quick` and `gate_full` in `.temper/project.md` | `gates`: `{"quick":…,"full":…}` |
| each task's id and heading | `tasks[].id`, `tasks[].title` |
| each task's `Wave:` line | `tasks[].wave` |
| each task's `Owns:` line | `tasks[].owns` |
| each task's `Uses:` line | `tasks[].uses` |
| each task's `Provides:` line | `tasks[].provides` |
| each task's full section text | `tasks[].text` |
| the `## Waves` table | a cross-check of `tasks[].wave`; not a field of its own |
| the `## Behaviour groups` list | `behaviour_groups`: `[{"key":…,"title":…}]` |
| the finished ids from the epic branch's trailers (`done_tasks.py`) | `done` |
| the head's answers to blocked questions | `answers`: `{"<task id>": "<answer>"}` |
