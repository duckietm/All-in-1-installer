#!/usr/bin/env bash
# Sync the nginx config from this repository to /etc/nginx and reload it.
#
# Background: on 2026-09-26 /etc/nginx and /var/log/nginx disappeared from the
# host while nginx kept serving its in-memory config; any restart would have
# taken the CMS down. This script makes the repo the source of truth so that
# cannot happen again. It is idempotent and only reloads nginx when the config
# actually changed.
#
# Usage:
#   sudo scripts/nginx-sync.sh            # install + test + reload if changed
#   sudo scripts/nginx-sync.sh --force    # always reload after a passing test
#   scripts/nginx-sync.sh --check         # just diff repo vs live, no writes
#
# Files installed (see also deployment/proxy/):
#   nginx.conf                                -> /etc/nginx/nginx.conf
#   nginx-mime.types                          -> /etc/nginx/mime.types
#   nginx-cms.conf                            -> /etc/nginx/sites-available/cms.conf
#   cloudflare-ips.conf                       -> /etc/nginx/conf.d/cloudflare-ips.conf
#   cms_upstream_servers.conf                 -> /etc/nginx/snippets/cms_upstream_servers.conf
#   (seed alleen als het bestand ontbreekt; zodra het bestaat is het runtime
#    eigendom van scripts/ci-deploy.sh en wordt het hier nooit overschreven)
#   symlink sites-enabled/cms.conf            -> ../sites-available/cms.conf
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_DIR="$SCRIPT_DIR/../deployment/proxy"
NGINX_DIR=/etc/nginx
BACKUP_DIR="/var/backups/nginx-$(date +%Y%m%d-%H%M%S)"
MODE="sync"

for arg in "$@"; do
  case "$arg" in
    --force) MODE="force" ;;
    --check) MODE="check" ;;
  esac
done

install_file() {
  local src="$1" dst="$2"
  if [[ ! -f "$src" ]]; then
    echo "error: $src not found in repo" >&2
    exit 1
  fi
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    echo "= $dst up to date"
    return 1
  fi
  if [[ "$MODE" == "check" ]]; then
    echo "- $dst differs from repo"
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ -f "$dst" ]]; then
    mkdir -p "$BACKUP_DIR"
    cp -a "$dst" "$BACKUP_DIR/"
  fi
  cp -a "$src" "$dst"
  echo "+ installed $dst"
  return 0
}

if [[ "$MODE" != "check" && "$(id -u)" -ne 0 ]]; then
  echo "error: run as root (sudo scripts/nginx-sync.sh)" >&2
  exit 1
fi

changed=0
if install_file "$PROXY_DIR/nginx.conf" "$NGINX_DIR/nginx.conf"; then changed=1; fi
if install_file "$PROXY_DIR/nginx-mime.types" "$NGINX_DIR/mime.types"; then changed=1; fi
if install_file "$PROXY_DIR/nginx-cms.conf" "$NGINX_DIR/sites-available/cms.conf"; then changed=1; fi
if install_file "$PROXY_DIR/cloudflare-ips.conf" "$NGINX_DIR/conf.d/cloudflare-ips.conf"; then changed=1; fi
# De upstream-snippet is runtime-eigendom van ci-deploy.sh (blue/green): alleen
# aanmaken op een verse host, nooit overschrijven wat een deploy heeft gezet.
if [[ -f "$NGINX_DIR/snippets/cms_upstream_servers.conf" ]]; then
  echo "= $NGINX_DIR/snippets/cms_upstream_servers.conf managed by ci-deploy.sh (untouched)"
else
  if install_file "$PROXY_DIR/cms_upstream_servers.conf" "$NGINX_DIR/snippets/cms_upstream_servers.conf"; then changed=1; fi
fi

# sites-enabled/cms.conf must be a symlink, not a copy. A regular file here
# silently shadows sites-available/cms.conf, so nginx keeps serving stale
# config even though the sync updated sites-available.
enabled="$NGINX_DIR/sites-enabled/cms.conf"
if [[ -L "$enabled" && "$(readlink "$enabled")" == "../sites-available/cms.conf" ]]; then
  echo "= $enabled symlink up to date"
else
  if [[ "$MODE" == "check" ]]; then
    echo "- $enabled is not the expected symlink"
    changed=1
  else
    mkdir -p "$NGINX_DIR/sites-enabled"
    if [[ -e "$enabled" || -L "$enabled" ]]; then
      mkdir -p "$BACKUP_DIR"
      cp -a "$enabled" "$BACKUP_DIR/cms-enabled.conf"
    fi
    ln -sfn ../sites-available/cms.conf "$enabled"
    echo "+ linked $enabled"
    changed=1
  fi
fi

if [[ "$MODE" == "check" ]]; then
  [[ "$changed" -eq 0 ]]
  exit
fi

if [[ "$MODE" == "force" ]]; then
  changed=1
fi

if [[ ! -d /var/log/nginx ]]; then
  install -d -o root -g adm -m 750 /var/log/nginx
fi
# nginx-cms.conf sets `root /var/www/html` so that disk-backed locations
# (favicon.ico) resolve somewhere the www-data worker can actually traverse.
# The previous implicit root was /etc/nginx/html, which sits behind /etc/nginx
# (0750 root:root): the worker got EACCES on every stat, and nginx logs a
# failed stat at crit, so each crawler probe wrote a crit line.
if [[ ! -d /var/www/html ]]; then
  install -d -o root -g root -m 755 /var/www/html
  echo "+ created /var/www/html (document root)"
fi
for f in /var/log/nginx/access.log /var/log/nginx/error.log; do
  [[ -f "$f" ]] || touch "$f"
done

echo "--- nginx -t ---"
nginx -t

if [[ "$changed" -eq 1 ]]; then
  echo "--- reloading nginx ---"
  nginx -s reload
else
  echo "no changes; nginx reload skipped"
fi

echo "--- health check ---"
curl -sf "http://127.0.0.1:3002/cms_api/health" > /dev/null && echo "OK: CMS reachable"
curl -skf -o /dev/null -H "Host: epicnabbo.nl" "https://127.0.0.1:9443/health" && echo "OK: nginx :9443 /health"