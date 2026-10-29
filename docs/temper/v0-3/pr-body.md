## What changed

temper v0.3.0 closes what v0.2 still left to the head. The design is `docs/temper/v0-3/spec.md`, and the design spec gets amendments A22 to A33.

- **Phases can say they're blocked (A22).** The checkpoint, behaviour-spec, acceptance, green, docs and evidence results now carry a required `status: 'done' | 'blocked'` and an optional `reason`. Build and publish check each phase result in a fixed order:
  1. nothing returned;
  2. a status other than `done`;
  3. the commit, recorded only when it is a sha;
  4. for the checkpoint only, a red gate.

  Nothing runs after a blocked phase, and publish never returns `ready` after one. The run skill treats a phase's reason as data and handles it as a blocked item.
- **The checkpoint commits only on a green gate, and `attempt` reruns it (A23).** `validateBuildArgs` accepts an optional `attempt`, and the checkpoint prompt and every phase prompt after it end with `Run attempt <n>.`. Task prompts are unchanged. The run skill bumps `attempt` on every build resume, so a checkpoint that went red runs live instead of being replayed from the resume cache. Publish takes the same `attempt` for its docs, evidence and gate prompts. This redoes the reverted v1 fix SECOND-CONTROL-FLOW-6.
- **Throwaway worktrees are named under `tmp/` (A24, A30, A32, A33).**
  - The checker, reviewer, verifier, regression and gate agents each work in `<repo>/.temper/worktrees/<epic>/tmp/<label>` (on an ssh host, `<root>/<epic>/tmp/<label>`).
  - The label is sanitised and gets an FNV-1a hash suffix, so it can't escape `tmp/` and two labels never share a path.
  - An agent reuses an existing path only when it is a worktree of its own with a clean status. Otherwise it returns blocked. Agents never delete or clean a worktree.
  - These agents' results carry `status` too. A blocked one becomes a blocked entry under the agent's own id, never a clean result, and a blocked verifier leaves its finding unverified.
  - The task id `tmp` is reserved.
- **Cleanup checks and removes detached worktrees (A25, A31).** `cleanup_check.py <repo> --detached --worktree <path>` passes a detached worktree only when its HEAD is on a branch of the remote and its status is clean. The cleanup skill checks every detached worktree under the epic's worktrees dir, `tmp/` included, and removes one only on exit 0. A throwaway whose commit no remote branch holds, as after a squash merge whose head branch was deleted, is left for the owner.
- **A regression counts only on the branch tip (A26).** Each `regress:fix:<id>` prompt names the branch's current tip. A regression counts only when it also reproduces there, so one that was already fixed forward isn't reported again.
- **Stale private host refs are pruned (A27).** `host_sync.py fetch` passes `--prune` to its private fetch. The prune is limited to `refs/temper/host/<branch>` and `refs/temper/host/temper/<epic>/`. `refs/heads/` is never pruned.
- **A task owns the tests its change breaks (A28).** The plan skill tells the planner to `git grep` the tests for everything a task changes and to put each test file that asserts it into the task's `Owns:`. Two tasks that need the same test file go in different waves.
- **Python 3.10 (A29).** The scripts need Python 3.10 or later. CI's oldest job is Node 20 with Python 3.10 on `ubuntu-latest`.
- **Docs.**
  - The README says 0.3.0. It covers throwaway worktrees in cleanup and the fixed rules, and its known issues are rewritten.
  - The design spec has amendments A22 to A33.
  - New behaviour lines: BUILD-37 to 45, STABILISE-32 to 35, PUBLISH-10 to 13, GIT-SAFETY-15 to 18 and SKILLS-PACKAGING-32 to 36.
  - `docs/v1-log.md` records SECOND-CONTROL-FLOW-6 as redone, the stale-private-ref regression as closed, and SECOND-TESTS-DOCS-5 as deferred.

## Why

v0.2 left the following open (`docs/temper/v0-2/pr-body.md`, Open items):
- phase agents couldn't report blocked, so a failed branch check went unseen;
- a red checkpoint could come back from the resume cache, and it committed anyway;
- agents' scratch worktrees had no fixed place, so cleanup couldn't find them;
- the regression check reported regressions that were already fixed;
- private host refs were never pruned;
- plans left tasks blocking on tests they didn't own.

v0.3 builds the fix for each of these into the workflows, scripts and skills, so the head no longer works around them by hand.

## How it was tested

- **Built with temper's own method** (`docs/temper/v0-3/log.md`).
  - The three skill tasks (`plan-skill`, `cleanup-skill`, `run-skill`) went through writing-skills RED/GREEN. Every scenario that failed on the old skill failed 0/3 after the change.
  - The other 8 tasks merged through v0.2.0's `build.js`, one task per wave.
- **The MVP checkpoint.** The full gate passed: `npm test`, the bundle check and `claude plugin validate . --strict`. All six user flows were ok, driven through the committed workflows and against throwaway git repos, a fake `ssh` and `ssh_host_smoke.sh --local`.
- **Acceptance.** 45 behaviour tests across the phases, worktrees, regress and head groups. All passed, with no to-green rounds.
- **Stage 4.** It ran on this branch's own v0.3 `stabilise.js` with `sweeps: 1`.
  - The sweep found 10 verified findings: none severe, 7 important and 3 minor.
  - The owner selected all 7 important ones, plus test-strength-and-docs-05 as a spec wording change only.
  - The fix wave returned `stable`. All 8 were fixed and none were reverted. Each fix's own `regress:fix:<id>` agent found no regressions.
- **The run skill after the fix wave.** The fix wave changed the run skill, so the head ran a RED/GREEN check on three scenarios afterwards:
  - P1: publish blocked at `docs`;
  - R1: a regression agent blocked on its throwaway path;
  - C1: a checker blocked on a dirty throwaway.

  Each passed 2/2 on the new skill.
- **At this branch's HEAD.** `npm test` passes 524/524 Node tests and 129/129 Python tests, and the bundle check exits 0.

## Open items

From `docs/temper/v0-3/log.md`, not fixed in this PR:

- **failure-paths-and-lifecycle-03.** A throwaway agent may leave its worktree dirty. Cleanup then refuses it, and the next agent that would reuse it returns blocked, so the owner removes it by hand.
- **failure-paths-and-lifecycle-04.** Two findings with the same id share one verify path.
- **Squash merges.** When the head branch is deleted after a squash merge, no remote branch holds a throwaway's commit. Cleanup leaves the throwaway, and the owner removes it (test-strength-and-docs-05, spec wording only).
- **One `attempt` field.** `args.json` has one `attempt`, but stages 3, 4b and 5 each say to save their own counter there. Each counter only has to change between launches of its own stage, so sharing it is harmless, but the run skill doesn't say so.
- **The checkpoint bullet in the run skill** describes only a failed full gate. A checkpoint blocked for another reason (such as `HEAD detached`) is covered only by the general rule about the agent's reason.
- **`claude plugin validate --strict`** warns `ICON_MISSING`. It doesn't fail the gate.
- **Still open from v1.**
  - SECOND-TESTS-DOCS-5, the overnight mode check, is deferred: there is still no safe way for the head to refresh the permission mode without a new prompt.
  - A run stops when the head's session closes.
  - Some minors from the v1 review are open as well.
