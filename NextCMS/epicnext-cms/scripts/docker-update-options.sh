#!/usr/bin/env bash
# Parse before opening locks, logs or contacting Git/Docker.
parse_update_options() {
  UPDATE_SKIP_PULL=0
  UPDATE_APP_DIGEST=""
  UPDATE_MIGRATIONS_DIGEST=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-pull) UPDATE_SKIP_PULL=1; shift ;;
      --app-digest|--migrations-digest)
        [[ $# -ge 2 && "$2" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Expected a sha256 digest with 64 lowercase hex characters.' >&2; return 1; }
        if [[ "$1" = --app-digest ]]; then UPDATE_APP_DIGEST="$2"; else UPDATE_MIGRATIONS_DIGEST="$2"; fi
        shift 2 ;;
      *) echo 'Usage: bash cms update [--skip-pull] [--app-digest sha256:HEX --migrations-digest sha256:HEX]' >&2; return 1 ;;
    esac
  done
  [[ -z "$UPDATE_APP_DIGEST" && -z "$UPDATE_MIGRATIONS_DIGEST" || -n "$UPDATE_APP_DIGEST" && -n "$UPDATE_MIGRATIONS_DIGEST" ]] || { echo 'Supply both application and migrations digests.' >&2; return 1; }
}
