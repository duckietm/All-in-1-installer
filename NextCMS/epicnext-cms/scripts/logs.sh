#!/usr/bin/env bash
# View logs for cms and mariadb services
cd "$(dirname "$0")/.."
docker compose logs -f epicnext-cms mariadb-turbo
