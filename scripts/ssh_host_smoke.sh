#!/bin/sh
# ssh host smoke test: a real end-to-end check of the git side of temper's ssh build-host
# mode (spec amendment A12), against a host given as the argument.
#
#   sh scripts/ssh_host_smoke.sh <host>    # e.g. buildhost; needs ssh <host> without a password
#   sh scripts/ssh_host_smoke.sh --local   # test-only: the "host" is a local directory,
#                                          # reached through a fake ssh on PATH
#
# It makes a throwaway local repo (with its own bare origin) and a host clone under
# ~/overnight/temper-smoke-<n> on the host, then walks the head's steps with
# scripts/host_sync.py, the way the run skill does:
#   - the epic branch, created locally with a spec commit the host's origin lacks, is pushed
#     to the host (SECOND-TESTS-DOCS-1);
#   - an "agent" commits on a task branch on the host and a "merge agent" merges it into the
#     epic branch there, then leaves that branch checked out nowhere;
#   - the head fetches back while the epic branch is checked out in a local worktree
#     (SECOND-CONTROL-FLOW-1), and done_tasks.py sees the task;
#   - the head commits on the epic branch locally and the fetch-back still works (the A7
#     regression), then pushes it to the host (SECOND-CONTROL-FLOW-2);
#   - a push while the host has the branch checked out, and a fetch with commits on both
#     sides, are refused and change nothing.
# It removes everything it made on both sides either way: the local directory mktemp made,
# and on the host the temper-smoke-<n> directory this run created with mkdir (and ~/overnight
# with rmdir, only if this run created it). Nothing else is deleted. No sudo, no force.
# Prints one "ok <n> - <check>" line per check and "ssh_host_smoke: PASS (<n> checks)";
# exits 0 on success, 1 on the first failed check, 2 on bad usage.

set -u

usage() {
  echo "usage: ssh_host_smoke.sh <host> | --local" >&2
  exit 2
}
[ $# -eq 1 ] || usage
case "$1" in
  -h | --help | '') usage ;;
  --local) MODE=local ;;
  -*) usage ;;
  *) MODE=ssh ;;
esac

HERE=$(cd "$(dirname "$0")" && pwd -P)
SYNC="$HERE/host_sync.py"
DONE="$HERE/done_tasks.py"

N="$(date +%Y%m%d%H%M%S)-$$"
REL="overnight/temper-smoke-$N"
HOST_MADE=0
OVERNIGHT_MADE=0
LOCAL_DIR=""
PASS=0

rsh() {
  ssh -o BatchMode=yes "$HOST" "$1"
}

