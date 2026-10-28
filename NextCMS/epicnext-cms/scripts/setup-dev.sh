#!/usr/bin/env bash
# Setup development environment
cd "$(dirname "$0")/.."
echo "Setting up development environment..."

if [ ! -f .env ] && [ -f .env.example ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "Please configure your .env file."
fi

echo "Installing dependencies..."
pnpm install

echo "Setup complete."
