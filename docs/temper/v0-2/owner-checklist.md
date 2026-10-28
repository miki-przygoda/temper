# v0-2 owner checklist

The evidence for temper v0.2 that agents can't collect: it needs the owner's accounts, the network, GitHub or the build host. Agents wrote these steps and ran none of them. The script is `docs/temper/v0-2/owner-steps.sh`; it uses no sudo and never pushes, merges or deletes a branch.

Record each result (pass or fail, the date, and the PR or run link) in `docs/temper/v0-2/log.md`.

## Already shown by agents (no owner step)

- The full gate at the head's last check (83f30c4): `npm test` 441/441 Node and 107/107 Python, `node scripts/bundle.mjs --check`, and `claude plugin validate . --strict` in a throwaway config.
- The six user flows in spec §7, driven through the committed workflows (MVP checkpoint, `log.md`).
- `sh scripts/ssh_host_smoke.sh --local` runs in `npm test` (the Python acceptance suite). It covers the git side without a real host.

## Before the PR into `v0.2`

- [ ] **Install smoke.** `sh docs/temper/v0-2/owner-steps.sh install`. Needs network access and a logged-in `claude`. Pass: it prints `temper@temper enabled` and exits 0. Its throwaway config is deleted on exit.
- [ ] **Private details.** Write a word list outside the repo: the build host's name, private paths, and the first run's project and crate names. Run `sh docs/temper/v0-2/owner-steps.sh private <list>`. Pass: `private: clean` (spec §2 anti-goal, §4 "Public repo"). The script refuses a list kept inside the repo.
- [ ] **Confirm spike S7's decision** (spec §3.7a): nothing is built for item 7. Answers change through `args` and `resumeFromRunId`, as the README now says. Yes or no.
- [ ] **Accept the open items** in `pr-body.md` as left for later:
  - security-02, which the hex-sha contract should close, though no test of its own covers it;
  - failure-paths-and-lifecycle-01, -02 and -04 (phase, docs and evidence agents have no `blocked` status);
  - the per-fix regression check comparing against each fix's parent, not the branch HEAD;
  - plan ownership of the existing tests a task's change will break.

## The PR into `v0.2`

- [ ] **Push and open the PR.** The head does this on the owner's yes (`may_push: ask`): `epic/v0-2` into `v0.2`, with `docs/temper/v0-2/pr-body.md` as the body. `v0.2` is on `origin` at 26714a9, the same commit as `main`.
- [ ] **CI green on both jobs.** `sh docs/temper/v0-2/owner-steps.sh ci` (or pass the PR number). Needs `gh`, logged in. Pass: both `node 20, python 3.9` and `node 24, python 3.13` succeed (spec §1).

## Before `v0.2` goes to `main`

- [ ] **The build-host smoke.** Run it only while the main account has no run on the build host (spec §4): `sh docs/temper/v0-2/owner-steps.sh host <host>`. Needs `ssh <host>` without a password. Pass: a line starting `ssh_host_smoke: PASS`, and exit 0. It makes and removes only `~/overnight/temper-smoke-<n>` on the host.
- [ ] **Optional: a small real run.** Run v0.2 on a small throwaway epic from a test account or a scratch project, not the main account (spec §2 anti-goal: the main account's runs don't change before the merge). Look for: a `commits` map whose shas all pass the head's `merge-base --is-ancestor` check, and `regress:fix:<id>` agents after the fix wave.
- [ ] **Merge `v0.2` into `main`** in a gap between the main account's runs (spec §3.10). The owner merges; no agent does. `.claude-plugin/plugin.json` already says 0.2.0.
- [ ] **CI green on `main`** after the merge (the push to `main` runs CI).
