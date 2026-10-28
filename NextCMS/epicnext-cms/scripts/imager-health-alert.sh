#!/usr/bin/env bash
# Alert when the local avatar imager stops rendering, and again when it recovers.
#
# Intended to run from cron every few minutes (see `crontab -l`). Steady-state is
# silent; a state change posts to DISCORD_WEBHOOK_URL (from the environment or
# .env). While the imager stays down it re-alerts at most once per
# HEALTH_ALERT_COOLDOWN_MIN. The script always exits 0 so an outage never turns
# into a noisy cron failure; the alert itself (and this log) is the signal.
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${IMAGER_HEALTH_LOG:-$DIR/logs/imager-health.log}"
STATE_FILE="${IMAGER_HEALTH_STATE:-$DIR/logs/imager-health.state}"
HEALTH_URL="${IMAGER_HEALTH_URL:-http://127.0.0.1:8082/health}"
mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$STATE_FILE")"
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG_FILE"; }

load_env() {
  local name="$1"
  if [ -n "${!name:-}" ]; then return 0; fi
  if [ -f "$DIR/.env" ]; then
    local line
    line="$(grep -m1 "^$name=" "$DIR/.env" | cut -d= -f2- | tr -d "'\"")" || true
    if [ -n "$line" ]; then printf -v "$name" '%s' "$line"; fi
  fi
}

load_env DISCORD_WEBHOOK_URL || true
COOLDOWN_MIN="${HEALTH_ALERT_COOLDOWN_MIN:-30}"

notify() {
  local msg="$1"
  log "ALERT: $msg"
  if [ -z "${DISCORD_WEBHOOK_URL:-}" ]; then
    log "no DISCORD_WEBHOOK_URL configured; alert written to log only"
    return 0
  fi
  local payload
  payload="$(python3 -c 'import json,sys;print(json.dumps({"content":sys.argv[1]}))' "$msg")"
  curl -sS -m 10 -H "Content-Type: application/json" -d "$payload" \
    "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || log "failed to post alert to Discord"
}

body="$(curl -sS -m 5 "$HEALTH_URL" 2>/dev/null || true)"
ready=0
if printf '%s' "$body" | grep -q '"ready":true'; then ready=1; fi

now="$(date +%s)"
prev_state="up"
prev_at=0
if [ -f "$STATE_FILE" ]; then read -r prev_state prev_at < "$STATE_FILE" || true; fi
[ -n "${prev_state:-}" ] || prev_state=up
[ -n "${prev_at:-}" ] || prev_at=0

if [ "$ready" = 1 ]; then
  if [ "$prev_state" != "up" ]; then
    notify "Avatar imager RECOVERED ($HEALTH_URL reports ready)"
  fi
  printf 'up %s\n' "$now" > "$STATE_FILE"
  exit 0
fi

if [ "$prev_state" != "down" ]; then
  notify "Avatar imager DOWN ($HEALTH_URL not ready: ${body:-unreachable})"
  printf 'down %s\n' "$now" > "$STATE_FILE"
  exit 0
fi

if [ "$(( now - prev_at ))" -ge "$(( COOLDOWN_MIN * 60 ))" ]; then
  notify "Avatar imager STILL DOWN after ${COOLDOWN_MIN}m ($HEALTH_URL)"
  printf 'down %s\n' "$now" > "$STATE_FILE"
fi
exit 0
