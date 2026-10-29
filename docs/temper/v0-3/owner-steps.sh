#!/bin/sh
# v0-3 owner steps: the evidence for temper v0.3 that needs a real account, the network or
# real infrastructure (the build host, GitHub). Agents never run this file; the owner does,
# one step at a time. docs/temper/v0-3/owner-checklist.md says when each step runs and what
# to record.
#
#   sh docs/temper/v0-3/owner-steps.sh install            # install smoke, throwaway config
#   sh docs/temper/v0-3/owner-steps.sh private <list>     # scan for private names
#   sh docs/temper/v0-3/owner-steps.sh ci [<pr>]          # wait for CI on the PR
#   sh docs/temper/v0-3/owner-steps.sh throwaways         # check the epic's detached worktrees
#   sh docs/temper/v0-3/owner-steps.sh host <host>        # ssh build-host smoke (A12, A27)
#
# No step uses sudo, pushes, merges, or deletes a branch or a worktree. Each step prints what
# it runs and exits non-zero on failure. Run them from any directory: the script finds the
# repo itself.

set -u

HERE=$(cd "$(dirname "$0")" && pwd -P)
REPO=$(cd "$HERE/../../.." && pwd -P)
BRANCH=epic/v0-3
EPIC=v0-3

usage() {
  sed -n '7,11p' "$0" | sed 's/^#  *//' >&2
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
    # Spec, success criteria: the plugin, at 0.3.0, installs and is enabled. Needs network
    # access and a logged-in claude CLI. Everything happens in a temporary CLAUDE_CONFIG_DIR,
    # so the owner's own config is never read or changed.
    [ $# -eq 0 ] || usage
    say "install smoke from $REPO"
    sh "$REPO/scripts/install_smoke.sh"
    ;;

  private)
    # Public repo hygiene: no private hostname, path or project detail is in the repo. <list>
    # is a file kept OUTSIDE the repo, one word per line: host names, private paths, private
    # project and crate names. The scan covers every tracked file on the epic branch. It
    # prints each match; no output and "private: clean" means none.
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
    # Spec, success criteria and "Python": CI is green on both jobs (node 20 / python 3.10
    # and node 24 / python 3.13). Needs the gh CLI, logged in. Run it after the PR from
    # epic/v0-3 into v0.3 exists; the push and the PR are the head's, on the owner's yes.
    [ $# -le 1 ] || usage
    pr=${1:-$BRANCH}
    say "waiting for the checks on $pr"
    cd "$REPO" && gh pr checks "$pr" --watch
    ;;

  throwaways)
    # Spec, "cleanup_check.py" (A25, A31), against the real remote: after epic/v0-3 is pushed,
    # each detached worktree under .temper/worktrees/v0-3/ (tmp/ included) is checked with
    # cleanup_check.py --detached. This step only reports: cleanup_check.py deletes nothing,
    # and this step removes nothing. It fetches from origin once, then checks with
    # --no-fetch. Exit 0 from a worktree means the cleanup skill may remove it.
    [ $# -eq 0 ] || usage
    root="$REPO/.temper/worktrees/$EPIC"
    say "fetching origin, then checking the detached worktrees under $root"
    git -C "$REPO" fetch --quiet origin || { echo "throwaways: fetch failed" >&2; exit 1; }
    tmpf=$(mktemp "${TMPDIR:-/tmp}"/temper-v03-wt.XXXXXX) || exit 1
    trap 'rm -f "$tmpf"' EXIT
    git -C "$REPO" worktree list --porcelain >"$tmpf" || exit 1
    total=0
    held=0
    wt=
    while IFS= read -r line; do
      case "$line" in
        "worktree "*) wt=${line#worktree } ;;
        detached)
          case "$wt" in
            "$root"/*)
              total=$((total + 1))
              if python3 "$REPO/scripts/cleanup_check.py" "$REPO" --detached \
                  --worktree "$wt" --no-fetch >/dev/null 2>&1; then
                echo "pass  $wt"
              else
                held=$((held + 1))
                echo "keep  $wt"
              fi
              ;;
          esac
          ;;
      esac
    done <"$tmpf"
    echo "throwaways: $total detached, $((total - held)) pass, $held kept"
    ;;

  host)
    # Spec, "host_sync.py fetch" (A27) and v0.2's A12: the git side of ssh build-host mode on
    # the real host, now with --prune on the private fetch. Run it only while the main
    # account has no run going on that host. It makes and removes only
    # ~/overnight/temper-smoke-<n> on the host.
    [ $# -eq 1 ] || usage
    host=$1
    case "$host" in -*) usage ;; esac
    say "ssh host smoke against $host"
    sh "$REPO/scripts/ssh_host_smoke.sh" "$host"
    ;;

  *)
    usage
    ;;
esac
