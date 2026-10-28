# Test doubles; never calls real Docker, Git remotes or databases.
git() {
  echo "git $*" >> "$TEST_DIR/calls"
  case "$1" in
    status) if [ "$SCENARIO" = dirty ]; then echo ' M local.ts'; fi ;;
    hash-object) echo unchanged ;;
    rev-parse) if [ "${2:-}" = HEAD ]; then echo "$TEST_SHA"; else echo origin/main; fi ;;
    pull) [ "$SCENARIO" != pull-failure ] ;;
  esac
}
flock() { :; }
sleep() { :; }
docker() {
 echo "docker $*" >> "$TEST_DIR/calls"
 if [ "$1" = pull ] && [ "$SCENARIO" = registry-failure ]; then return 1; fi
 case "$1 ${2:-}" in
  'inspect --format')
   if [ "${@: -1}" = epicnext-cms-app ]; then [ "$SCENARIO" = ci-active ] && echo true; return 0; fi
   if [ "${@: -1}" = epicnext-cms-green ]; then [ "$SCENARIO" = ci-green ] && echo true; return 0; fi
   if [ "${@: -1}" = previous123 ] || [ -f "$TEST_DIR/restored" ]; then echo sha256:old; return 0; fi
   if [ "$SCENARIO" = wrong-image ]; then echo sha256:old; else echo sha256:new; fi ;;
  'image inspect')
   if [[ "$SCENARIO" = migration-revision-mismatch && "$*" = *epicnext-cms-migrations* ]]; then echo unknown; return 0; fi
   if [[ "$SCENARIO" = migration-revision-missing && "$*" = *epicnext-cms-migrations* ]]; then echo '<no value>'; return 0; fi
   if [[ "$*" = *org.opencontainers* ]] && [[ "$*" = *sha256:old* ]]; then printf 'b%.0s' {1..40}; echo; return 0; fi
   if [[ "$*" = *org.opencontainers* ]]; then echo "$TEST_SHA"; else echo sha256:new; fi ;;
  'compose run') [ "$SCENARIO" != storage-failure ] ;;
  'compose config') return 0 ;;
  'compose build') [ "$SCENARIO" != build-failure ] ;;
  'compose up')
   if [[ "$CMS_RELEASE" = rollback-* ]]; then
     [ "$SCENARIO" != rollback-failure ] || return 1
     touch "$TEST_DIR/restored"; return 0
   fi
   touch "$TEST_DIR/cutover"
   [ "$SCENARIO" != recreate-failure ] ;;
  'compose ps')
   if [ -f "$TEST_DIR/cutover" ]; then echo container123
   elif [ "$SCENARIO" != first-failure ]; then echo previous123; fi ;;
  'run --rm') [ "$SCENARIO" != migration-failure ] ;;
  'ps -aq') if [ "$SCENARIO" = retained-in-use ]; then echo other-container; fi ;;
  'exec container123')
   if [ -f "$TEST_DIR/restored" ]; then return 0; fi
   if [ "$SCENARIO" = first-failure ] || [ "$SCENARIO" = rollback-failure ]; then return 1; fi
   if [ "$SCENARIO" = wrong-release ]; then return 1; fi
   if [ "$SCENARIO" = wrong-public ] && [[ "$*" = *example.test* ]]; then return 1; fi ;;
  *) return 0 ;;
 esac
}
export -f git flock sleep docker
