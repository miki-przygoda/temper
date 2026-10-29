# v0-3 owner checklist

This is the evidence for temper v0.3 that agents can't collect, because it needs the owner's accounts, the network, GitHub or the build host. Agents wrote these steps and ran none of them. The script is `docs/temper/v0-3/owner-steps.sh`. It uses no sudo, and never pushes, merges or deletes a branch or a worktree.

Record each result (pass or fail, the date, and the PR or run link) in `docs/temper/v0-3/log.md`.

## Already shown by agents (no owner step)

- **The full gate at e6932a6:** `npm test` passes 524/524 Node and 129/129 Python, `node scripts/bundle.mjs --check` passes, and `claude plugin validate . --strict` passes in a throwaway config. The `ICON_MISSING` warning doesn't fail the gate.
- **The six user flows in the spec's "User flows" section,** driven through the committed workflows and against throwaway git repos (MVP checkpoint, `log.md`). Flow 5 (stale private refs pruned) ran with a fake `ssh` and `sh scripts/ssh_host_smoke.sh --local`.
- **45 acceptance tests** (PHASES, WORKTREES, REGRESS, HEAD), the stage 4 sweep and the fix wave (`stable`), and the run skill's RED/GREEN check after the fix wave.

## Before the PR into `v0.3`

- [ ] **Install smoke.** Run `sh docs/temper/v0-3/owner-steps.sh install`. It needs network access and a logged-in `claude`. Pass: it prints `temper@temper enabled` and exits 0. Its throwaway config is deleted on exit.
- [ ] **Private details.** Write a word list outside the repo with the build host's name, private paths, and private project and crate names. Run `sh docs/temper/v0-3/owner-steps.sh private <list>`. Pass: it prints `private: clean`. The script refuses a list kept inside the repo.
- [ ] **Accept the open items** in `pr-body.md` as left for later:
  - failure-paths-and-lifecycle-03: a throwaway agent may leave its worktree dirty, so cleanup refuses it and the owner removes it by hand;
  - failure-paths-and-lifecycle-04: two findings with the same id share one verify path;
  - squash merges whose head branch is deleted leave throwaways that no remote branch holds, and the owner removes them (A31);
  - one `attempt` field in `args.json` is shared by stages 3, 4b and 5, and the run skill doesn't say that is harmless;
  - the run skill's `checkpoint` bullet describes only a failed full gate;
  - the `ICON_MISSING` warning from `claude plugin validate --strict`;
  - SECOND-TESTS-DOCS-5 (the overnight mode check), deferred, and the other v1 leftovers.

## The PR into `v0.3`

- [ ] **Push and open the PR.** The head does this on the owner's yes: `epic/v0-3` into `v0.3`, with `docs/temper/v0-3/pr-body.md` as the body. `v0.3` is on `origin` at 16c11c8, the same commit as `main`.
- [ ] **CI green on both jobs.** Run `sh docs/temper/v0-3/owner-steps.sh ci`, or pass the PR number. It needs `gh`, logged in. Pass: both `node 20, python 3.10` and `node 24, python 3.13` succeed. This is the first CI run on `ubuntu-latest` with Python 3.10 (A29).
- [ ] **Throwaways against the real remote.** After the push, run `sh docs/temper/v0-3/owner-steps.sh throwaways`. It fetches `origin` and checks each detached worktree under `.temper/worktrees/v0-3/` (including `tmp/`) with `cleanup_check.py --detached`. It removes nothing. Pass: the `tmp/` throwaways on a commit that `epic/v0-3` holds (for example the `regress-fix-*` ones at 827da7b and the `review-*` ones at 9b7d6e0) print `pass`, and any that print `keep` have a reason you can see with `python3 scripts/cleanup_check.py <repo> --detached --worktree <path>`. Record the counts line.

## Before `v0.3` goes to `main`

- [ ] **The build-host smoke.** Run it only while the main account has no run on the build host: `sh docs/temper/v0-3/owner-steps.sh host <host>`. It needs `ssh <host>` without a password, and the host's Python must be 3.10 or later (A29). Pass: a line starting `ssh_host_smoke: PASS`, and exit 0. It makes and removes only `~/overnight/temper-smoke-<n>` on the host. This runs v0.3's `host_sync.py fetch`, with `--prune`, against the real host. The prune itself is checked by the unit test and the `--local` run, not by this smoke.
- [ ] **Optional: a small real run.** Run v0.3 on a small throwaway epic from a test account or a scratch project, not the main account. Look for:
  - throwaway worktrees under `.temper/worktrees/<epic>/tmp/<label>-<hash>`;
  - `Run attempt <n>.` at the end of the checkpoint prompt;
  - a phase that blocks shows up as a blocked entry with its reason;
  - the cleanup skill removes the `tmp/` throwaways only on exit 0 from `cleanup_check.py --detached`.
- [ ] **Merge `v0.3` into `main`** in a gap between the main account's runs. The owner merges; no agent does. `.claude-plugin/plugin.json` already says 0.3.0.
- [ ] **CI green on `main`** after the merge (the push to `main` runs CI).
- [ ] **Cleanup.** After the merge, the cleanup skill removes the epic's task worktrees and the detached throwaways that pass `cleanup_check.py`. Any it leaves (a dirty throwaway, or one whose commit no remote branch holds) are removed by the owner by hand.
