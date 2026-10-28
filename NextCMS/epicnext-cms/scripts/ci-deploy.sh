#!/usr/bin/env bash
# One lock covers build, migrations, cutover, health checks and smoke tests.
set -Eeuo pipefail

deploy_dir="${CMS_DEPLOY_DIR:-/var/www/atom-nexst}"
branch="${DEPLOY_BRANCH:-main}"
case "$branch" in main|master) ;; *) echo "Unsupported deployment branch" >&2; exit 1 ;; esac
exec 9>"$deploy_dir/.deploy.lock"
flock -w 1800 9

sha="$(git rev-parse HEAD)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit" >&2; exit 1; }
image="epicnext-cms:$sha"
previous_name=""
previous_image=""
secondary_name=""
secondary_backup="epicnext-cms-rollback-secondary"
secondary_backup_created=0
backup_name="epicnext-cms-rollback"
cutover_started=0
candidate_attempted=0
backup_created=0

# ── Blue/green ──
# De app draait met `--net=host`, dus elke replica neemt een eigen host-poort in
# plaats van een gedeelde docker-poort. Daardoor zijn er twee vaste slots en kan
# een release naast de live release opstarten. De nginx-upstream wijst pas naar
# de nieuwe release nadat die gezond is én de browsersmoke-test heeft gewonnen.
slot_a_port=3002
slot_b_port=3003
slot_a_container="epicnext-cms-app"
slot_b_container="epicnext-cms-green"
# Overridable zodat de simulatietests een pad kunnen opgeven dat niet bestaat en
# zo het in-place pad kunnen testen, en zodat een host met een andere
# nginx-indeling niet stilvalt op een release.
upstream_file="${CMS_UPSTREAM_FILE:-/etc/nginx/snippets/cms_upstream_servers.conf}"
nginx_site="${CMS_NGINX_SITE:-/etc/nginx/sites-enabled/cms.conf}"
active_port=""
old_port=""
new_port=""
old_container=""
new_container=""
blue_green=0

# CPU en pids zijn bewust verwijderd; memory blijft gelimiteerd op 4g/5g swap
# om een geheugenlek niet de host te laten vullen (MariaDB, nginx, Traefik).
mem_limit="4g"
mem_swap_limit="5g"

is_current() {
  local head
  head="$(git ls-remote --exit-code origin "refs/heads/$branch")" || return 2
  head="${head%%[[:space:]]*}"
  if [ "$head" != "$sha" ]; then
    echo "Skipping superseded commit $sha (branch now at $head)"
    return 1
  fi
}

check_current() {
  local status=0
  is_current || status=$?
  case "$status" in 0) ;; 1) exit 0 ;; *) echo "Cannot verify remote branch" >&2; exit 1 ;; esac
}

healthy() {
  local port="${1:-$slot_a_port}"
  local attempt
  for attempt in $(seq 1 30); do
    if curl -sf --max-time 5 "http://127.0.0.1:$port/api/health" | grep -q '"database":true'; then return 0; fi
    sleep 3
  done
  return 1
}

# Zelfde check als `healthy`, maar zonder retries. Voor het bepalen van de
# actieve poort willen we geen 90 seconden per slot wachten: daar gaat het om
# een al draaiend proces dat nu of nooit antwoordt.
answers_health() {
  curl -sf --max-time 5 "http://127.0.0.1:$1/api/health" | grep -q '"database":true'
}

# Staat er een blue/green-upstream? Zonder die bestanden blijft dit script op de
# oude, in-place cutover vallen, zodat een host met een andere nginx-indeling
# niet stilvalt op een upgrade.
detect_blue_green() {
  [ -r "$upstream_file" ] || return 1
  grep -qs 'cms_app' "$nginx_site" || return 1
  return 0
}

