#!/usr/bin/env bash
# Monitor system health
cd "$(dirname "$0")/.."

echo "=== System Monitoring ==="
echo "Disk Usage:"
df -h / | tail -n 1
echo ""
echo "Docker Resources:"
docker stats --no-stream
echo ""
echo "Container Status:"
docker compose ps
