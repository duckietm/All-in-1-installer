# Test-only command boundaries; the real preflight shell and filesystem cleanup run.
git() {
  echo "git $*" >> "$TEST_DIR/calls"
  [ "$*" = "rev-parse HEAD" ] || return 91
  if [ "$SCENARIO" = invalid-sha ]; then echo invalid; else echo "$TEST_SHA"; fi
}
pnpm() {
  echo "pnpm $*" >> "$TEST_DIR/calls"
  [ "$SCENARIO" != install-failure ]
}
docker() {
  echo "docker $*" >> "$TEST_DIR/calls"
  case "$1 $2" in
    'build --progress=plain') [ "$SCENARIO" != build-failure ] ;;
    'image rm') [ "$SCENARIO" != cleanup-failure ] ;;
    *) return 92 ;;
  esac
}
node() {
  echo "news-image=$NEWS_E2E_IMAGE news-release=$NEWS_E2E_RELEASE node $*" >> "$TEST_DIR/calls"
  [ "$*" = "--import tsx e2e/news-real/run.ts" ] || return 93
  [ "$SCENARIO" != news-failure ]
}
cp() { echo "UNEXPECTED cp $*" >> "$TEST_DIR/calls"; return 94; }
curl() { echo "UNEXPECTED curl $*" >> "$TEST_DIR/calls"; return 95; }
cat() { echo "UNEXPECTED cat $*" >> "$TEST_DIR/calls"; return 96; }
export -f git pnpm docker node cp curl cat