# Welke poort is op dit moment ÉCHT live?
#
# Volgorde van vertrouwen:
#   1. Het nginx-upstream-bestand. Dat is de enige bron die aangeeft wáár het
#      publieke verkeer daadwerkelijk binnenkomt; alles daaronder is gevolg.
#   2. Een gezond slot dat overeenkomt met die aanwijzing.
#   3. Precies één gezond slot (een verse host met geen upstream-bestand).
#
# De eerdere versie telde gezonde slots en gebruikte de fallback pas als er 0 of
# 2+ waren. Op een host waar beide slots tegelijk gezond zijn — bijvoorbeeld
# doordat een losse `docker compose up` een extra replica heeft achtergelaten —
# gaf dat een willekeurige keuze, en dan kon de kandidaat op een bezette poort
# starten (EADDRINUSE) terwijl de health-check de reeds draaiende container op
# die poort beantwoordde. De release-vergelijking faalde dan 30 keer op een
# container die toevallig een andere release draaide.
read_active_port() {
  local port="" pointed=""

  if [ -r "$upstream_file" ]; then
    port="$(grep -oE '127\.0\.0\.1:(3002|3003)' "$upstream_file" 2>/dev/null | head -1 | cut -d: -f2 || true)"
  fi

  if [ -n "$port" ] && answers_health "$port"; then
    printf '%s' "$port"
    return 0
  fi

  # Het upstream-bestand wijst naar een slot dat niet antwoordt. Kies dan het
  # enige andere gezonde slot, anders is er niets om op te bouwen.
  for candidate in "$slot_a_port" "$slot_b_port"; do
    [ "$candidate" = "$port" ] && continue
    if answers_health "$candidate"; then
      echo "nginx points at ${port:-unknown}, which is unhealthy; ${candidate} answers instead" >&2
      printf '%s' "$candidate"
      return 0
    fi
  done

  # Geen enkel slot antwoordt. Vertrouw dan op het bestand, zodat een
  # rollback-poging toch het vorige slot kan starten.
  if [ -n "$port" ]; then
    printf '%s' "$port"
    return 0
  fi

  printf '%s' "$slot_a_port"
}

# Poort-bezetting controleren vóór het starten van de kandidaat.
#
# Zonder deze check zorgt `docker run` er stilzwijgend voor dat de kandidaat
# dood gaat op EADDRINUSE, terwijl de health-check ondertussen de reeds draaiende
# container op diezelfde poort beantwoordt. Dat levert een misleidende
# "expected release never became healthy" op in plaats van de echte oorzaak.
# Elke listener wordt hierboven concreet genoemd, inclusief de container die
# hem vasthoudt.
assert_port_free() {
  local port="$1" name="$2"
  local holders=""
  # `type`, niet `command -v`: de deploy-simulatietests leveren `ss` als
  # shell-functie via BASH_ENV, en `command -v` herkent die wel op Bash maar de
  # functie is niet geëxporteerd naar de subshell van start_candidate. Met `type`
  # blijft de stub ook daar zichtbaar, zodat de test geen echte hostpoorten
  # hoeft te zien.
  if type ss >/dev/null 2>&1; then
    # `ss` drukt altijd een kolomkop af, ook als er geen listener is. Filter op
    # LISTEN, anders zou elke vrije poort als bezet gemeld worden.
    holders="$(ss -ltnp "sport = :$port" 2>/dev/null | grep -F 'LISTEN' || true)"
  fi
  [ -z "$holders" ] && return 0
  echo "Port $port is already in use, cannot start candidate $name" >&2
  printf '%s\n' "$holders" >&2

  # Noem exact het container dat de poort vasthoudt.
  #
  # `docker ps --filter publish=` werkt niet: de app draait met --net=host en
  # publiceert dus geen poorten, dus die filter levert altijd niets op. In plaats
  # daarvan volgen we de luisterende PID uit `ss` terug naar de container via
  # /proc/<pid>/cgroup. Een eerdere versie noemde álle draaiende containers als
  # belkenners, wat de echte boosdochter (epicnext-cms) onder een zee van
  # onschuldige containers begraven.
  local squatter="squatter_pids"
  squatter_pids="$(printf '%s\n' "$holders" | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
  if [ -n "$squatter_pids" ]; then
    local pid cid owner=""
    for pid in $squatter_pids; do
      cid="$(sed -n 's#.*docker-\([0-9a-f]\{64\}\)\.scope#\1#p' "/proc/$pid/cgroup" 2>/dev/null | head -1)"
      [ -n "$cid" ] || continue
      owner="$(docker inspect --format '{{.Name}} ({{.Config.Image}})' "$cid" 2>/dev/null || true)"
      [ -n "$owner" ] && printf 'Held by container: %s\n' "${owner#/}" >&2
    done
  fi
  echo "" >&2
  # Blauwe/groene releases beheren hun eigen slots. Een container met een andere
  # naam die toevallig op een van deze poorten draait — meestal een
  # `docker compose up`-replica — staat los van de pipeline en blokkeert de
  # release. Live verkeer loopt via het nginx-upstream over het andere slot en is
  # dus niet geraakt.
  case "$owner" in
    *"/$name"*|*"/$slot_b_container"*)
      echo "Note: the holder looks like a managed slot container; re-check the port mapping above." >&2 ;;
    *)
      cat >&2 <<EOF
