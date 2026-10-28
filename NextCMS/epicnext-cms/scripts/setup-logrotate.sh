#!/usr/bin/env bash
# Setup log rotation
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/logrotate.conf"

echo "To apply log rotation, run:"
echo "sudo cp $CONFIG_FILE /etc/logrotate.d/epicnext-cms"
