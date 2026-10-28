#!/usr/bin/env bash
# Run performance report
cd "$(dirname "$0")/.."
echo "Running performance report..."
node scripts/performance-report.mjs