This port is held by a container that is not a blue/green slot, so the deploy
cannot start the candidate. Live traffic is unaffected: nginx keeps serving
the other slot until cutover.

Remove the stray container and re-run the deploy:

  docker rm -f $(printf '%s' "$owner" | sed -n 's#.*/\([^ ]*\).*#\1#p')

If it comes back after a reboot, it is started by docker-compose.yml rather
than by this script; delete or disable that service.
EOF
      ;;
  esac
  return 1
}

# Ruim een compose-replica op die een blauwe/groene slot bezet.
#
# Een `docker compose up` — of de dagelijkse `scripts/docker-update.sh`, waarvan
# de CI-eigendomscontrole per slot wankelde — laat een replica met container_name
# `epicnext-cms` achter op poort 3002. Die draait nooit live: nginx wijst naar de
# poort van een slot-container die dit script zelf heeft gestart, en die staat per
# definitie aan de andere kant dan de kandidaat. Zonder deze opruimstap loopt elke
# release vast op een bezette poort totdat iemand de container met de hand
# verwijdert.
#
# Bewust smal, want een container van een ander deployment is niet van ons:
#   - alleen een replica die uit precies deze checkout komt
#     (com.docker.compose.project.config_files), niet een losse compose-project;
#   - nooit een slot-container, want die beheert dit script zelf;
#   - nooit de poort waar nginx naar wijst.
# Wat daarnaast nog op de doel-poort zit, laat assert_port_free() met zijn eigen
# foutmelding staan in plaats van stilzwijgend verdwijnen.
retire_compose_replicas() {
  local live_port="$1" cid name="" config_files="" port=""
  while read -r cid; do
    [ -n "$cid" ] || continue
    name="$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed -n 's#^/##p' || true)"
    case "$name" in ''|"$slot_a_container"|"$slot_b_container") continue ;; esac
    config_files="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$cid" 2>/dev/null || true)"
    [ "$config_files" = "$deploy_dir/docker-compose.yml" ] || continue
    port="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$cid" 2>/dev/null | sed -n 's#^PORT=##p' | head -1 || true)"
    [ -n "$port" ] && [ "$port" != "$live_port" ] || continue
    echo "Removing compose replica $name on port $port: it squats a blue/green slot and is not the live release (nginx serves $live_port)"
    docker rm -f "$name" || return 1
  done < <(docker ps --filter "label=com.docker.compose.project.config_files=$deploy_dir/docker-compose.yml" --format '{{.ID}}')
  return 0
}

