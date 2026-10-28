#!/usr/bin/env bash
# Tests for the port-selection and port-conflict logic in scripts/ci-deploy.sh.
#
# Background: on a host where both blue/green slots answer /cms_api/health, the
# original read_active_port() counted healthy slots and only consulted the nginx
# upstream when the count was not exactly 1. With two healthy slots it fell back
# to the upstream file, but an operator `docker compose up` can leave an extra
# replica behind, after which the fallback picked slot A regardless of which slot
# was really live. The candidate then tried to start on an occupied port, and the
# health probe answered from the pre-existing container on that port instead of
# the candidate — producing 30 failed "expected release never became healthy"
# attempts against a release that was never serving.
#
# The functions are extracted from ci-deploy.sh rather than copied so this test
# cannot drift from the script it protects.
set -Eeuo pipefail

deploy_script="$(dirname "$0")/ci-deploy.sh"
[[ -r "$deploy_script" ]] || { echo "cannot read $deploy_script" >&2; exit 1; }

# Pull the two functions out of the real script.
extract() {
  sed -n "/^$1() {/,/^}/p" "$deploy_script"
}

read_active_port_fn="$(extract read_active_port)"
assert_port_free_fn="$(extract assert_port_free)"
answers_health_fn="$(extract answers_health)"

if [ -z "$read_active_port_fn" ] || [ -z "$assert_port_free_fn" ] || [ -z "$answers_health_fn" ]; then
  echo "could not extract functions from $deploy_script" >&2
  exit 1
fi

slot_a_port=3002
slot_b_port=3003

fail() { echo "FAIL: $*" >&2; exit 1; }

# ── read_active_port ──────────────────────────────────────────────────────────
# $1 = upstream body ("none" for a missing file), $2..$3 = ports that answer.
run_read_active_port() {
  local body="$1" a="$2" b="$3" tmp
  tmp="$(mktemp)"
  if [ "$body" = "none" ]; then
    tmp=/tmp/ci-deploy-test-nonexistent-upstream-$$
    rm -f "$tmp"
  else
    printf '%s\n' "$body" >"$tmp"
  fi
  CMS_UPSTREAM_FILE="$tmp" \
  PORT_A_HEALTHY="$a" PORT_B_HEALTHY="$b" \
    bash -c "
      slot_a_port=$slot_a_port
      slot_b_port=$slot_b_port
      upstream_file=\"\$CMS_UPSTREAM_FILE\"
      $read_active_port_fn
      # Defined after the extracted function on purpose: answers_health is a
      # collaborator here, and the test substitutes a deterministic stub for it.
      answers_health() {
        local p=\$1 want
        case \$p in
          $slot_a_port) want=\"\$PORT_A_HEALTHY\" ;;
          $slot_b_port) want=\"\$PORT_B_HEALTHY\" ;;
          *) want='' ;;
        esac
        [ \"\$want\" = yes ]
      }
      read_active_port
      echo
    " 2>/dev/null
  rm -f "$tmp"
}

# nginx points at slot B and both answer -> trust the upstream file.
got="$(run_read_active_port 'server 127.0.0.1:3003 max_fails=2;' yes yes)"
[ "$got" = "$slot_b_port" ] || fail "nginx->3003 with both healthy: got '$got', want 3003"

got="$(run_read_active_port 'server 127.0.0.1:3002 max_fails=2;' yes yes)"
[ "$got" = "$slot_a_port" ] || fail "nginx->3002 with both healthy: got '$got', want 3002"

# The regression: both healthy, nginx points at B, but slot A is an unrelated
# leftover replica. The upstream file is the only thing that knows which slot is
# live, so it must win.
got="$(run_read_active_port 'server 127.0.0.1:3003 max_fails=2;' yes yes)"
[ "$got" != "$slot_a_port" ] || fail "both healthy: fell back to slot A while nginx serves 3003"

# Upstream names a dead slot: fall back to a slot that actually answers, never to
# the dead port itself.
got="$(run_read_active_port 'server 127.0.0.1:3002 max_fails=2;' no yes)"
[ "$got" = "$slot_b_port" ] || fail "nginx->3002 unhealthy, B healthy: got '$got', want 3003"

# Nothing answers at all: read_active_port still has to name a slot, otherwise the
# rollback path has no target.
got="$(run_read_active_port 'server 127.0.0.1:3003 max_fails=2;' no no)"
[ "$got" = "$slot_b_port" ] || fail "nothing healthy: got '$got', want the upstream port 3003"

# No upstream file at all: pick a slot that answers.
got="$(run_read_active_port none no yes)"
[ "$got" = "$slot_b_port" ] || fail "no upstream, B healthy: got '$got', want 3003"

got="$(run_read_active_port none yes no)"
[ "$got" = "$slot_a_port" ] || fail "no upstream, A healthy: got '$got', want 3002"

# ── assert_port_free ─────────────────────────────────────────────────────────
# Runs against real loopback ports: 3999 is intentionally unused, so the check
# must report it free.
bash -c "
  $assert_port_free_fn
  assert_port_free 3999 candidate >/dev/null 2>&1
" || fail "a port with no listener must be reported as free"

# On this host 3002 is held by a CMS container, so the check must fail. Skip when
# it genuinely is free, otherwise the assertion would be meaningless.
if ss -ltn 2>/dev/null | grep -qE '127\.0\.0\.1:3002|0\.0\.0\.0:3002'; then
  if bash -c "
    $assert_port_free_fn
    assert_port_free 3002 candidate >/dev/null 2>&1
  "; then
    fail "an occupied port must be rejected, but assert_port_free returned success"
  fi
fi

echo 'Deploy port-selection tests passed'
