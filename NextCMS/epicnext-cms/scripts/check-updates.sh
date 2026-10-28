#!/usr/bin/env bash
# Check for dependency and image updates
cd "$(dirname "$0")/.."
echo "Checking for package updates..."
pnpm outdated

echo "Checking for newer Docker images..."
docker compose pull --dry-run
