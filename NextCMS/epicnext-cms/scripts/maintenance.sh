#!/usr/bin/env bash
# Toggle maintenance mode
FILE=".maintenance"
if [ -f "$FILE" ]; then
    rm "$FILE"
    echo "Maintenance mode disabled."
else
    touch "$FILE"
    echo "Maintenance mode enabled."
fi
