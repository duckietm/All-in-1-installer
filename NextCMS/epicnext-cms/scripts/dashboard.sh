#!/usr/bin/env bash
# Dashboard for quick script access
SCRIPT_DIR="$(dirname "$0")"

echo "=== EpicNext-Cms Dashboard ==="
echo "Select a script to run:"
echo "1) Deploy (./deploy.sh)"
echo "2) Logs (./scripts/logs.sh)"
echo "3) Backup (./scripts/backup.sh)"
echo "4) Prune (./scripts/docker-prune.sh)"
echo "5) Verify (./scripts/verify-deploy.sh)"
echo "6) Check Env (./scripts/check-env.sh)"
echo "7) Optimize DB (./scripts/db-optimize.sh)"
echo "8) Security Scan (./scripts/check-security.sh)"
echo "9) Monitor (./scripts/monitor.sh)"
echo "10) Perf Report (./scripts/perf-report.sh)"
echo "11) Setup Dev (./scripts/setup-dev.sh)"
echo "12) Check Updates (./scripts/check-updates.sh)"
echo "13) Restore DB (./scripts/db-restore.sh)"
echo "14) Maintenance Mode (./scripts/maintenance.sh)"
echo "15) Doctor (./scripts/doctor.sh)"
echo "16) Setup Cron (./scripts/setup-cron.sh)"
echo "17) Send Alert (./scripts/alert.sh)"
echo "q) Quit"

read -p "Choice: " choice

case $choice in
    1) ./deploy.sh ;;
    2) $SCRIPT_DIR/logs.sh ;;
    3) $SCRIPT_DIR/backup.sh ;;
    4) $SCRIPT_DIR/docker-prune.sh ;;
    5) $SCRIPT_DIR/verify-deploy.sh ;;
    6) $SCRIPT_DIR/check-env.sh ;;
    7) $SCRIPT_DIR/db-optimize.sh ;;
    8) $SCRIPT_DIR/check-security.sh ;;
    9) $SCRIPT_DIR/monitor.sh ;;
    10) $SCRIPT_DIR/perf-report.sh ;;
    11) $SCRIPT_DIR/setup-dev.sh ;;
    12) $SCRIPT_DIR/check-updates.sh ;;
    13) $SCRIPT_DIR/db-restore.sh ;;
    14) $SCRIPT_DIR/maintenance.sh ;;
    15) $SCRIPT_DIR/doctor.sh ;;
    16) $SCRIPT_DIR/setup-cron.sh ;;
    17) $SCRIPT_DIR/alert.sh ;;
    q) exit 0 ;;
    *) echo "Invalid choice" ;;
esac
