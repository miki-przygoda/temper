## What changed

temper v0.2.0 takes over the hand work the head had to do on the first real run (a 29-task Rust epic). The design is `docs/temper/v0-2/spec.md`; the design spec gets amendments A14 to A21.

- **Commits that reach their branch (A14).** Every agent that commits works with its branch checked out: implementers in a task worktree, and merge and phase agents in one shared epic worktree. Each checks `git symbolic-ref --short HEAD` before committing and that the branch moved to its commit afterwards. If either check fails it returns blocked, and it never repairs a branch by hand. The checker fails a task whose branch tip isn't the reported commit, or whose commit is already on the epic branch. Build, stabilise and publish return the `commits` their agents reported, and the run skill checks each sha with `git merge-base --is-ancestor` and never cherry-picks one.
  - Only a lowercase hex sha of 7 to 64 characters (SHA-1 or SHA-256) goes into `commits`. The checker's tip check uses the same pattern. Any other value is left out, and its id is blocked with `commit is not a sha`.
  - The task id `epic` is refused, because its worktree would share the epic worktree's path.
- **The project's build rule reaches every agent (A15).** `.temper/project.md` can have a `## Build rule` section. The plan copies it into `args.json` as `build_rule`, and `withRules` adds it to every prompt as data, before the fixed rules.
- **One-sweep mode and a regression check after every fix wave (A16).** `sweeps: 1 | 2` in `project.md` (default 2) is passed through as `args.sweeps`. Every `part: "fix"` run gives each landed fix its own `regress:fix:<id>` agent. These agents launch in chunks of `args.gate_slots`. With one sweep, a clean check returns `stable` with `second_sweep: null`. The head raises `args.attempt` on every resume, so the check always runs live and is never replayed from the resume cache.
- **Selected minor findings are fixed (A17).** The fix part fixes everything in `args.selected`, with minors last. Overnight selection still never picks a minor.
- **Gates that wait for a slot (A18).** Every prompt says a gate waiting for a slot or lock is normal, and must never be worked around. `gate_slots` in `project.md` caps the gates running at once, and `templates/gate-slots.md` gives generic guidance for a project's own slot scripts.
- **Known flaky tests in quick gates (A19).** `flaky:` in `project.md` is passed through as `args.flaky`. A quick gate whose failing tests are all on the list is rerun once, and each rerun is reported in `flaky_reruns`. The full gate is never rerun.
- **Two reverted v1 fixes, redone (A20).** A finding whose verifier returned nothing stays unverified and is never fixed unless a person selects it. Second-sweep ids get their own `second:` namespace, and a legacy `fix:second-*` trailer still counts.
- **Answers change through args and resume (A21).** Spike S7 showed that a resume with changed args replays the unchanged calls and runs the rest live. So a changed answer is passed with updated `args` and `resumeFromRunId`, never by editing a generated script.
- **Docs.**
  - The README now says 0.2.0, and its known issues are rewritten.
  - The design spec has amendments A14 to A21.
  - New behaviour lines: BUILD-28 to 36, STABILISE-22 to 31, PUBLISH-09, STATE-22 and SKILLS-PACKAGING-29 to 31.
  - The setup, plan and run skills and the `project.md` template cover the new fields.

## Why

On the first run, the head had to:
- rescue commits left on a detached HEAD;
- stop agents building into their own target directories;
- rerun known flakes by hand;
- run the regression check that one-sweep mode skipped;
- fix the minors the owner selected;
- regenerate scripts to change an answer.

v0.2 builds each of those into the workflows and skills. The security-01 finding (agent-reported shas reached a shell command unchecked) led to the hex-sha contract.

## How it was tested

- **Built with temper's own method** (`docs/temper/v0-2/log.md`).
  - The two skill tasks went through writing-skills RED/GREEN: `run-skill` B to F and `project-skills` G to I failed on the old skills and passed after the change.
  - The 11 build tasks merged through v0.1.0's `build.js`.
- **The MVP checkpoint.** The full gate passed: `npm test`, the bundle check and `claude plugin validate . --strict`. All six user flows in spec §7 were ok when driven through the committed workflows.
- **Acceptance.** 73 behaviour tests across the commits, prompts, stabilise and head groups. One failure (HEAD-09) was fixed as a product fix.
- **Stage 4.** It ran on this branch's own v0.2 `stabilise.js` with `sweeps: 1`.
  - The sweep found 14 verified findings: 1 severe, 9 important and 4 minor. The owner selected 10 of them, plus the head's own head-fixture-host-01; the other 4 are the open items below.
  - Every fix got its own regression agent.
  - One proven regression was fixed forward in 83f30c4: a 40-character limit had broken the checker in SHA-256 repos, so the pattern is now 7 to 64 characters.
- **The run skill after the fix wave.** It was checked again with RED/GREEN on scenarios J, K and L, and each failed 0/3 at HEAD.
- **At this branch's HEAD.** `npm test` passes 441/441 Node tests and 107/107 Python tests, and the bundle check exits 0.

## Open items

From `docs/temper/v0-2/log.md`, not fixed in this PR:

- **security-02** (a ref name passes the reachability check). The hex-sha contract should close it, because a ref name is no longer accepted as a commit. It isn't closed by a test of its own.
- **failure-paths-and-lifecycle-01, -02 and -04.** Phase, docs and evidence agents can't return `blocked`, because their result schemas have no status. So a failed branch check there goes unseen by the workflow, and COMMITS-04 can't catch it. The head's sha-on-branch check is the backstop.
- **The per-fix regression check** compares each fix with that fix's parent, not the branch HEAD. A regression that was already fixed forward is reported again on every rerun. A redo would give each agent the branch HEAD too, and count only a regression that still reproduces there.
- **Plan ownership.** The plan skill doesn't make a task own the existing tests its change will break. This build blocked twice on it (`docs-v02` with `test/manifest.test.mjs`, and `regress-sweeps` with the shared stabilise tests).
- **Still open from v1.**
  - CONTROL-FLOW-6 and TESTS-DOCS-5 are not redone.
  - The private fetch refs under `refs/temper/host/` are never pruned.
  - A run stops when the head's session closes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
