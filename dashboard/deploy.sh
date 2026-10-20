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
COPYFILE_DISABLE=1 tar czf - --exclude='.git' --exclude='.deploy.env' -C .. dashboard \
  | ssh "$HOST" "tar xzf - -C $REMOTE_APPS_DIR"
# Code is bind-mounted, not baked into the image (see docker-compose.yml) -- the image
# never changes on a code-only edit, so plain "up -d --build" sees nothing to recreate
# and leaves the already-running Node process serving stale in-memory code. Restarting
# unconditionally is what actually picks up the change.
ssh "$HOST" "cd $REMOTE_APPS_DIR/dashboard && docker compose up -d --build && docker compose restart"

# entrypoint.sh's background loop already fetches all of these on container start, before
# its first 15-minute sleep -- but that races the container, which is already up and
# serving whatever calendar.ics/weather.json/fact.json/route.json happened to be on disk
# (stale, or missing on a first-ever deploy) while the fetch is still in flight. Running
# them again here, synchronously, means "deployed" actually means "fresh data", not "fresh
# data in a few seconds, probably". `|| true` per script, same as entrypoint.sh's own
# loop -- one fetch failing (a transient network blip) shouldn't fail the whole deploy;
# the background loop retries it in 15 minutes regardless.
ssh "$HOST" "cd $REMOTE_APPS_DIR/dashboard && docker compose exec -T dashboard sh -c '
  ./server/fetch-calendar.sh || true
  ./server/fetch-weather.sh || true
  ./server/fetch-fact.sh || true
  ./server/fetch-route.sh || true
'"

echo "Deployed -- check the frame."
