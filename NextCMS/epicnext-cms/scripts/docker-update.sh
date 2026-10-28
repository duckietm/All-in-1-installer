#!/usr/bin/env bash
# Update a Linux Docker Compose clone from its configured Git upstream.
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
source "$DIR/scripts/docker-update-options.sh"
parse_update_options "$@" || exit 1
exec 9>"$DIR/.deploy.lock"
flock -w 1800 9
LOG_FILE="${LOG_FILE:-$DIR/logs/docker-update.log}"
mkdir -p "$(dirname "$LOG_FILE")"
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
die() { log "ERROR: $*"; exit 1; }
# A run that legitimately has nothing to do (the host is owned by CI) must not
# look like a failure to cron. `die` stays reserved for real errors.
skip() { log "SKIP: $*"; exit 0; }
migration_image=""
remote_migration_image=""
previous_image=""
previous_release=""
rollback_tag=""
cutover=0
probe='const r=await fetch(process.argv[1],{cache:"no-store",signal:AbortSignal.timeout(5000)});const d=await r.json();if(!r.ok||d.database!==true||d.release!==process.argv[2]){console.error(JSON.stringify({http:r.status,database:d.database,release:d.release,expected:process.argv[2]}));process.exit(1)}'
verify_container() {
  local target="$1" release="$2" attempt
  for attempt in $(seq 1 30); do
    if docker exec "$target" node --input-type=module -e "$probe" "http://127.0.0.1:3002/cms_api/health" "$release" >>"$LOG_FILE" 2>&1; then return 0; fi
    sleep 3
  done
  return 1
}
finish() {
  local status=$? restored
  trap - EXIT
  if [[ "$status" != 0 && "$cutover" = 1 ]]; then
    docker compose logs --tail 100 cms >>"$LOG_FILE" 2>&1 || true
    if [[ -n "$previous_image" ]]; then
      log "Update failed; restoring previous image $previous_image. Database migrations are not reversed."
      if CMS_RELEASE="$rollback_tag" docker compose up -d --no-deps --no-build --force-recreate cms >>"$LOG_FILE" 2>&1; then
        restored="$(docker compose ps -q cms 2>>"$LOG_FILE" || true)"
        if [[ -n "$restored" && "$(docker inspect --format '{{.Image}}' "$restored")" = "$previous_image" ]] && verify_container "$restored" "$previous_release"; then
          log "Rollback verified locally: $previous_release. Check public routing separately."
        else
          log "ERROR: rollback verification failed. Inspect $LOG_FILE; previous image retained as epicnext-cms:$rollback_tag."
        fi
      else
        log "ERROR: rollback could not recreate CMS. Previous image retained as epicnext-cms:$rollback_tag."
      fi
    else
      log "First installation failed: no previous image exists to restore. Candidate retained for diagnosis."
    fi
  fi
  if [[ -n "$migration_image" ]]; then docker image rm "$migration_image" >>"$LOG_FILE" 2>&1 || true; fi
  if [[ -n "$remote_migration_image" ]]; then docker image rm "$remote_migration_image" >>"$LOG_FILE" 2>&1 || true; fi
  # Keep the recovery tag on failure for manual recovery, including same-commit rebuilds.
  if [[ ( "$status" = 0 || "$cutover" = 0 ) && -n "$rollback_tag" ]]; then docker image rm "epicnext-cms:$rollback_tag" >>"$LOG_FILE" 2>&1 || true; fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'log "Update failed; inspect $LOG_FILE. No volumes or local files were deleted."' ERR

# This host belongs to CI: the blue/green deploy owns both host ports (3002 and
# 3003) and one of the two slot containers is always the live release. Compose
# may only run where CI does not.
#
# Checking epicnext-cms-app alone was not enough. After a cutover to the green
# slot the blue container is stopped, renamed and deleted, so the guard stopped
# firing while the host stayed CI-managed. `docker compose up` then recreated a
# replica named epicnext-cms on port 3002 — the blue slot, exactly where the next
# candidate has to start — and every later release failed on a busy port until
# someone removed that container by hand (see logs/docker-update.cron.log).
# Therefore: both slot containers count, and so does the nginx upstream, which is
# the only thing that still marks the host as blue/green when a slot is idle.
ci_upstream_file="${CMS_UPSTREAM_FILE:-/etc/nginx/snippets/cms_upstream_servers.conf}"
if [ -r "$ci_upstream_file" ] && grep -qsE '127\.0\.0\.1:(3002|3003)' "$ci_upstream_file"; then
  skip "This host is managed by CI ($ci_upstream_file points at a blue/green slot). Update through CI, not a second Compose deployment."
fi
for slot_container in epicnext-cms-app epicnext-cms-green; do
  if [ "$(docker inspect --format '{{.State.Running}}' "$slot_container" 2>/dev/null || true)" = true ]; then
    skip "This host is managed by CI ($slot_container). Update through CI, not a second Compose deployment."
  fi
done
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || die "Working tree is not clean. Commit or stash local work first."
if [[ "$UPDATE_SKIP_PULL" = 0 ]]; then
  git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null || die "Configure this branch's Git upstream before updating."
  script_before="$(git hash-object scripts/docker-update.sh)"
  git pull --ff-only >>"$LOG_FILE" 2>&1
  if [ "$script_before" != "$(git hash-object scripts/docker-update.sh)" ]; then
    log "Updater changed; restarting the newly pulled script."
    exec 9>&-
    exec bash "$DIR/scripts/docker-update.sh" "$@"
  fi
fi
# Load after pulling so image location changes follow the repository.
source "$DIR/scripts/docker-config.sh"
load_docker_config "$DIR" || die "Invalid .docker-install: expected MODE=prebuilt or source and PUBLIC_URL=http(s)://your-host."
[[ -z "$UPDATE_APP_DIGEST" || -n "${CMS_IMAGE_REPOSITORY:-}" ]] || die "Digest selection requires prebuilt mode (registry access)."
export CMS_RELEASE="$(git rev-parse HEAD)"
[[ "$CMS_RELEASE" =~ ^[0-9a-f]{40}$ ]] || die "Invalid Git commit."
[[ -f .env ]] || die "Create .env before installing or updating."
docker info >/dev/null
docker compose config --quiet
previous_container="$(docker compose ps -q cms)"
if [[ -n "$previous_container" ]]; then
  previous_image="$(docker inspect --format '{{.Image}}' "$previous_container")"
  previous_release="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$previous_image")"
  [[ "$previous_release" =~ ^[0-9a-f]{40}$ ]] || die "Previous image lacks a valid release label; automatic rollback cannot be verified."
  rollback_tag="rollback-$CMS_RELEASE-$$"
  docker image tag "$previous_image" "epicnext-cms:$rollback_tag"
