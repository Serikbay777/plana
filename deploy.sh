#!/usr/bin/env bash
set -e

echo "==> Pulling latest changes..."
git pull origin master

echo "==> Building and restarting containers..."
docker compose up --build -d

echo "==> Cleaning up dangling images..."
docker image prune -f

echo "==> Status:"
docker compose ps
