#!/usr/bin/env bash
# Check if .env has all keys from .env.example
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then echo ".env missing"; exit 1; fi
if [ ! -f .env.example ]; then echo ".env.example missing, cannot compare."; exit 0; fi

# Extract keys and compare
env_keys=$(cut -d'=' -f1 .env | sort)
ex_keys=$(cut -d'=' -f1 .env.example | sort)

missing=$(comm -23 <(echo "$ex_keys") <(echo "$env_keys"))
if [ -n "$missing" ]; then
    echo "Missing env keys:"
    echo "$missing"
    exit 1
fi
echo "All env keys present."