fi
log "Preparing release $CMS_RELEASE from $DIR"
# The migrations stage contains matching source and locked dependencies.
# No Node/package manager installation on the host is required.
migration_image="epicnext-cms-migrations:$CMS_RELEASE"
if [[ -n "${CMS_IMAGE_REPOSITORY:-}" ]]; then
  [[ "$CMS_IMAGE_REPOSITORY" =~ ^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+$ ]] || die "Invalid CMS_IMAGE_REPOSITORY; use registry/owner/image without a tag."
  log "Pulling prebuilt application and matching migrations for $CMS_RELEASE"
  app_reference="$CMS_IMAGE_REPOSITORY:$CMS_RELEASE"
  [[ -z "$UPDATE_APP_DIGEST" ]] || app_reference="$CMS_IMAGE_REPOSITORY@$UPDATE_APP_DIGEST"
  docker pull "$app_reference" >>"$LOG_FILE" 2>&1 || die "Application image unavailable. Publication for this commit may still be running; retry bash cms update after CI succeeds. For private packages, log in to the registry first."
  remote_migration_image="$CMS_IMAGE_REPOSITORY:$CMS_RELEASE-migrations"
  [[ -z "$UPDATE_MIGRATIONS_DIGEST" ]] || remote_migration_image="$CMS_IMAGE_REPOSITORY@$UPDATE_MIGRATIONS_DIGEST"
  docker pull "$remote_migration_image" >>"$LOG_FILE" 2>&1 || die "Matching migrations image unavailable. Current CMS is unchanged; retry after publication succeeds."
  docker tag "$app_reference" "epicnext-cms:$CMS_RELEASE"
  docker tag "$remote_migration_image" "$migration_image"
else
  docker build --target migrations --build-arg NEXT_DEPLOYMENT_ID="$CMS_RELEASE" \
    --cache-from type=local,src=.docker-cache/cms \
    -t "$migration_image" . >>"$LOG_FILE" 2>&1
  docker compose build --build-arg NEXT_DEPLOYMENT_ID="$CMS_RELEASE" cms >>"$LOG_FILE" 2>&1
