#!/usr/bin/env bash
# Read installation metadata as data, never execute it as a shell script.
load_docker_config() {
  local root="$1" key value mode="" public_url="" repository=""
  [[ -f "$root/.docker-install" ]] || return 0
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    value="${value%$'\r'}"
    case "$key" in
      ''|'#'*) continue ;;
      MODE) [[ "$value" = prebuilt || "$value" = source ]] || return 1; mode="$value" ;;
      PUBLIC_URL) [[ "$value" =~ ^https?://[^[:space:]]+$ && "$value" != *'@'* && "$value" != *'?'* && "$value" != *'#'* ]] || return 1; public_url="$value" ;;
      *) echo "Unknown installation setting: $key" >&2; return 1 ;;
    esac
  done < "$root/.docker-install"
  [[ -n "$mode" && -n "$public_url" ]] || return 1
  if [[ "$mode" = prebuilt && ! ${CMS_IMAGE_REPOSITORY+x} ]]; then
    IFS= read -r repository < "$root/docker-image.txt"
    repository="${repository%$'\r'}"
    [[ "$repository" =~ ^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+$ ]] || return 1
    export CMS_IMAGE_REPOSITORY="$repository"
  fi
  CMS_INSTALL_MODE="$mode"
  export CMS_PUBLIC_URL="${CMS_PUBLIC_URL-$public_url}"
}