# Zet de nginx-upstream op de nieuwe poort en herlaadt graceful.
#
# De nieuwe inhoud wordt eerst echt weggeschreven en dán getest: `nginx -t` leest
# het include-bestand van schijf, dus alleen achteraf testen zou de oude, werkende
# configuratie blijven valideren. Faalt de test, dan gaat het origineel onmiddellijk
# terug en raakt de live release niets.
switch_upstream() {
  local port="$1"
  local backup="${upstream_file}.deploy.bak"
  if ! cp "$upstream_file" "$backup" 2>/dev/null; then
    echo "Cannot back up $upstream_file; refusing to cut over" >&2
    return 1
  fi
  {
    echo "# Geschreven door scripts/ci-deploy.sh op $(date -u +%FT%TZ) voor release $sha."
    echo "# Niet met de hand bewerken: de volgende deploy overschrijft dit bestand."
    echo "server 127.0.0.1:${port} max_fails=2 fail_timeout=10s;"
  } >"$upstream_file"
  if ! nginx -t >/dev/null 2>&1; then
    echo "nginx rejected the new upstream; restoring the previous one" >&2
    mv "$backup" "$upstream_file"
    return 1
  fi
  if ! nginx -s reload; then
    echo "nginx reload failed; restoring the previous upstream" >&2
    mv "$backup" "$upstream_file"
    nginx -s reload || true
    return 1
  fi
  rm -f "$backup"
  # Even de tijd voor de graceful reload om de nieuwe worker te laten starten.
  sleep 1
  return 0
}

# Start de kandidaat op een eigen host-poort.
#
# De resource limits staan hier bewust bij de `docker run` en niet alleen in
# docker-compose.yml: een release wordt hier gestart en gebruikt compose helemaal
# niet, dus limieten die alleen in de compose stonden zouden in productie nooit
# gelden.
start_candidate() {
  local port="$1" name="$2"
  assert_port_free "$port" "$name"
  (
    set -a
    # shellcheck disable=SC1091
    . "$deploy_dir/.env"
    set +a
    ENV_ARGS=()
    while IFS='=' read -r key _; do
      case "$key" in ''|'#'*|*[!A-Za-z0-9_]* ) continue ;; esac
      ENV_ARGS+=(-e "$key")
    done < "$deploy_dir/.env"
    docker run -d --name "$name" --restart always --net=host \
      --memory="$mem_limit" --memory-swap="$mem_swap_limit" \
      "${ENV_ARGS[@]}" -e "PORT=$port" -e HOSTNAME=0.0.0.0 \
      -v "$deploy_dir/public/nitro-assets:/app/public/nitro-assets" \
      -v "$deploy_dir/public/swf:/app/public/swf" \
      -v "$deploy_dir/storage:/app/storage" \
      -v /var/www/Gamedata:/var/www/Gamedata \
      "$image"
  )
}

