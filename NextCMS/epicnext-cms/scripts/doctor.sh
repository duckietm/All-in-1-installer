#!/usr/bin/env bash
# System diagnostic tool
echo "=== Doctor Report ==="
echo "Checking Docker..."
docker ps > /dev/null || echo "Error: Docker not running."

echo "Checking port 3002..."
if lsof -i :3002 > /dev/null; then echo "Port 3002 is in use."; else echo "Port 3002 is free."; fi

echo "Checking .env..."
if [ -f .env ]; then echo ".env exists."; else echo "Error: .env missing."; fi

echo "Checking health..."
if curl -s http://localhost:3002/cms_api/health > /dev/null; then echo "Health endpoint OK."; else echo "Health endpoint failing."; fi

echo "Disk usage:"
df -h / | tail -n 1
