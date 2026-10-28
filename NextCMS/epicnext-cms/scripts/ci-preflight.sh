#!/usr/bin/env bash
# Build and browser-test a branch candidate using only disposable services.
set -Eeuo pipefail
umask 077

sha="$(git rev-parse HEAD)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid preflight commit" >&2; exit 1; }
temporary="$(mktemp -d "${TMPDIR:-/tmp}/cms-preflight.XXXXXXXXXX")"
suffix="${temporary##*.}"
image="epicnext-cms:preflight-$sha-$suffix"
build_attempted=0

finish() {
  local status=$?
  trap - EXIT
  if [ "$build_attempted" -eq 1 ]; then
    # Remove this run's tag only. Never prune, force-remove or touch release tags.
    if ! docker image rm "$image"; then
      if [ "$status" -eq 0 ]; then status=1; fi
    fi
  fi
  # The private directory contains no files; never recursively delete a path.
  if ! rmdir -- "$temporary"; then
    if [ "$status" -eq 0 ]; then status=1; fi
  fi
  if [ "$status" -eq 0 ]; then echo "Branch preflight verified: $sha"; fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[[ "$temporary" = /* && -d "$temporary" && ! -L "$temporary" && "$suffix" =~ ^[a-zA-Z0-9]{10}$ ]] || {
  echo "Invalid private preflight directory" >&2
  exit 1
}

pnpm install --frozen-lockfile
pnpm exec playwright install chromium
export NEWS_E2E_IMAGE="$image"
export NEWS_E2E_RELEASE="$sha"
build_attempted=1
# Duurzame buildcache buiten de tijdelijke werkmap, zodat de lagen van een
# vorige preflight hergebruikt worden in plaats van opnieuw gedownload. Eigen
# map, gescheiden van de release-cache: een branch-preflight mag nooit de cache
# van de release-build voeden. Een lege CMS_BUILD_CACHE_DIR schakelt het uit.
build_cache_dir="${CMS_BUILD_CACHE_DIR-/var/cache/epicnext-cms-preflight-cache}"
build_cache_flags=()
if [ -n "$build_cache_dir" ]; then
  if mkdir -p "$build_cache_dir" 2>/dev/null && [ -w "$build_cache_dir" ]; then
    build_cache_flags=(
      --cache-from "type=local,src=$build_cache_dir"
      --cache-to "type=local,dest=$build_cache_dir,mode=max"
    )
  else
    echo "Warning: buildcache $build_cache_dir is niet beschrijfbaar; build zonder hergebruikte cache." >&2
  fi
fi
DOCKER_BUILDKIT=1 docker build --progress=plain \
  ${build_cache_flags[@]+"${build_cache_flags[@]}"} \
  --build-arg NEXT_DEPLOYMENT_ID="$sha" -t "$image" .
NEWS_E2E_IMAGE="$image" NEWS_E2E_RELEASE="$sha" node --import tsx e2e/news-real/run.ts