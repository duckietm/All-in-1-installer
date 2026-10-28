#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/docker-update-options.sh"
expect_failure() { if (parse_update_options "$@") >/dev/null 2>&1; then echo "unexpected accepted arguments: $*" >&2; exit 1; fi; }
parse_update_options
[[ "$UPDATE_SKIP_PULL" = 0 && -z "$UPDATE_APP_DIGEST" ]]
expect_failure --unknown
expect_failure --app-digest
expect_failure --skip-pull value
expect_failure --app-digest sha256:bad --migrations-digest sha256:bad
digest="sha256:$(printf '%064d' 1)"
expect_failure --app-digest "$digest"
expect_failure --migrations-digest "$digest"
parse_update_options --skip-pull --app-digest "$digest" --migrations-digest "$digest"
[[ "$UPDATE_SKIP_PULL" = 1 && "$UPDATE_APP_DIGEST" = "$digest" && "$UPDATE_MIGRATIONS_DIGEST" = "$digest" ]]
echo 'Docker update option tests passed'
