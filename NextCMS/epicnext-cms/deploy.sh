#!/usr/bin/env bash
# Handmatige release uitvoeren.
#
# Dit script is bewust een dunne wrapper. Het echte werk zit in
# `scripts/ci-deploy.sh`, want dat is wat Gitea Actions ook draait. Eén deploypad
# betekent dat een handmatige release niet anders kan werken dan een release uit
# CI, dus er is geen tweede, slechter onderhouden pad meer.
#
# Waarom dit niet meer zelf doet wat het deed:
#   - `fuser -k 3002/tcp` sloopte de live release bij elke mislukte build;
#   - `docker compose down` haalde de site omlaag vóórdat er iets nieuws stond;
#   - de container draait via `docker run` uit ci-deploy.sh, niet via compose, dus
#     compose beheerde hier nooit de release die er echt draaide.
#
# `scripts/ci-deploy.sh` start nu blue/green: de nieuwe release komt op de vrije
# poort terwijl de live release door blijft draaien, en nginx gaat pas om nadat
# de kandidaat gezond is en de e2e-test heeft gewonnen.
set -Eeuo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$deploy_dir"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
	sed -n '2,20p' "$deploy_dir/deploy.sh" | sed 's/^# \{0,1\}//'
	exit 0
fi

# De branch-guard in ci-deploy.sh accepteert alleen main/master, en controleert
# daarna of de HEAD-commit nog de nieuwste op de remote is. Deployen vanuit een
# feature-branch kan dus niet per ongeluk; dat was eerder wél mogelijk.
exec bash "$deploy_dir/scripts/ci-deploy.sh" "$@"
