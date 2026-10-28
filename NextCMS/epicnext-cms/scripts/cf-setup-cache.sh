#!/usr/bin/env bash
# Create/update the Cloudflare Cache Rule that stores the CMS public API
# allowlist, the client-facing gamedata tree and the avatar/badge imaging
# endpoints at the edge (the routes nginx tags with `Cache-Tag: cms-public`
# respectievelijk `cms-gamedata`, en `/cms_api/imaging/` dat zijn eigen s-maxage
# stuurt).
#
# Why a rule is required: Cloudflare only caches a handful of file extensions
# by default; `/cms_api/*` responses are served `cf-cache-status: DYNAMIC` even
# though their `Cache-Control: s-maxage` says they are cacheable. A Cache Rule
# with "Cache Everything" turns those the other way.
#
# What the rule does:
#   - edge_ttl bypass_by_default : edge cachet volgens de max-age/s-maxage van
#     nginx; zonder (publieke) header (bv. errorresponses) juist NIET cachen.
#   - browser_ttl respect_origin : de zone heeft "Browser Cache TTL = 1 jaar" en
#     overschrijft daarmee het max-age dat nginx per klasse stuurt. Deze rule
#     herstelt dat voor de publieke API's én /gamedata/: browsers krijgen de
#     per-klasse max-age van nginx terug i.p.v. een jaar stale data.
#
# Het /gamedata/-deel is toegevoegd omdat de zone-TTL anders ook de iconen
# (`.png`, een standaard cachebare extensie) op een jaar zette: nginx stuurde
# 300/3600/604800, maar de browser kreeg `max-age=31536000` en een 404 werd als
# `max-age=31536000` + `cf-cache-status: HIT` vastgezet. Een ontbrekend icon dat
# later werd geïmporteerd bleef daardoor een jaar 404. Met `respect_origin` geldt
# de nginx-header, en die stuurt op een 404 juist `no-store`.
#
# Idempotent: vergelijkt de bestaande rule (op description + inhoud) en zet
# alleen bij als die verschilt. Re-running is veilig.
#
# Usage (after putting a real token + zone id in .env):
#   scripts/cf-setup-cache.sh
#
# Requires a token with Zone > Cache Rules (edit) permission.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
BASE="https://api.cloudflare.com/client/v4"
PHASE="http_request_cache_settings"
DESCRIPTION="EpicNabbo CMS public API + gamedata + imaging edge cache (cms-public, cms-gamedata, cms-imaging)"

# Cache de allowlist exact zoals nginx hem tagt (deployment/proxy/nginx-cms.conf).
# Geen regex: `matches` vereist Business; vrije operators zijn `in` en
# `starts_with()`.
#
# `/cms_api/imaging/` (avatars, badges) staat erbij omdat de CMS-route zelf al
# `s-maxage=86400` + `stale-while-revalidate` stuurt: de edge kan een avatar een
# dag vasthouden, zodat herhaalde requests de lokale renderer nooit raken. De
# volledige URL (inclusief figure/code) is de cache-key, dus geen vervuiling
# tussen gebruikers.
EXPRESSION='(http.request.method eq "GET") and (http.request.uri.path in { "/cms_api/staff" "/cms_api/teams" "/cms_api/guilds" "/cms_api/photos" "/cms_api/leaderboard" "/cms_api/online" "/cms_api/online/count" "/cms_api/shop" "/cms_api/shop/categories" "/cms_api/values" "/cms_api/values/categories" "/cms_api/radio/current-dj" "/cms_api/radio/points/leaderboard" } or starts_with(http.request.uri.path, "/cms_api/values/") or starts_with(http.request.uri.path, "/cms_api/imaging/") or starts_with(http.request.uri.path, "/gamedata/"))'

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
if [[ "${#CLOUDFLARE_API_TOKEN}" -lt 16 || "${#CLOUDFLARE_ZONE_ID}" -lt 16 ]]; then
  echo "error: Cloudflare credentials look like placeholders; add a real token to .env" >&2
  exit 1
fi

api() {
  curl -sS -m 30 -X "$1" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "${2:-}" \
    "$BASE/zones/$CLOUDFLARE_ZONE_ID${3:-}"
}

echo "--- reading existing cache-settings ruleset ---"
existing="$(api GET "" "/rulesets/phases/$PHASE/entrypoint")"
if ! python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("success") else 1)' <<<"$existing"; then
  echo "error: could not read ruleset: $existing" >&2
  exit 1
fi

rule_json="$(DESCRIPTION="$DESCRIPTION" EXPRESSION="$EXPRESSION" python3 - <<'PY'
import json, os
print(json.dumps({
    "description": os.environ["DESCRIPTION"],
    "expression": os.environ["EXPRESSION"],
    "action": "set_cache_settings",
    "action_parameters": {
        "cache": True,
        "edge_ttl": {"mode": "bypass_by_default"},
        "browser_ttl": {"mode": "respect_origin"},
    },
}))
PY
)"

out="$(EXISTING_JSON="$existing" RULE_JSON="$rule_json" python3 - <<'PY'
import json, os
existing = json.loads(os.environ["EXISTING_JSON"])
rule = json.loads(os.environ["RULE_JSON"])
result = existing.get("result") or {}
rules = list(result.get("rules") or [])

def check(r):
    return {k: r.get(k) for k in ("description", "expression", "action", "action_parameters")}

keep = [r for r in rules if r.get("description") != rule["description"]]
present = [r for r in rules if r.get("description") == rule["description"]]
if present and check(present[0]) == check(rule):
    print("same")
else:
    keep.append(rule)
    print("changed")
    print(json.dumps({"rules": keep}))
PY
)"

status="$(sed -n '1p' <<<"$out")"
if [ "$status" = "same" ]; then
  echo "rule already present en identiek — geen wijzigingen"
  exit 0
fi

payload="$(sed -n '2,$p' <<<"$out")"
echo "--- ${DESCRIPTION}: rule bijwerken ---"
resp="$(api PUT "$payload" "/rulesets/phases/$PHASE/entrypoint")"
if ! python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("success") else 1)' <<<"$resp"; then
  echo "error: could not save ruleset: $resp" >&2
  exit 1
fi
echo "cache rule live. Verify: curl -s https://epicnabbo.nl/cms_api/shop -o /dev/null -D - | grep -i cf-cache-status"