finish() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$blue_green" -eq 1 ]; then
    # Er zijn twee soorten falen, en het verschil bepaalt hoeveel werk terug moet.
    if [ "$cutover_started" -eq 0 ]; then
      # De live release draait nog ongestoord; alleen de kandidaat opruimen.
      echo "Deployment failed before cutover; the live release was never stopped" >&2
      if [ "$candidate_attempted" -eq 1 ] && [ -n "$new_container" ] && docker inspect "$new_container" >/dev/null 2>&1; then
        docker logs "$new_container" --tail 50 >&2 || true
        docker rm -f "$new_container" || true
      fi
    else
      # nginx wijst nu naar de kandidaat. Eerst het verkeer terug, dan pas de
      # kandidaat weghalen, anders zou de site 502-en terwijl we terugdraaien.
      echo "Deployment failed after cutover; rolling back to port $old_port" >&2
      if [ -n "$new_container" ] && docker inspect "$new_container" >/dev/null 2>&1; then docker logs "$new_container" --tail 50 >&2 || true; fi
      if [ -n "$old_port" ]; then switch_upstream "$old_port" || true; fi
      if [ -n "$new_container" ] && docker inspect "$new_container" >/dev/null 2>&1; then docker rm -f "$new_container" || true; fi
      if [ -n "$old_container" ] && docker start "$old_container" >/dev/null 2>&1; then
        if healthy "$old_port"; then
          echo "Rollback verified on port $old_port"
        else
          echo "ERROR: previous container did not return to a healthy state" >&2
        fi
      else
        echo "ERROR: no previous container to roll back to" >&2
      fi
    fi
  elif [ "$status" -ne 0 ] && [ "$cutover_started" -eq 1 ]; then
    # In-place pad (geen blue/green-upstream): het oude scriptgedrag.
    echo "Deployment failed; restoring previous container" >&2
    docker logs epicnext-cms-app --tail 50 >&2 || true
    if command -v ss >/dev/null 2>&1; then ss -ltnp 'sport = :3002' >&2 || true; fi
    if [ "$candidate_attempted" -eq 1 ]; then docker rm -f epicnext-cms-app || true; fi
    if [ "$backup_created" -eq 1 ]; then docker rename "$backup_name" "$previous_name" || true; fi
    if [ "$secondary_backup_created" -eq 1 ]; then
      docker rename "$secondary_backup" "$secondary_name" || true
    fi
    if [ -n "$previous_name" ]; then
      if docker start "$previous_name" && healthy; then
        echo "Rollback verified: $previous_image"
      else
        echo "ERROR: previous container could not be restored to healthy state" >&2
      fi
    else
      echo "No previous container exists; rollback is unavailable" >&2
    fi
    if [ "$secondary_backup_created" -eq 1 ]; then docker start "$secondary_name" || true; fi
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

