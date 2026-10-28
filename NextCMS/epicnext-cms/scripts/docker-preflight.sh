#!/usr/bin/env bash
# ==============================================================================
# docker-preflight.sh — Verify a VPS is ready to run the Dockerized EpicNext-CMS.
#
# Does not execute dotenv. Endpoint probes use explicit environment overrides. Checks (all idempotent, none mutating):
#   1. Docker + compose available and usable.
#   2. Required runtime dirs exist (RW for UID 33 where the CMS writes).
#   3. Volume owners are UID/GID 33 (www-data) on the host.
#   4. .env exists and required host-network services are reachable.
#   5. Port 3002 free (or the host CMS that must be stopped).
#
# Usage: ./scripts/docker-preflight.sh [--fix]
#   --fix   attempts to auto-correct permission/owner issues (chown).
#
# Exit codes: 0 ready, 1 not ready (or fixed nothing).
# ==============================================================================

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1

FIX=0
[ "${1:-}" = "--fix" ] && FIX=1

ENV_FILE="${ENV_FILE:-$DIR/.env}"
fail=0
warn=0

# Ports that are expected to be reachable ON THE HOST (network_mode: host).
# These mirror the defaults in .env / the emulator stack; override via env.
CMS_PORT="${CMS_PORT:-3002}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
REDIS_PORT="${REDIS_PORT:-6379}"
RCON_PORT="${RCON_PORT:-3003}"
API_PORT="${API_PORT:-3001}"
IMAGER_PORT="${IMAGER_PORT:-8082}"

# Relative dirs the CMS writes to, plus the absolute shared gamedata root.
RW_DIRS=(
  "$DIR/public/nitro-assets"
  "$DIR/public/swf"
  "$DIR/storage"
  "/var/www/gamedata"
)

say()  { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m[OK]  \033[0m%s\n' "$*"; }
err()  { printf '  \033[31m[FAIL]\033[0m %s\n' "$*"; fail=1; }
wrn()  { printf '  \033[33m[WARN]\033[0m %s\n' "$*"; warn=1; }
doing(){ printf '\n\033[1m%s\033[0m\n' "$*"; }

doing "1. Docker engine + compose"
if command -v docker >/dev/null 2>&1; then
  ok "docker binary present"
  if docker info >/dev/null 2>&1; then ok "daemon reachable"; else err "daemon NOT reachable (is it running / does this user have access?)"; fi
else
  err "docker binary missing"
fi
if docker compose version >/dev/null 2>&1; then
  ok "docker compose plugin present"
else
  err "docker compose plugin missing (install docker-compose-plugin)"
fi

doing "2. Runtime directories exist + RW for UID 33"
for d in "${RW_DIRS[@]}"; do
  if [ ! -e "$d" ]; then
    err "missing dir: $d"
    if [ "$FIX" -eq 1 ]; then
      mkdir -p "$d" && chown 33:33 "$d" && say "  created + chown 33:33 $d" || err "  could not create $d"
    fi
    continue
  fi
  if [ ! -d "$d" ]; then err "not a directory: $d"; continue; fi
  # Check the actual runtime identity, never root's ability to write.
  if [ "$(id -u)" -eq 33 ]; then
    if [ -w "$d" ] && [ -r "$d" ]; then ok "runtime access: $d"; else err "runtime access denied: $d"; fi
  elif [ "$(id -u)" -eq 0 ] && command -v setpriv >/dev/null 2>&1; then
    if setpriv --reuid=33 --regid=33 --clear-groups sh -c 'test -r "$1" && test -w "$1"' sh "$d"; then
      ok "runtime access as UID/GID 33: $d"
    else err "runtime access denied for UID/GID 33: $d"; fi
  else
    wrn "runtime access unverified: $d; updater checks candidate container access before migrations"
  fi
done

doing "3. Volume ownership (UID/GID 33 = www-data)"
for d in "${RW_DIRS[@]}"; do
  [ -e "$d" ] || continue
  owner="$(stat -c '%u:%g' "$d" 2>/dev/null || true)"
  if [ "$owner" = "33:33" ]; then
    ok "owner 33:33: $d"
  else
    err "owner ${owner:-unknown} (want 33:33): $d"
    [ "$FIX" -eq 1 ] && { chown 33:33 "$d" && say "  chown 33:33 $d" || err "  chown failed"; }
  fi
done

doing "4. Configuration + required services (.env, host network)"
if [ -f "$ENV_FILE" ]; then
  ok ".env present: $ENV_FILE"
  say "Dotenv is not executed. Port checks below use explicit shell overrides/defaults, not DATABASE_URL or REDIS_URL."
  say "The updater validates real candidate configuration and mounted storage before migrations."
else
  err ".env missing: $ENV_FILE (copy your production env here)"
fi

check_port() { # name port
  if command -v nc >/dev/null 2>&1; then
    if nc -z 127.0.0.1 "$2" >/dev/null 2>&1; then ok "reachable 127.0.0.1:$2 ($1)"; else err "NOT reachable 127.0.0.1:$2 ($1)"; fi
  else
    if (echo >/dev/tcp/127.0.0.1/"$2") >/dev/null 2>&1; then ok "reachable 127.0.0.1:$2 ($1)"; else err "NOT reachable 127.0.0.1:$2 ($1)"; fi
  fi
}
check_port "MariaDB"  "$MYSQL_PORT"
check_port "Redis"    "$REDIS_PORT"
check_dep() { # name
  if command -v "$1" >/dev/null 2>&1; then ok "host binary: $1"; else wrn "host binary not found: $1 (may still work via container)"; fi
}
check_dep git

doing "5. Port 3002 state (host CMS clash)"
if (echo >/dev/tcp/127.0.0.1/"$CMS_PORT") >/dev/null 2>&1; then
  if [ "$(docker inspect --format '{{.State.Running}}' epicnext-cms 2>/dev/null || true)" = true ]; then
    ok "existing Compose CMS is running; use docker-update.sh to recreate and verify its release"
  elif [ "$(docker inspect --format '{{.State.Running}}' epicnext-cms-app 2>/dev/null || true)" = true ]; then
    wrn "CI manages the running CMS; update through CI instead of starting Compose"
  else
    err "port $CMS_PORT is occupied by another process; identify it before starting the CMS"
  fi
else
  ok "port $CMS_PORT free"
fi

printf '\n'
if [ "$fail" -eq 1 ]; then
  printf '\033[31m=== NOT READY: %s issue(s) found%s ===\033[0m\n' "$fail" "$([ "$FIX" -eq 1 ] && echo ' after --fix' || echo ' (re-run with --fix to auto-correct)')"
  exit 1
fi
if [ "$warn" -eq 1 ]; then printf '\033[33m=== READY (with %s warning(s)) ===\033[0m\n' "$warn"; exit 0; fi
printf '\033[32m=== READY ===\033[0m\n'
exit 0
