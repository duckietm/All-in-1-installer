# Sourced only by the deployment simulation tests; no external services are used.
git() {
  if [ "$1" = rev-parse ]; then printf '%s\n' "$TEST_SHA"; return; fi
  # `git status --porcelain` is the script's clean-tree guard: empty stdout
  # means clean, any output aborts the release before it builds an image. It
  # needs its own stub — falling through to the ls-remote-shaped printf below
  # would always report a dirty tree and fail every scenario.
  if [ "$1" = status ]; then
    [ "$SCENARIO" = dirty-tree ] && printf ' M src/leaked-file.ts\n'
    return 0
  fi
  local n=0
  if [ -f "$TEST_DIR/remote-count" ]; then read -r n < "$TEST_DIR/remote-count"; fi
  n=$((n+1)); printf '%s\n' "$n" > "$TEST_DIR/remote-count"
  if [ "$SCENARIO" = remote-failure ]; then return 1; fi
  if [ "$SCENARIO" = stale ] || { [ "$SCENARIO" = superseded ] && [ "$n" -gt 1 ]; }; then
    printf '%s\trefs/heads/main\n' bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  else printf '%s\trefs/heads/main\n' "$TEST_SHA"; fi
}
flock() { echo "lock" >> "$TEST_DIR/calls"; [ "$SCENARIO" != lock-failure ]; }
pnpm() {
  # De env-prefix (bv. PLAYWRIGHT_BASE_URL) hoort bij het deploypad dat getest
  # wordt, dus die loggen we mee: zo blijft zichtbaar dat de e2e-test tegen de
  # juiste poort draait.
  echo "${PLAYWRIGHT_BASE_URL:+PLAYWRIGHT_BASE_URL=$PLAYWRIGHT_BASE_URL }pnpm $*" >> "$TEST_DIR/calls"
  if [ "$1" = db:migrate ] && [ "$SCENARIO" = migration-failure ]; then return 1; fi
  if [ "$1" = test:e2e ] && [ "$SCENARIO" = smoke-failure ] && candidate_is_new; then return 1; fi
  return 0
}
# De kandidaat is het container dat het script zojuist heeft gestart. Bij
# blue/green is dat niet per se `epicnext-cms-app`.
candidate_is_new() {
  for f in epicnext-cms-app epicnext-cms-green; do
    if [ "$(cat "$TEST_DIR/$f" 2>/dev/null)" = new ]; then return 0; fi
  done
  return 1
}
nginx() {
  echo "nginx $*" >> "$TEST_DIR/calls"
  if [ "$SCENARIO" = nginx-reject ] && [ "$1" = "-t" ]; then return 1; fi
  if [ "$SCENARIO" = nginx-reload-fail ] && [ "$1" = "-s" ]; then return 1; fi
  return 0
}
curl() {
  if [ "$SCENARIO" = health-failure ] && candidate_is_new; then return 1; fi
  echo '{"database":true}'
}
# Een compose-replica uit precies deze checkout (`docker compose up`, of de
# dagelijkse docker-update.sh) kan een blauwe/groene slot bezetten en de release
# blokkeren. De scenario's hieronder leveren zo'n replica op:
#   port-taken-compose  draait op 3002, terwijl live op 3003 draait → mag weg;
#   compose-live        draait op 3003, de poort waar nginx naar wijst → blijft.
compose_replica_port() {
  case "$SCENARIO" in
    port-taken-compose) printf '3002\n' ;;
    compose-live) printf '3003\n' ;;
  esac
}
sleep() { :; }
# De poortconflict-check (assert_port_free in scripts/ci-deploy.sh) leest de
# echte luisterende sockets. Zonder deze stub zou de simulatie de containers van
# de productiehost zien — de test draait immers op dezelfde machine — en elke
# blauwe/groene scenario laten falen op een poort die de simulatie zelf net
# virtueel heeft toegewezen. Standaard is geen enkele poort bezet; het scenario
# 'port-taken' reserveert expliciet de kandidaatpoort.
ss() {
  local requested="" arg replica_port
  for arg in "$@"; do
    case "$arg" in
      sport=*) requested="${arg#sport=}" ;;
      'sport'|'='|':') ;;
      *:*) [ -z "$requested" ] && requested="${arg##*:}" ;;
    esac
  done
  if [ "$SCENARIO" = port-taken ] && [ -n "$requested" ]; then
    printf 'State  Recv-Q Send-Q Local Address:Port Peer Address:Port\n'
    printf 'LISTEN 0      511          0.0.0.0:%s          0.0.0.0:*\n' "$requested"
    return 0
  fi
  # De replica houdt zijn poort bezet zolang hij bestaat: zo ziet de simulatie
  # dat de kandidaat op 3002 pas kan starten nadat retire_compose_replicas() hem
  # heeft verwijderd.
  replica_port="$(compose_replica_port)"
  if [ -n "$replica_port" ] && [ "$requested" = "$replica_port" ] && [ -f "$TEST_DIR/epicnext-cms" ]; then
    printf 'State  Recv-Q Send-Q Local Address:Port Peer Address:Port\n'
    printf 'LISTEN 0      511          0.0.0.0:%s          0.0.0.0:*\n' "$replica_port"
    return 0
  fi
  printf 'State  Recv-Q Send-Q Local Address:Port Peer Address:Port\n'
}
docker() {
  echo "docker $*" >> "$TEST_DIR/calls"
  local name="${@: -1}"
  case "$1" in
    ps)
      [ -z "$(compose_replica_port)" ] || echo compose123 ;;
    inspect)
      # De replica wordt in de simulatie bij zijn container-id opgezocht, net als
      # in het echte script.
      if [ "$name" = compose123 ]; then
        case "${3:-}" in
          '{{.Name}}') echo /epicnext-cms ;;
          '{{.Image}}') echo sha256:compose ;;
          '{{index .Config.Labels "com.docker.compose.project.config_files"}}') echo "$TEST_DIR/production/docker-compose.yml" ;;
          '{{range .Config.Env}}{{println .}}{{end}}') printf 'PORT=%s\nHOSTNAME=0.0.0.0\n' "$(compose_replica_port)" ;;
        esac
        return 0
      fi
      [ -f "$TEST_DIR/$name" ] || return 1
      if [ "${3:-}" = '{{.State.Running}}' ]; then echo true
      elif [ "${3:-}" = '{{.Image}}' ]; then echo "sha256:$(cat "$TEST_DIR/$name")"
      fi ;;
    image)
      if [ "$2" = ls ]; then
        printf '%s\n' "epicnext-cms:verified-$TEST_SHA" "epicnext-cms:verified-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" "epicnext-cms:verified-cccccccccccccccccccccccccccccccccccccccc"
      elif [ "$2" = inspect ]; then
        case "$name" in *bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) echo sha256:old ;; *) echo sha256:unused ;; esac
      fi ;;
    build) [ "$SCENARIO" != build-failure ] ;;
    stop) return 0 ;;
    rename) mv "$TEST_DIR/$2" "$TEST_DIR/$3" ;;
    run)
      run_name=epicnext-cms-app
      prev=""
      for arg in "$@"; do
        if [ "$prev" = "--name" ]; then run_name="$arg"; fi
        prev="$arg"
      done
      echo new > "$TEST_DIR/$run_name"
      [ "$SCENARIO" != run-failure ] ;;
    start) [ -f "$TEST_DIR/$2" ] ;;
    rm) rm -f "$TEST_DIR/$name" ;;
    *) return 0 ;;
  esac
}
export -f git flock pnpm curl sleep ss docker nginx candidate_is_new compose_replica_port

node() {
  echo "node $*" >> "$TEST_DIR/calls"
  case "$SCENARIO" in
    release-failure) [[ "$*" != *verify-deployed-release.mjs* ]] || return 1 ;;
    news-e2e-failure) [[ "$*" != *e2e/news-real/run.ts* ]] || return 1 ;;

  esac
  return 0
}
export -f node