check_current
# Read-only ownership evidence before any build or container cutover.
if command -v ss >/dev/null 2>&1; then
  listeners="$(ss -ltnp 'sport = :3002' 2>/dev/null || true)"
  printf '%s\n' "$listeners"
  while read -r listener_pid; do
    [ -n "$listener_pid" ] || continue
    printf 'Port owner PID=%s cwd=' "$listener_pid"
    readlink "/proc/$listener_pid/cwd" || true
    cat "/proc/$listener_pid/cgroup" 2>/dev/null || true
    ps -o pid=,ppid=,user=,comm= -p "$listener_pid" || true
  done < <(printf '%s' "$listeners" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
fi
for managed_name in epicnext-cms epicnext-cms-app; do
  docker inspect --format '{{.Name}} running={{.State.Running}} pid={{.State.Pid}} image={{.Image}}' "$managed_name" 2>/dev/null || true
done
[ "$deploy_dir/.env" -ef .env ] || cp "$deploy_dir/.env" .env

# De migraties draaien op de host tegen DATABASE_URL, niet in de container. Die
# waarde staat alleen in $deploy_dir/.env, dus controleer hem hier: anders
# bouwen we eerst een image en doorlopen we de browsergate voordat `db:migrate`
# op een lege DATABASE_URL stukloopt. Dat is een halve release voor niets.
if ! grep -qs '^DATABASE_URL=' .env; then
  echo "Error: DATABASE_URL ontbreekt in $deploy_dir/.env" >&2
  echo "       Zet daar een DATABASE_URL (mysql://user:pass@host:3306/db) en draai opnieuw." >&2
  echo "       De live release is niet aangeraakt; deze release is niet uitgerold." >&2
  exit 1
fi

# De image krijgt het label van $sha, en `verify-deployed-release.mjs` controleert
# later alleen díe label. Zonder deze check bouwt een vuile werkboom dus een image
# die zegt release $sha te zijn terwijl er ongecommitte code in zit — precies het
# scenario "rebuilden levert geen nieuwe code". `docker-update.sh` deed dit al.
# `--untracked-files=normal` laat gitignored artefacten (.next, coverage,
# build-reports) buiten beschouwing; die worden toch niet meegebouwd.
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "Error: de werkboom is niet schoon, dus de image zou een verkeerd release-label krijgen." >&2
  echo "       Commit of stash de wijzigingen en draai opnieuw." >&2
  echo "       De live release is niet aangeraakt." >&2
  git status --short >&2
  exit 1
fi

pnpm install --frozen-lockfile
# All three engines are needed: the chromium gate below plus the cross-browser
# imaging gate just before cutover. Idempotent — already-installed engines in
# PLAYWRIGHT_BROWSERS_PATH are detected and skipped.
pnpm exec playwright install chromium firefox webkit

echo "Building $image"
# Duurzame buildcache buiten de werkboom. De CI-werkboom wordt na elke job
# gewist en `docker builder prune` gooit de buildcache weg, waarna de hele
# pnpm-laag opnieuw gedownload moet worden. Een lokale cache-export overleeft
# allebei. Een lege CMS_BUILD_CACHE_DIR schakelt de cache uit.
build_cache_dir="${CMS_BUILD_CACHE_DIR-/var/cache/epicnext-cms-buildcache}"
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
# No --network=host: BuildKit only grants it via --allow=network.host, and the
# build needs nothing but outbound internet (apk, pnpm, next/font/google).
DOCKER_BUILDKIT=1 docker build --progress=plain --cache-from epicnext-cms:latest \
  ${build_cache_flags[@]+"${build_cache_flags[@]}"} \
  --build-arg NEXT_DEPLOYMENT_ID="$sha" -t "$image" .
check_current
# Read reports from the already-built image; do not start an extra application.
report_container=""
if report_container="$(docker create --entrypoint /bin/true "$image")" && [ -n "$report_container" ]; then
  mkdir -p build-reports
  if docker cp "$report_container:/app/build-reports/." build-reports && [ -s build-reports/report.md ]; then
    cat build-reports/report.md
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      cat build-reports/report.md >> "$GITHUB_STEP_SUMMARY" || echo "Warning: could not append performance summary" >&2
    fi
  else
    echo "Warning: build performance report unavailable" >&2
  fi
  docker rm "$report_container" >/dev/null
else
  echo "Warning: could not extract build performance report" >&2
fi
# Exercise the candidate with disposable services before any live migration or cutover.
NEWS_E2E_IMAGE="$image" NEWS_E2E_RELEASE="$sha" node --import tsx e2e/news-real/run.ts
check_current
pnpm db:migrate
check_current

# ── Blue/green: bepaal wie live is en waar de kandidaat mag starten ──
if detect_blue_green; then
  blue_green=1
  active_port="$(read_active_port)"
  if [ "$active_port" = "$slot_b_port" ]; then
    old_port=$slot_b_port; new_port=$slot_a_port
    old_container=$slot_b_container; new_container=$slot_a_container
  else
    old_port=$slot_a_port; new_port=$slot_b_port
    old_container=$slot_a_container; new_container=$slot_b_container
  fi
  echo "Live release keeps serving port $old_port; candidate starts on port $new_port"
  # Rollback-evidence vastleggen voordat er iets wordt veranderd.
  if docker inspect "$old_container" >/dev/null 2>&1; then
    previous_name="$old_container"
    previous_image="$(docker inspect --format '{{.Image}}' "$old_container")"
    docker tag "$previous_image" epicnext-cms:previous
  else
    # Eerste release op een verse blue/green-opstelling: er is nog niets live.
    previous_name=""
    old_container=""
  fi
else
  blue_green=0
  # Prefer the active CI container, or the active legacy compose container.
  for name in epicnext-cms epicnext-cms-app; do
    if [ "$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null || true)" = true ]; then
      if [ -z "$previous_name" ]; then previous_name="$name"; else secondary_name="$name"; fi
    fi
  done
  if [ -z "$previous_name" ]; then
    for name in epicnext-cms-app epicnext-cms; do
      if docker inspect "$name" >/dev/null 2>&1; then previous_name="$name"; break; fi
    done
  fi
  if [ -n "$previous_name" ]; then
    previous_image="$(docker inspect --format '{{.Image}}' "$previous_name")"
    docker tag "$previous_image" epicnext-cms:previous
  fi
  # Remove a stopped leftover CI container when the compose container is active.
  if [ "$previous_name" != epicnext-cms-app ] && [ "$secondary_name" != epicnext-cms-app ] && docker inspect epicnext-cms-app >/dev/null 2>&1; then
    docker rm epicnext-cms-app
  fi
fi
if docker inspect "$backup_name" >/dev/null 2>&1; then
  echo "Unresolved rollback container exists; refusing to overwrite it" >&2
  exit 1
fi

# The application writes everything under storage/ as uid 33, but storage is a
# host bind so the image's own ownership is irrelevant. Any path that is not
# uid 33 makes the write fail with EACCES, and because most of these writes are
# inside a try/catch the failure is silent: the avatar cache just never fills
# (each avatar becomes a fresh live render) and the catalog export reports
# "delivery failed" while the emulator never receives the update. The old code
# only repaired storage/imaging, so storage/catalog-git/hotel-status.json kept
# coming back root:root and /api/admin/catalog/status kept throwing EACCES.
for owned_dir in imaging catalog-git cms-errors furniture-imports logs media \
  nitro-cleanup config-backups nitro-scale32-backups; do
  target="$deploy_dir/storage/$owned_dir"
  [ -e "$target" ] || mkdir -p "$target" 2>/dev/null || true
  [ -d "$target" ] || continue
  chown -R 33:33 "$target" 2>/dev/null || true
done
# The avatar/badge cache needs its leaf directories to exist before first use;
# the cache misses (and re-renders live) rather than erroring when they do not.
for cache_dir in avatars badges; do
  if ! install -d -o 33 -g 33 -m 0750 "$deploy_dir/storage/imaging/$cache_dir" 2>/dev/null; then
    mkdir -p "$deploy_dir/storage/imaging/$cache_dir" 2>/dev/null || true
  fi
done

if [ "$blue_green" -eq 1 ]; then
  # 1. Maak de doel-poort vrij. Alles wat daar draait is per definitie niet live,
  #    want nginx wijst nog naar old_port. Een restje van een mislukte eerdere
  #    deploy mag de nieuwe release niet blokkeren.
  if docker inspect "$new_container" >/dev/null 2>&1; then
    docker rm -f "$new_container"
  fi

  # 2. Een compose-replica die ooit is achtergebleven zit hier nog op de
  #    doel-poort. Hij draait niet live en wordt dus opgeruimd, zodat de release
  #    niet op een bezette poort stukloopt.
  retire_compose_replicas "$old_port"

  # 3. Start de kandidaat ernaast. De live release draait ononderbroken door.
  candidate_attempted=1
  start_candidate "$new_port" "$new_container"

  # 4. Gezond? Release-hash klopt? Browsersmoke-test? Pas dan hoeft het oude
  #    release het veld te ruimen — anders zou een mislukte e2e-test pas ná de
  #    cutover de productie breken in plaats van ervoor.
  healthy "$new_port"
  node scripts/verify-deployed-release.mjs "http://127.0.0.1:$new_port/api/health" "$sha"
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:$new_port" pnpm test:e2e

  # 4b. Cross-browser imaging gate. The chromium suite above proves the
  #     candidate serves the right bytes; this proves every bundled engine can
  #     actually decode the render. The webkit path is the one that historically
  #     broke (CSP upgrade-insecure-requests + animated PNG), and a regression
  #     there must never reach live. Set DEPLOY_SKIP_CROSS_BROWSER=1 only to get
  #     a release out in an emergency.
  if [ "${DEPLOY_SKIP_CROSS_BROWSER:-0}" = "1" ]; then
    echo "WARNING: cross-browser imaging gate skipped (DEPLOY_SKIP_CROSS_BROWSER=1)" >&2
  else
    PLAYWRIGHT_BASE_URL="http://127.0.0.1:$new_port" pnpm test:imaging
  fi

  # 5. Het enige onomkeerbare moment: vanaf hier wijst nginx naar de kandidaat.
  cutover_started=1
  switch_upstream "$new_port"
  echo "Cut over to port $new_port; retiring port $old_port"

  # 6. Nu mag de oude release weg. Pas ná de swap, zodat er nooit een moment is
  #    waarop er geen enkele container draait.
  if [ -n "$old_container" ] && docker inspect "$old_container" >/dev/null 2>&1; then
    docker stop "$old_container"
    docker rename "$old_container" "$backup_name"
    backup_created=1
  fi
  verified_image="$(docker inspect --format '{{.Image}}' "$new_container")"
else
  # In-place pad, alleen voor hosts zonder blue/green-upstream.
  cutover_started=1
  # Both legacy Compose and CI containers can exist after earlier failed updates.
  # Preserve each before releasing the shared host port; never kill an arbitrary PID.
  if [ -n "$secondary_name" ]; then
    docker stop "$secondary_name"
    docker rename "$secondary_name" "$secondary_backup"
    secondary_backup_created=1
  fi
  if [ -n "$previous_name" ]; then
    docker stop "$previous_name"
    docker rename "$previous_name" "$backup_name"
    backup_created=1
  fi
  candidate_attempted=1
  start_candidate 3002 epicnext-cms-app
  healthy 3002
  node scripts/verify-deployed-release.mjs http://127.0.0.1:3002/api/health "$sha"
  PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 pnpm test:e2e
  if [ "${DEPLOY_SKIP_CROSS_BROWSER:-0}" = "1" ]; then
    echo "WARNING: cross-browser imaging gate skipped (DEPLOY_SKIP_CROSS_BROWSER=1)" >&2
  else
    PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 pnpm test:imaging
  fi
  verified_image="$(docker inspect --format '{{.Image}}' epicnext-cms-app)"
fi
docker tag "$verified_image" "epicnext-cms:verified-$sha"
docker tag "$verified_image" epicnext-cms:latest
cutover_started=0
if [ "$backup_created" -eq 1 ]; then docker rm "$backup_name" || true; fi
if [ "$secondary_backup_created" -eq 1 ]; then docker rm "$secondary_backup" || true; fi


echo "Deployment verified: $sha"
# Een deploy kan de game client, furnidata (gamedata), camera en public API data
# verversen. Laat de Cloudflare edge-cache van die tags los (best-effort: alleen
# wanneer er een echte token + zone-id geconfigureerd is; no-op anders).
if [ -x "$deploy_dir/scripts/cf-purge.sh" ]; then
  bash "$deploy_dir/scripts/cf-purge.sh" cms-public cms-gamedata cms-client cms-camera || true
fi
# Retain the current and previous releases; do not remove arbitrary named tags.
while IFS= read -r tag; do
  if [[ "$tag" =~ ^epicnext-cms:(verified-)?[0-9a-f]{40}$ ]] && [ "$tag" != "$image" ] && [ "$tag" != "epicnext-cms:verified-$sha" ]; then
    tagged_image="$(docker image inspect --format '{{.Id}}' "$tag" 2>/dev/null || true)"
    if [ -n "$tagged_image" ] && [ "$tagged_image" != "$previous_image" ]; then docker image rm "$tag" || true; fi
  fi
done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' epicnext-cms)
# Reclaim build cache, unreferenced images and long-stopped containers. Never
# volumes; retention boundaries are enforced inside docker-prune.sh.
bash "$deploy_dir/scripts/docker-prune.sh" || true
