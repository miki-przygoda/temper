#!/bin/sh
# v0-2 owner steps: the evidence for temper v0.2 that needs a real account, the network or
# real infrastructure (the build host, GitHub). Agents never run this file; the owner does,
# one step at a time. docs/temper/v0-2/owner-checklist.md says when each step runs and what
# to record.
#
#   sh docs/temper/v0-2/owner-steps.sh install            # install smoke, throwaway config
#   sh docs/temper/v0-2/owner-steps.sh host <host>        # ssh build-host smoke (A12, A14)
#   sh docs/temper/v0-2/owner-steps.sh private <list>     # scan for private names
#   sh docs/temper/v0-2/owner-steps.sh ci [<pr>]          # wait for CI on the PR
#
# No step uses sudo, pushes, merges or deletes a branch. Each step prints what it runs and
# exits non-zero on failure. Run them from any directory: the script finds the repo itself.

set -u

HERE=$(cd "$(dirname "$0")" && pwd -P)
REPO=$(cd "$HERE/../../.." && pwd -P)
BRANCH=epic/v0-2

usage() {
  sed -n '7,10p' "$0" | sed 's/^#  *//' >&2
  exit 2
}

say() {
  echo "== $*"
}

[ $# -ge 1 ] || usage
step=$1
shift

case "$step" in
  install)
    # Spec 1 and 3.10: the plugin, at 0.2.0, installs and is enabled. Needs network access
    # and a logged-in claude CLI. Everything happens in a temporary CLAUDE_CONFIG_DIR, so the
    # owner's own config is never read or changed.
    [ $# -eq 0 ] || usage
    say "install smoke from $REPO"
    sh "$REPO/scripts/install_smoke.sh"
    ;;

  host)
    # Spec 4 ("The build host"): the git side of ssh build-host mode on the real host, now
    # with v0.2's shared epic worktree and commit checks in the run. Run it only while the
    # main account has no run going on that host. It makes and removes only
    # ~/overnight/temper-smoke-<n> on the host.
    [ $# -eq 1 ] || usage
    host=$1
    case "$host" in -*) usage ;; esac
    say "ssh host smoke against $host"
    sh "$REPO/scripts/ssh_host_smoke.sh" "$host"
    ;;

  private)
    # Spec 2 (anti-goal) and 4 ("Public repo"): no private hostname, path or detail of the
    # first run's project is in the repo. <list> is a file kept OUTSIDE the repo, one word per
    # line: host names, private paths, the first run's project and crate names. The scan
    # covers every tracked file on the epic branch. It prints each match; no output and
    # "private: clean" means none.
    [ $# -eq 1 ] || usage
    list=$1
    [ -f "$list" ] || { echo "private: no such file: $list" >&2; exit 2; }
    case "$(cd "$(dirname "$list")" && pwd -P)/" in
      "$REPO"/*) echo "private: keep the word list outside the repo" >&2; exit 2 ;;
    esac
    say "scanning $BRANCH for the words in $list"
    if git -C "$REPO" grep -I -n -i -F -f "$list" "$BRANCH" -- .; then
      echo "private: FOUND matches (above)" >&2
      exit 1
    fi
    echo "private: clean"
    ;;

  ci)
    # Spec 1: CI is green on both jobs (node 20 / python 3.9 and node 24 / python 3.13).
    # Needs the gh CLI, logged in. Run it after the PR from epic/v0-2 into v0.2 exists; the
    # push and the PR are the head's, on the owner's yes (may_push: ask).
    [ $# -le 1 ] || usage
    pr=${1:-$BRANCH}
    say "waiting for the checks on $pr"
    cd "$REPO" && gh pr checks "$pr" --watch
    ;;

  *)
    usage
    ;;
esac
