#!/usr/bin/env bash
# Verify if CMS is reachable
cd "$(dirname "$0")/.."
echo "Checking health..."
if curl -f http://localhost:3002/api/health > /dev/null 2>&1; then
   echo "Success: Service is reachable."
else
   echo "Error: Service not reachable."
   exit 1
fi