fi
expected_image="$(docker image inspect --format '{{.Id}}' "epicnext-cms:$CMS_RELEASE")"
revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$expected_image")"
[[ "$revision" = "$CMS_RELEASE" ]] || die "Built image has revision $revision, expected $CMS_RELEASE."
migration_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$migration_image")"
[[ "$migration_revision" = "$CMS_RELEASE" ]] || die "Migrations image has no matching release label. Rebuild/publish both artifacts from this checkout; the database was not changed."
# Compose uses the candidate image's USER and exact mounts/env without starting the server.
docker compose run --rm --no-deps --entrypoint node cms --input-type=module -e 'import {access,constants} from "node:fs/promises";import {validateRuntime} from "./docker-start.mjs";validateRuntime(process.env);for(const p of ["/app/storage","/app/public/nitro-assets","/app/public/swf","/var/www/Gamedata"]){try{await access(p,constants.R_OK|constants.W_OK|constants.X_OK)}catch{console.error("Runtime storage access denied: "+p);process.exit(1)}}' >>"$LOG_FILE" 2>&1 || die "Candidate configuration/storage validation failed; database unchanged. Check directory access for UID/GID 33."
log "Before migration: ensure a verified database backup is available. Image rollback does not undo database migrations."
migration_mounts=(--mount "type=bind,source=$DIR/.env,target=/app/.env,readonly")
if [[ -f "$DIR/.env.local" ]]; then migration_mounts+=(--mount "type=bind,source=$DIR/.env.local,target=/app/.env.local,readonly"); fi
docker run --rm --network host "${migration_mounts[@]}" --entrypoint pnpm "$migration_image" db:migrate >>"$LOG_FILE" 2>&1
log "Build and migrations completed; recreating only the CMS service."
cutover=1
docker compose up -d --no-deps --no-build --force-recreate cms >>"$LOG_FILE" 2>&1
container="$(docker compose ps -q cms)"
[[ -n "$container" ]] || die "Compose did not start the CMS container."
actual_image="$(docker inspect --format '{{.Image}}' "$container")"
[[ "$actual_image" = "$expected_image" ]] || die "Running image $actual_image differs from built image $expected_image."
verify_container "$container" "$CMS_RELEASE" || die "HTTP health/release verification failed."
if [[ -n "${CMS_PUBLIC_URL:-}" ]]; then
  [[ "$CMS_PUBLIC_URL" = https://* || "$CMS_PUBLIC_URL" = http://* ]] || die "CMS_PUBLIC_URL must be an HTTP(S) URL."
  docker exec "$container" node --input-type=module -e "$probe" "${CMS_PUBLIC_URL%/}/cms_api/health?release=$CMS_RELEASE" "$CMS_RELEASE" >>"$LOG_FILE" 2>&1 || die "Public domain serves another release or is unhealthy. Check reverse proxy/CDN destination."
  log "Public URL verified: $CMS_PUBLIC_URL"
else
  log "Public domain was not checked. Set CMS_PUBLIC_URL to verify reverse proxy/CDN routing as well."
fi
log "Verified release $CMS_RELEASE, image $actual_image, container $container"
cutover=0
# Record only this checkout's successful release tags; never prune Docker globally.
history="$DIR/logs/docker-release-history.log"
mkdir -p "$DIR/logs"
touch "$history"
mapfile -t releases < <(printf '%s\n' "$CMS_RELEASE" "$previous_release"; cat "$history")
kept=()
pending=()
for release in "${releases[@]}"; do
  [[ "$release" =~ ^[0-9a-f]{40}$ ]] || continue
  [[ " ${kept[*]} ${pending[*]} " != *" $release "* ]] || continue
  if [[ "${#kept[@]}" -lt 2 ]]; then kept+=("$release"); continue; fi
  # Even stopped containers belonging to other deployments protect an image.
  if users="$(docker ps -aq --filter "ancestor=epicnext-cms:$release")" && [[ -z "$users" ]] && docker image rm "epicnext-cms:$release" >>"$LOG_FILE" 2>&1; then
    if [[ -n "${CMS_IMAGE_REPOSITORY:-}" ]]; then
      if remote_users="$(docker ps -aq --filter "ancestor=$CMS_IMAGE_REPOSITORY:$release")" && [[ -z "$remote_users" ]]; then
        docker image rm "$CMS_IMAGE_REPOSITORY:$release" >>"$LOG_FILE" 2>&1 || true
      fi
    fi
    log "Removed superseded release tag $release"
  else
    pending+=("$release")
  fi
done
printf '%s\n' "${kept[@]}" "${pending[@]}" > "$history.tmp"
mv "$history.tmp" "$history"
log "Keeping the two latest releases; in-use images and persistent volumes are preserved."
# Reclaim build cache + unreferenced images + long-stopped containers only;
# the scoped retention is enforced inside docker-prune.sh (never volumes).
bash "$DIR/scripts/docker-prune.sh" >>"$LOG_FILE" 2>&1 || log "Docker prune reported an error (see $LOG_FILE)"
log "Pruned unused Docker cache."
