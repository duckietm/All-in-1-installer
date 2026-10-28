#!/usr/bin/env bash
# Guided setup for the existing Linux/host-network Compose deployment.
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
configure_only=0
case "${1:-}" in '') ;; --configure-only) configure_only=1 ;; *) echo "Usage: bash cms install [--configure-only]" >&2; exit 1 ;; esac
[[ $# -le 1 ]] || exit 1
umask 077
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" = Linux ]] || fail "Use a Linux Docker host. This Compose deployment uses host networking."
for command in docker git flock od tr mktemp; do command -v "$command" >/dev/null || fail "Install required command: $command"; done
docker info >/dev/null 2>&1 || fail "Docker is not reachable. Start Docker and check your account permissions."
docker compose version >/dev/null 2>&1 || fail "Install the Docker Compose plugin."
exec 9>"$DIR/.deploy.lock"
flock -w 30 9 || fail "Another installation or update is running."
[[ ! -L .env && ! -L .docker-install ]] || fail "Configuration files must not be symbolic links."
[[ "$(docker inspect --format '{{.State.Running}}' epicnext-cms-app 2>/dev/null || true)" != true ]] || fail "This host is managed by CI. Do not create a second Compose installation."
source "$DIR/scripts/docker-config.sh"
load_docker_config "$DIR" || fail "Existing .docker-install is invalid; correct it before continuing."
read_value() {
  local label="$1" default="${2:-}" secret="${3:-0}" value
  printf '%s' "$label" >&2
  [[ -z "$default" ]] || printf ' [%s]' "$default" >&2
  printf ': ' >&2
  if [[ "$secret" = 1 ]]; then
    IFS= read -r -s value || fail "Input cancelled."
    printf '\n' >&2
  else IFS= read -r value || fail "Input cancelled."; fi
  REPLY="${value:-$default}"
}
safe_value() { [[ -n "$1" && "$1" != *"'"* && "$1" != *'$'* && "$1" != *'\'* && ! "$1" =~ [[:cntrl:]] ]]; }
http_url() { safe_value "$1" && [[ "$1" =~ ^https?://[^[:space:]]+$ && "$1" != *'@'* && "$1" != *'#'* ]]; }
uri_encode() {
  local LC_ALL=C text="$1" i char
  for ((i=0;i<${#text};i++)); do
    char="${text:i:1}"
    case "$char" in [a-zA-Z0-9.~_-]) printf '%s' "$char" ;; *) printf '%%%02X' "'$char" ;; esac
  done
}
printf '%s\n' 'EpicNext-Cms installation' 'Requires an existing Habbo database and Redis. Configure HTTPS/reverse proxy to this host on port 3002.'
read_value 'Public CMS URL (e.g. https://hotel.example)' "${CMS_PUBLIC_URL:-}"
public_url="${REPLY%/}"
http_url "$public_url" && [[ "$public_url" != *'?'* ]] || fail "Enter an HTTP(S) URL without credentials, query or fragment."
printf '%s\n' 'Source builds need repository access and public build dependencies. Prebuilt images additionally need registry package access (docker login on this host for private packages).'
read_value 'Delivery method: prebuilt or source' "${CMS_INSTALL_MODE:-source}"
mode="$REPLY"
[[ "$mode" = prebuilt || "$mode" = source ]] || fail "Choose prebuilt or source."
if [[ "$mode" = prebuilt ]]; then
  IFS= read -r repository < docker-image.txt
  repository="${repository%$'\r'}"
  [[ "$repository" =~ ^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+$ ]] || fail "Invalid docker-image.txt."
  printf 'Image location is provided by the repository: %s\n' "$repository"
fi
env_tmp=""; profile_tmp=""
cleanup() { [[ -z "$env_tmp" ]] || rm -f -- "$env_tmp"; [[ -z "$profile_tmp" ]] || rm -f -- "$profile_tmp"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ -e .env ]]; then
  [[ -f .env ]] || fail ".env must be a regular file."
  printf '%s\n' 'Existing .env preserved. Check APP_URL/AUTH_URL and database settings there if needed.'
else
  read_value 'Hotel name'; hotel="$REPLY"; safe_value "$hotel" || fail "Invalid hotel name (avoid quotes, dollar signs and backslashes)."
  read_value 'Database host' '127.0.0.1'; db_host="$REPLY"
  [[ "$db_host" =~ ^[a-zA-Z0-9.-]+$ ]] || fail "Invalid database hostname."
  read_value 'Database port' '3306'; db_port="$REPLY"
  [[ "$db_port" =~ ^[0-9]{1,5}$ ]] && ((10#$db_port>0 && 10#$db_port<=65535)) || fail "Invalid database port."
  read_value 'Existing database name'; db_name="$REPLY"; [[ -n "$db_name" ]] || fail "Database name is required."
  read_value 'Database user'; db_user="$REPLY"; [[ -n "$db_user" ]] || fail "Database user is required."
  read_value 'Database password (hidden)' '' 1; db_password="$REPLY"
  database_url="mysql://$(uri_encode "$db_user"):$(uri_encode "$db_password")@$db_host:$db_port/$(uri_encode "$db_name")?charset=utf8mb4"
  unset db_password
  read_value 'Redis URL (hidden; percent-encode special characters in credentials)' 'redis://127.0.0.1:6379' 1; redis_url="$REPLY"
  safe_value "$redis_url" && [[ "$redis_url" =~ ^rediss?://[^[:space:]]+$ ]] || fail "Invalid Redis URL."
  read_value 'Avatar imager URL'; imager_url="$REPLY"; http_url "$imager_url" || fail "Invalid imager URL."
  auth_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  [[ "$auth_secret" =~ ^[0-9a-f]{64}$ ]] || fail "Could not generate the authentication secret."
  env_tmp="$(mktemp "$DIR/.env.install.XXXXXX")"
  {
    printf '%s\n' 'NODE_ENV=production' 'PORT=3002' 'NEXT_TELEMETRY_DISABLED=1' 'AUTH_TRUST_HOST=true'
    printf "HOTEL_NAME='%s'\nAPP_URL='%s'\nAUTH_URL='%s'\n" "$hotel" "$public_url" "$public_url"
    printf "DATABASE_URL='%s'\nREDIS_URL='%s'\nAUTH_SECRET='%s'\n" "$database_url" "$redis_url" "$auth_secret"
    printf "IMAGER_URL='%s'\nIMAGING_UPSTREAM_URL='%s'\nBADGE_URL='/swf/c_images/album1584'\n" "$imager_url" "$imager_url"
    printf '%s\n' 'RCON_HOST=127.0.0.1' 'RCON_PORT=3003' '# Existing Laravel 2FA: add the original APP_KEY when migrating.'
  } > "$env_tmp"
  # Atomic creation fails rather than overwriting a concurrently created .env.
  ln "$env_tmp" "$DIR/.env" || fail ".env already exists; nothing was overwritten."
  unset auth_secret database_url redis_url
fi
profile_tmp="$(mktemp "$DIR/.docker-install.tmp.XXXXXX")"
printf 'MODE=%s\nPUBLIC_URL=%s\n' "$mode" "$public_url" > "$profile_tmp"
mv -f -- "$profile_tmp" "$DIR/.docker-install"; profile_tmp=""
printf '%s\n' 'Configuration saved. Credentials remain in .env; installation settings are excluded from Git.'
if [[ "$configure_only" = 1 ]]; then printf '%s\n' 'No container was started. Next: bash cms install'; exit 0; fi
as_root() { if [[ "$EUID" = 0 ]]; then "$@"; else command -v sudo >/dev/null || fail "sudo is required to prepare runtime directories."; sudo "$@"; fi; }
for path in "$DIR/public/nitro-assets" "$DIR/public/swf" "$DIR/storage" /var/www/Gamedata; do
  [[ ! -L "$path" ]] || fail "Runtime directory is a symlink: $path. Configure its permissions manually."
  if [[ ! -d "$path" ]]; then as_root install -d -o 33 -g 33 -m 0755 "$path"; fi
  # Do not recursively change ownership of existing assets.
  [[ "$(stat -c '%u:%g' "$path")" = 33:33 ]] || as_root chown 33:33 "$path"
done
cleanup
trap - EXIT
exec 9>&-
# Avoid a stale value exported while reading previous installation settings.
unset CMS_IMAGE_REPOSITORY CMS_PUBLIC_URL
exec bash "$DIR/scripts/docker-update.sh"
