#!/usr/bin/env bash
# Script to send alerts via Webhook
# Usage: ./alert.sh "Your message"
WEBHOOK_URL="https://discord.com/api/webhooks/your_webhook_id/your_webhook_token" # Replace with actual URL

if [ -z "$1" ]; then
    echo "Usage: ./alert.sh 'Message'"
    exit 1
fi

curl -H "Content-Type: application/json" -d "{\"content\": \"$1\"}" $WEBHOOK_URL
