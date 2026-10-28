#!/usr/bin/env bash
# Security scan: check dependencies and Docker images
cd "$(dirname "$0")/.."
echo "--- Running security scan ---"
echo "Checking npm dependencies..."
pnpm audit --audit-level=high

echo "Checking outdated images (if any)..."
docker compose pull --dry-run