cleanup() {
  status=$?
  trap - EXIT
  if [ "$HOST_MADE" = 1 ]; then
    # This run created $REL with mkdir (not -p), so everything under it is this run's.
    rsh "rm -rf -- '$REL'" || echo "ssh_host_smoke: could not remove ~/$REL on $HOST" >&2
    if [ "$OVERNIGHT_MADE" = 1 ]; then
      rsh "rmdir overnight" || echo "ssh_host_smoke: could not rmdir ~/overnight on $HOST" >&2
    fi
  fi
  if [ -n "$LOCAL_DIR" ] && [ -d "$LOCAL_DIR" ]; then
    rm -rf -- "$LOCAL_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

ok() {
  PASS=$((PASS + 1))
  echo "ok $PASS - $1"
}

fail() {
  echo "FAIL - $1" >&2
  if [ $# -gt 1 ] && [ -n "$2" ]; then
    printf '%s\n' "$2" | sed 's/^/  | /' >&2
  fi
  exit 1
}

LOCAL_DIR=$(mktemp -d "${TMPDIR:-/tmp}/temper-smoke.XXXXXX") || fail "mktemp"
LOCAL_DIR=$(cd "$LOCAL_DIR" && pwd -P)
mkdir "$LOCAL_DIR/nohooks"

if [ "$MODE" = local ]; then
  # The fake host: commands run locally, from a home directory of their own.
  HOST=smoke-host
  mkdir "$LOCAL_DIR/hosthome" "$LOCAL_DIR/bin"
  cat >"$LOCAL_DIR/bin/ssh" <<EOF
#!/bin/sh
while [ \$# -gt 1 ]; do
  case "\$1" in
    -G) exit 0 ;;
    -o|-p|-l|-i) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
shift
cd '$LOCAL_DIR/hosthome' || exit 255
HOME='$LOCAL_DIR/hosthome' exec sh -c "\$*"
EOF
  chmod 755 "$LOCAL_DIR/bin/ssh"
  PATH="$LOCAL_DIR/bin:$PATH"
  export PATH
else
  HOST=$1
fi
GIT_SSH_COMMAND='ssh -o BatchMode=yes'
GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND GIT_TERMINAL_PROMPT

ID='-c user.name=temper-smoke -c user.email=temper-smoke@example.invalid -c commit.gpgsign=false'

# git in a throwaway repo, with an identity and no hooks of the user's.
lgit() {
  _d=$1
  shift
  git -C "$_d" -c user.name=temper-smoke -c user.email=temper-smoke@example.invalid \
    -c commit.gpgsign=false -c core.hooksPath="$LOCAL_DIR/nohooks" "$@"
}

# ---- the host side ----

out=$(rsh 'if [ -d overnight ]; then echo existed; else mkdir overnight && echo made; fi' 2>&1) ||
  fail "ssh $HOST works and ~/overnight exists or can be made" "$out"
[ "$out" = made ] && OVERNIGHT_MADE=1
out=$(rsh "mkdir '$REL' && cd '$REL' && pwd -P" 2>&1) || fail "make ~/$REL on $HOST" "$out"
HOST_MADE=1
HDIR=$out
case "$HDIR" in
  /*/temper-smoke-"$N") ;;
  *) fail "the host directory is ~/$REL" "$HDIR" ;;
esac
case "$HDIR" in *"'"*) fail "the host directory has no single quote" "$HDIR" ;; esac
CLONE="~/$REL/clone"
ok "ssh $HOST works; made ~/$REL"

# ---- the local side: the user's repo with an origin, and the plan's commit ----

REPO="$LOCAL_DIR/repo"
git init -q --bare -b main "$LOCAL_DIR/origin.git" || fail "git init origin"
git init -q -b main "$REPO" || fail "git init repo"
lgit "$REPO" commit -q --allow-empty -m init || fail "first commit"
lgit "$REPO" remote add origin "$LOCAL_DIR/origin.git"
lgit "$REPO" push -q origin main || fail "push main to the local origin"

# The host clone is a clone of the project's origin, which the host reaches on its own; here
# that origin is a bare repo on the host with the same main.
out=$(rsh "git init -q --bare '$HDIR/origin.git'" 2>&1) || fail "git init a bare origin on $HOST" "$out"
out=$(lgit "$REPO" push -q "ssh://$HOST/~/$REL/origin.git" main 2>&1) || fail "seed the host's origin" "$out"
out=$(rsh "git clone -q '$HDIR/origin.git' '$HDIR/clone'" 2>&1) || fail "make the host clone" "$out"
ok "the host clone ~/$REL/clone is a clone of the same main"

mkdir -p "$REPO/docs/temper/e"
echo "# e spec" >"$REPO/docs/temper/e/spec.md"
echo "# e plan" >"$REPO/docs/temper/e/plan.md"
lgit "$REPO" add docs || fail "git add the spec"
lgit "$REPO" commit -q -m "docs(temper): e spec and plan" || fail "commit the spec and plan"
lgit "$REPO" branch --no-track epic/e main || fail "create the epic branch"
if rsh "git -C '$HDIR/clone' rev-parse --verify --quiet refs/heads/epic/e" >/dev/null 2>&1; then
  fail "the host clone has no epic branch before the first push"
fi
ok "the epic branch exists locally only, on top of the plan's commit"

# ---- first launch: the epic branch, with the spec and plan, goes to the host ----

out=$(python3 -I "$SYNC" push "$REPO" "$HOST" "$CLONE" epic/e 2>&1) || fail "host_sync.py push (first launch)" "$out"
mine=$(lgit "$REPO" rev-parse epic/e)
theirs=$(rsh "git -C '$HDIR/clone' rev-parse epic/e" 2>&1) || fail "the host has epic/e" "$theirs"
[ "$mine" = "$theirs" ] || fail "the host's epic/e is the local one" "$mine != $theirs"
out=$(rsh "git -C '$HDIR/clone' cat-file -e epic/e:docs/temper/e/spec.md" 2>&1) ||
  fail "the spec is on the host's epic branch" "$out"
ok "push: the host clone has epic/e with the spec and plan (SECOND-TESTS-DOCS-1)"

# ---- the agents on the host: a task commit, merged into the epic branch ----
# This simulates the implementer and the merge agent, only in this run's throwaway host clone.

out=$(rsh "set -e
cd '$HDIR/clone'
git worktree add -q -b temper/e/a '$HDIR/e/a' epic/e
cd '$HDIR/e/a'
echo a >a.txt
git add a.txt
git $ID commit -q -m 'feat: a' -m 'Temper-Task: e/a'
cd '$HDIR/clone'
git worktree add -q '$HDIR/e/merge' epic/e
cd '$HDIR/e/merge'
git $ID merge -q --no-ff --no-edit temper/e/a
git switch -q --detach" 2>&1) || fail "the agent's commit and merge on $HOST" "$out"
host_tip=$(rsh "git -C '$HDIR/clone' rev-parse epic/e" 2>&1) || fail "read the host's epic/e" "$host_tip"
ok "on $HOST: task a committed on temper/e/a and merged into epic/e, then detached"

# ---- fetch back, with the epic branch checked out in a local worktree ----

WT="$LOCAL_DIR/wt"
lgit "$REPO" worktree add -q "$WT" epic/e || fail "check out epic/e in a local worktree"
out=$(python3 -I "$SYNC" fetch "$REPO" "$HOST" "$CLONE" epic/e e 2>&1) || fail "host_sync.py fetch with epic/e checked out" "$out"
[ "$(lgit "$REPO" rev-parse epic/e)" = "$host_tip" ] || fail "the local epic/e is the host's" "$out"
[ "$(lgit "$WT" rev-parse HEAD)" = "$host_tip" ] || fail "the worktree moved with its branch"
[ -z "$(lgit "$WT" status --porcelain)" ] || fail "the worktree is clean after the fetch" "$(lgit "$WT" status --porcelain)"
[ -f "$WT/a.txt" ] || fail "the worktree has the task's file"
[ "$(lgit "$REPO" rev-parse refs/temper/host/epic/e)" = "$host_tip" ] || fail "the host's copy is in refs/temper/host/"
[ "$(lgit "$REPO" rev-parse temper/e/a)" = "$(rsh "git -C '$HDIR/clone' rev-parse temper/e/a")" ] ||
  fail "the task branch came back"
out=$(python3 -I "$DONE" "$REPO" epic/e main e 2>&1) || fail "done_tasks.py" "$out"
[ "$out" = '["a"]' ] || fail "done_tasks.py lists task a" "$out"
ok "fetch: epic/e fast-forwarded in its checked-out worktree, done_tasks.py says [\"a\"] (SECOND-CONTROL-FLOW-1)"

# ---- the head commits on the epic branch (the A7 regression case), then pushes it ----

echo "resolved" >"$WT/resolved.txt"
lgit "$WT" add resolved.txt
lgit "$WT" commit -q -m "fix: resolve the wave 0 merge" || fail "the head's commit"
head_tip=$(lgit "$REPO" rev-parse epic/e)
out=$(python3 -I "$SYNC" fetch "$REPO" "$HOST" "$CLONE" epic/e e 2>&1) || fail "fetch-back after the head's own commit" "$out"
case "$out" in *'"ahead": ["epic/e"]'*) ;; *) fail "the fetch lists epic/e as ahead" "$out" ;; esac
[ "$(lgit "$REPO" rev-parse epic/e)" = "$head_tip" ] || fail "the fetch left the head's commit alone"
ok "fetch after a head commit: exit 0, the commit kept, epic/e listed under ahead (A7-REGRESSION)"

# A push while the host has the epic branch checked out is refused, and changes nothing.
out=$(rsh "cd '$HDIR/e/merge' && git switch -q epic/e" 2>&1) || fail "check out epic/e on the host" "$out"
if out=$(python3 -I "$SYNC" push "$REPO" "$HOST" "$CLONE" epic/e 2>&1); then
  fail "a push to a branch checked out on the host is refused" "$out"
fi
case "$out" in *"checked out"*) ;; *) fail "the refusal says the branch is checked out" "$out" ;; esac
[ "$(rsh "git -C '$HDIR/clone' rev-parse epic/e")" = "$host_tip" ] || fail "the refused push changed nothing on the host"
out=$(rsh "cd '$HDIR/e/merge' && git switch -q --detach" 2>&1) || fail "detach on the host" "$out"
ok "push refused while epic/e is checked out on $HOST, host unchanged"

out=$(python3 -I "$SYNC" push "$REPO" "$HOST" "$CLONE" epic/e 2>&1) || fail "host_sync.py push of the head's commit" "$out"
[ "$(rsh "git -C '$HDIR/clone' rev-parse epic/e")" = "$head_tip" ] || fail "the host has the head's commit"
out=$(python3 -I "$SYNC" fetch "$REPO" "$HOST" "$CLONE" epic/e e 2>&1) || fail "fetch-back after the push" "$out"
case "$out" in *'"ahead": []'*) ;; *) fail "after the push nothing is ahead" "$out" ;; esac
ok "push: the head's commit reached the host as a fast-forward; the two branches are the same (SECOND-CONTROL-FLOW-2)"

# ---- the host builds on the head's commit; then commits on both sides stop the fetch ----

out=$(rsh "set -e
cd '$HDIR/e/merge'
git switch -q epic/e
echo b >b.txt
git add b.txt
git $ID commit -q -m 'test: checkpoint' -m 'Temper-Task: e/checkpoint'
git switch -q --detach" 2>&1) || fail "a host commit on top of the head's" "$out"
host_tip=$(rsh "git -C '$HDIR/clone' rev-parse epic/e")
out=$(python3 -I "$SYNC" fetch "$REPO" "$HOST" "$CLONE" epic/e e 2>&1) || fail "fetch-back of the host's next commit" "$out"
[ "$(lgit "$WT" rev-parse HEAD)" = "$host_tip" ] || fail "the worktree fast-forwarded to the host's commit"
out=$(python3 -I "$DONE" "$REPO" epic/e main e 2>&1) || fail "done_tasks.py" "$out"
[ "$out" = '["a", "checkpoint"]' ] || fail "done_tasks.py lists a and checkpoint" "$out"
ok "fetch: the host's commit on top of the head's came back; done_tasks.py agrees"

out=$(rsh "set -e
cd '$HDIR/e/merge'
git switch -q epic/e
git $ID commit -q --allow-empty -m 'feat: host only'
git switch -q --detach" 2>&1) || fail "a host-only commit" "$out"
host_tip=$(rsh "git -C '$HDIR/clone' rev-parse epic/e")
lgit "$WT" commit -q --allow-empty -m "fix: local only" || fail "a local-only commit"
local_tip=$(lgit "$REPO" rev-parse epic/e)
if out=$(python3 -I "$SYNC" fetch "$REPO" "$HOST" "$CLONE" epic/e e 2>&1); then
  fail "a fetch with commits on both sides is refused" "$out"
fi
case "$out" in *diverged*) ;; *) fail "the refusal says the branches diverged" "$out" ;; esac
[ "$(lgit "$REPO" rev-parse epic/e)" = "$local_tip" ] || fail "the refused fetch changed nothing locally"
if out=$(python3 -I "$SYNC" push "$REPO" "$HOST" "$CLONE" epic/e 2>&1); then
  fail "a push with commits on both sides is refused" "$out"
fi
[ "$(rsh "git -C '$HDIR/clone' rev-parse epic/e")" = "$host_tip" ] || fail "the refused push changed nothing on the host"
ok "commits on both sides: fetch and push both refused, nothing changed on either side"

echo "ssh_host_smoke: PASS ($PASS checks, host $HOST, mode $MODE)"
