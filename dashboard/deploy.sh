#!/usr/bin/env bash
# Pushes this directory to the real server and restarts the container there. See
# README.md's "Deploying for real" section for the one-time setup (config.local.js,
# calendar-url.txt, ha.local.json created directly on the server, docker compose up once).
#
# tar over ssh, not rsync -- the server doesn't have rsync installed.
set -euo pipefail
cd "$(dirname "$0")"

# Real value (e.g. "user@your-server") goes in .deploy.env, gitignored same as
# config.local.js/ha.local.json -- keeps the actual host/username out of the repo.
HOST="user@your-server"
[ -f .deploy.env ] && source .deploy.env
if [ "$HOST" = "user@your-server" ]; then
  echo "Set HOST in .deploy.env first, e.g.: echo 'HOST=user@your-server' > .deploy.env" >&2
  exit 1
fi

REMOTE_APPS_DIR="~/apps"

ssh "$HOST" "mkdir -p $REMOTE_APPS_DIR"
COPYFILE_DISABLE=1 tar czf - --exclude='.git' --exclude='*.local.js' --exclude='*.local.json' -C .. dashboard \
  | ssh "$HOST" "tar xzf - -C $REMOTE_APPS_DIR"
# Code is bind-mounted, not baked into the image (see docker-compose.yml) -- the image
# never changes on a code-only edit, so plain "up -d --build" sees nothing to recreate
# and leaves the already-running Python process serving stale in-memory code. Restarting
# unconditionally is what actually picks up the change.
ssh "$HOST" "cd $REMOTE_APPS_DIR/dashboard && docker compose up -d --build && docker compose restart"

echo "Deployed -- check the frame."
