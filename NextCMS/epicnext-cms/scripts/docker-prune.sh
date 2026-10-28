#!/usr/bin/env bash
# Reclaim Docker's unused cache so host storage stays bounded.
#
# Modes:
#   (default) — post-deploy cleanup (safe, fast):
#     - Build cache capped at 4 GB max used space (CMS_BUILD_CACHE_MAX), evicting
#       least-recently-used entries. This cap is the actual bound.
#     - Unreferenced images older than 7 days (keeps rollback images around).
#     - Stopped containers older than 24h.
#     - Dangling images, which are always unreferenced.
#     - Orphaned Firefox profiles in byparr's writable layer (BYPARR_CONTAINERS).
#   --force — emergency mode ("never let the disk max out"): drops everything
#     with no age windows:
#     - ALL unreferenced build cache,
#     - ALL unreferenced images (no age grace),
#     - ALL stopped containers.
#
# The default mode escalates to --force on its own when / drops below 8 GB free,
# so the bound holds even if this stops running on schedule.
#
# Volumes are NEVER pruned in either mode: mariadb-turbo-data is a database.
# Idempotent; exits 0 when Docker is unavailable.
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$DIR/logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/docker-prune.log"
now() { date '+%Y-%m-%d %H:%M:%S'; }

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

command -v docker >/dev/null 2>&1 || {
  printf '[%s] docker CLI unavailable; nothing to prune\n' "$(now)" >>"$LOG_FILE"
  exit 0
}

printf '\n[%s] === docker prune start%s ===\n' "$(now)" "$( (( FORCE )) && printf ' (FORCE)' )" >>"$LOG_FILE"
docker system df >>"$LOG_FILE" 2>&1 || true

# A hard ceiling on the root filesystem is what actually bounds the growth, so
# the emergency path is reached on disk pressure rather than only on a timer.
# The image/container passes stay age-gated: a rollback image and a stopped
# container are cheap to keep for a week and expensive to lose.
FREE_KB=$(df -Pk / | awk 'NR==2 {print $4}')
# 8 GB free is comfortable for a database plus a release swap.
if (( FREE_KB < 8 * 1024 * 1024 )); then
  FORCE=1
  printf '[%s] only %s KB free on /; switching to FORCE prune\n' \
    "$(now)" "$FREE_KB" >>"$LOG_FILE"
fi

if (( FORCE )); then
  docker builder prune -af >>"$LOG_FILE" 2>&1 || true
  docker image prune -af >>"$LOG_FILE" 2>&1 || true
  docker container prune -f >>"$LOG_FILE" 2>&1 || true
else
  # --max-used-space and --filter are mutually exclusive in buildx: passing
  # both makes the cap a no-op and the cache grows without bound. The cap alone
  # is the bound, and it evicts least-recently-used entries to get there.
  docker builder prune -af --max-used-space="${CMS_BUILD_CACHE_MAX:-4g}" >>"$LOG_FILE" 2>&1 || true
  docker image prune -af --filter "until=168h" >>"$LOG_FILE" 2>&1 || true
  docker container prune -f --filter "until=24h" >>"$LOG_FILE" 2>&1 || true
fi

# Dangling images have no tag and no container, so nothing can reference them.
# They are what repeated local builds leave behind.
docker image prune -f >>"$LOG_FILE" 2>&1 || true

# ── Interrupted git gc leftovers ─────────────────────────────────
# A `git gc` that gets OOM-killed mid-repack leaves its tmp_pack behind, and
# nothing reclaims it: git only clears those on the next successful gc. One such
# file held 7.7 GB here while the whole object store was 83 MB. Only files older
# than a day are considered, so a gc running right now is never touched.
repo_dir="${CMS_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [[ -d "$repo_dir/.git/objects/pack" ]]; then
	while IFS= read -r -d '' tmp; do
		size=$(du -h "$tmp" | cut -f1)
		rm -f "$tmp"
		printf '[%s] removed leftover tmp_pack %s (%s) from an interrupted git gc\n' \
			"$(now)" "$tmp" "$size" >>"$LOG_FILE"
	done < <(find "$repo_dir/.git/objects/pack" -maxdepth 1 -name 'tmp_*' -mmin +1440 -print0 2>/dev/null)
fi

# ── Orphaned browser profiles ─────────────────────────────────────
# byparr launches a real Firefox per request, and each launch leaves a
# ~10-140 MB profile behind in the container's writable layer. Nothing ever
# removes them, so the layer grows without bound: 716 profiles / 6.8 GB after two
# days on this host, ~1.7 GB/day.
#
# Deleting a profile out from under a running browser kills that job, so live
# ones are identified the only way that is reliable rather than by age: a
# browser keeps its profile open, which shows up as a /proc/<pid>/fd symlink
# pointing into the directory. Anything not referenced that way, and untouched
# for BYPARR_PROFILE_MIN_AGE_MIN minutes, is an orphan.
#
# Age alone is not a safe signal here: browsers stay warm for ~27 hours, so an
# age window that is safe for the leak is far too wide for the disk.
BYPARR_TMP_MIN_AGE_MIN="${BYPARR_TMP_MIN_AGE_MIN:-30}"
for container in ${BYPARR_CONTAINERS:-byparr}; do
	docker inspect -f '{{.State.Running}}' "$container" >/dev/null 2>&1 || continue
	[[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" == "true" ]] || continue

	removed=$(
		docker exec -e BYPARR_TMP_MIN_AGE_MIN="$BYPARR_TMP_MIN_AGE_MIN" "$container" sh -c '
			set -u
			min_age="${BYPARR_TMP_MIN_AGE_MIN:-30}"
			base="${1:-/tmp}"
			live_file=$(mktemp)
			# Live profiles are the ones a running process still holds open.
			for p in $(ps -eo pid= 2>/dev/null); do
				ls -l "/proc/$p/fd" 2>/dev/null
			done | grep -o "$base/playwright_firefoxdev_profile-[A-Za-z0-9]*" | sort -u >"$live_file"

			count=0
			for dir in "$base"/playwright_firefoxdev_profile-*; do
				[ -d "$dir" ] || continue
				# Never touch something a process is still using.
				grep -Fxq "$dir" "$live_file" && continue
				# A profile a browser is still writing to is not an orphan
				# yet, even if the directory itself looks old.
				if find "$dir" -newermt "-${min_age} minutes" -print -quit 2>/dev/null | grep -q .; then
					continue
				fi
				rm -rf "$dir" 2>/dev/null && count=$((count + 1))
			done
			rm -f "$live_file"
			printf "%s" "$count"
		' sh /tmp 2>/dev/null || printf '0'
	)
	if [[ "${removed:-0}" -gt 0 ]]; then
		printf '[%s] removed %s orphaned browser profiles from %s\n' \
			"$(now)" "$removed" "$container" >>"$LOG_FILE"
	fi
done

printf '\n[%s] === docker prune complete%s ===\n' "$(now)" "$( (( FORCE )) && printf ' (FORCE)' )" >>"$LOG_FILE"
docker system df >>"$LOG_FILE" 2>&1 || true