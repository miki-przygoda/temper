# Changelog

Each release's full record is in `docs/temper/<version>/` (spec, plan, log and PR body), and the design changes are the amendments in `docs/specs/2026-10-24-temper-design.md`.

## Unreleased

Every addition is opt-in. With none of the new fields, every prompt and schema is byte-identical to the previous commit's, so runs in flight keep their resume caches. One thing changes with no field: blocked entries gain `cause`. Upgrade between runs.

- **`task_checks`.** `each` (the default) or `none`: `none` skips the per-task checker and leaves review to stage 4's sweep.
- **`stop_after`.** `wave:<n>`, `waves`, `checkpoint`, `behaviour-spec` or `acceptance` returns status `stopped` there, with `{at, done_now, commits, flaky_reruns}`. Prompts don't change, so a later launch replays.
- **`gate_slots` in the build.** A wave runs in chunks of that size, with one merge per wave. Without it, a wave runs whole.
- **`scripts/run_script.py`.** A stage's bundle with its args inlined, for args over 32 KB. The run skill launches it with `scriptPath`.
- **Block causes.** Blocked entries carry `cause` where temper knows it: `nothing`, `merge-conflict`, `gate-after-merge`, `base-red`, `tip-mismatch`, `owns-refused` and `owns`. `impl_cause: true` adds an optional cause enum to the implementer's schema. `scripts/blocks_report.py <specs_dir>` counts them per epic and week, with the relaunches.
- **`baseline: launch`.** With `tip`, `gates.baseline` and `baseline_attempt`: an agent checks the epic branch's tip once per launch, before the first wave with pending tasks. A red tip blocks before any implementer starts. Its log goes to `<epic>.baseline.log`, outside its throwaway worktree, and untracked output left in that worktree doesn't stop the next launch.
- **`owns_widen: {max, protected}`.** An implementer may ask for up to `max` (at most 3) paths outside its owns, once per task, and not for a protected path or one a same-wave task owns or widened. The grant is logged and reported as `owns_widened`. The workflow checks a path's text; a symlink is checked by the implementer on disk, on every launch and retry, and by the merge agent in git's trees, and a write through a symlink git doesn't track is seen only by the implementer's check. The merge agent also refuses a widened path that is a directory, and any file outside the planned owns that isn't exactly a widened path or that matches a protected glob. A grant later refused at a symlink comes back with `refused: true`: it stays in `owns_widened`, so the task can't ask twice, and out of `owns`.

## 0.3.1 (29 Oct 2026)

- **One-step install.** `claude plugin install temper@temper` now installs superpowers with it (A34).
- **Directory listing details.** `plugin.json` has a homepage, repository, licence, keywords and an icon.
- **Docs for newcomers.** The README has a new opening: why temper exists, how it works, who it's for, what it costs, and a quick start. This changelog and a security policy are new.
- **Private details removed.** The early notes and design docs no longer name the private project temper was first run on.

## 0.3.0 (29 Oct 2026)

- Phases can return blocked with a reason, and nothing runs after a blocked phase.
- The checkpoint commits only on a green gate. An `attempt` counter makes resumed checkpoints and publishes run live instead of being replayed.
- Throwaway worktrees are named under `.temper/worktrees/<epic>/tmp/`. An agent reuses one only when it is its own clean worktree, and `/temper:cleanup` removes them.
- A regression counts only when it reproduces on the branch tip.
- Stale private host refs are pruned.
- Plans make each task own the tests its change breaks.
- Python 3.10 or later is required.

## 0.2.0 (28 Oct 2026)

- Agents check that their commits reach their branch, and only hex shas are reported.
- A project build rule reaches every prompt.
- One-sweep mode, with a regression check per fix in every fix wave.
- Selected minor findings are fixed.
- Gate slots, and quick-gate reruns of known flaky tests.

## 0.1.0 (24 Oct 2026)

- The first version: stages `ground`, `plan` and `run` (build, stabilise and publish), plus `setup` and `cleanup`.
- An optional ssh build host.
- Resume from `Temper-Task` commit trailers.
