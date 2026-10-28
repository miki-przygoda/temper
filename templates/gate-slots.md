# Gate slots: running several gates at once

<!-- For a project whose gates are slow or share one build lock; temper's setup points here. temper doesn't read this file. Set `gate_slots` in `.temper/project.md` to the number of slots your gate script runs. -->

A gate that holds one build lock for its whole run makes every other gate wait. Give the project's gate script N slots instead, so N gates build at once and the rest wait for a free slot.

## The slot pattern

- Keep N slot dirs in one directory of your choosing, each with its own lock file.
- The gate script tries each slot with `flock -n` on its lock file and takes the first free one. When none is free, it waits on one with a plain `flock`; that wait is normal, not a failure.
- Each slot has its own build output dir (point the build tool's output dir into the slot) and its own test scratch dir. Two gates never share either.
- The lock goes with the process, so a crashed gate frees its slot.

## The built-from stamp

Each slot keeps a stamp file naming the last worktree that built in it. When a different worktree takes the slot, the gate first touches that worktree's tracked sources (every file `git ls-files` lists), then updates the stamp. Build tools that trust file times would otherwise test the last worktree's code.

## Test scratch on fast storage

Put each slot's test scratch dir on fast local storage, such as a RAM-backed temp dir or a local SSD. A slow disk turns timing tests red.

## Sizing

- Measure one gate's CPU use: run it alone and see how many threads it keeps busy on average.
- Start below the thread count divided by that number, leaving room for memory and disk.
- Watch the load while N gates run. When timing tests fail or the load stays above the thread count, lower N.
- Set `gate_slots` to N. temper's plan sizes waves to it, and the run skill launches tasks in chunks of at most N.

## Dependency caches

Share dependency caches read-mostly between slots, so no slot fetches and builds the same dependencies again. A compiler cache such as sccache works across slots; keep each slot's build output its own.
