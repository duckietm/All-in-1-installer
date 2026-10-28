#!/usr/bin/env bash
# Setup cron jobs for maintenance
#
# Appends to the existing crontab. `crontab -` replaces the whole file, so a
# script that pipes one job at a time silently drops every other scheduled job.
# Entries are matched by their command, so re-running this is idempotent.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Adds one schedule line to the crontab unless its command is already present.
add_job() {
	local schedule="$1" command
	command="${schedule##* }"
	local current
	current="$(crontab -l 2>/dev/null || true)"
	if grep -Fq "$command" <<<"$current"; then
		echo "Already scheduled: $command"
		return
	fi
	if [[ -z "$current" ]]; then
		printf '%s\n' "$schedule" | crontab -
	else
		printf '%s\n%s\n' "$current" "$schedule" | crontab -
	fi
	echo "Scheduled: $schedule"
}

# Run backup every day at 03:00
add_job "0 3 * * * $SCRIPT_DIR/backup.sh"
# Run prune every day at 04:00. Daily rather than weekly: byparr leaks roughly
# 1.7 GB/day of orphaned browser profiles into its writable layer, so a weekly
# run would let ~12 GB accumulate before anything reclaimed it.
add_job "0 4 * * * $SCRIPT_DIR/docker-prune.sh"

echo "Cron jobs configured."
