#!/usr/bin/env bash
# Purge the Cloudflare edge cache for one or more Cache-Tags.
#
# These tags are emitted by nginx (deployment/proxy/nginx-cms.conf):
#   cms-public   - de publieke API-allowlist (staff/teams/guilds/shop/values/…)
#   cms-gamedata - /gamedata/ (furnidata, config)
#   cms-client   - /client/ + /nitro-client/ (game assets)
#   cms-camera   - /camera/
#
# Usage:
#   scripts/cf-purge.sh cms-public
#   scripts/cf-purge.sh cms-public cms-gamedata cms-client cms-camera
#
# Reads CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID from the environment or the
# repository .env. Fails loudly with a clear message when they are missing or
# still placeholders, so a pipeline either purges or aborts — never silently
# pretends it did.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
BASE="https://api.cloudflare.com/client/v4"

[[ $# -ge 1 ]] || { echo "usage: $0 <tag> [tag ...]" >&2; exit 64; }
TAGS=("$@")

load_env() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then
    printf -v "$name" '%s' "${!name}"
    return 0
  fi
  if [[ -f "$ENV_FILE" ]]; then
    local line
    line="$(grep -m1 "^$name=" "$ENV_FILE" | cut -d= -f2- | tr -d "'\"")" || true
    if [[ -n "$line" ]]; then
      printf -v "$name" '%s' "$line"
      return 0
    fi
  fi
  return 1
}

load_env CLOUDFLARE_API_TOKEN || { echo "error: CLOUDFLARE_API_TOKEN not configured" >&2; exit 1; }
load_env CLOUDFLARE_ZONE_ID || { echo "error: CLOUDFLARE_ZONE_ID not configured" >&2; exit 1; }

# Placeholder guard: the repo .env historically carried 2-char dummy values.
if [[ "${#CLOUDFLARE_API_TOKEN}" -lt 16 || "${#CLOUDFLARE_ZONE_ID}" -lt 16 ]]; then
  echo "error: Cloudflare credentials look like placeholders; add a real token to .env" >&2
  exit 1
fi

body="$(python3 -c 'import json,sys; print(json.dumps({"tags": sys.argv[1:]}))' "${TAGS[@]}")"

resp="$(curl -sS -m 20 -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$body" \
  "$BASE/zones/$CLOUDFLARE_ZONE_ID/purge_cache")"

if ! python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("success") else 1)' <<<"$resp"; then
  echo "error: Cloudflare purge failed: $resp" >&2
  exit 1
fi
echo "purged tags: ${TAGS[*]}"