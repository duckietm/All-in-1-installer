#!/usr/bin/env bash
set -euo pipefail

URL="${BYPARR_URL:-${FLARESOLVERR_URL:-http://localhost:8191}}"
MAX_RETRIES="${BYPARR_MAX_RETRIES:-30}"
RETRY_INTERVAL="${BYPARR_RETRY_INTERVAL:-2}"

echo "Waiting for Byparr at ${URL}..."

for i in $(seq 1 "$MAX_RETRIES"); do
	if curl -sf "${URL}/health" >/dev/null 2>&1; then
		echo "Byparr is healthy."
		exit 0
	fi
	echo "Attempt ${i}/${MAX_RETRIES} - Byparr not ready, retrying in ${RETRY_INTERVAL}s..."
	sleep "$RETRY_INTERVAL"
done

echo "ERROR: Byparr did not become healthy after ${MAX_RETRIES} attempts."
exit 1