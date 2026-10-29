# Changelog

Each release's full record is in `docs/temper/<version>/` (spec, plan, log and PR body), and the design changes are the amendments in `docs/specs/2026-10-24-temper-design.md`.

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
