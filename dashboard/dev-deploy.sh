#!/usr/bin/env bash
# Wraps the dev loop into one command: start the no-cache dev server if it isn't already
# running, tunnel it over USB, and reload the kiosk. Safe to re-run after every edit --
# re-running adb reverse is a no-op if it's already set up, and this won't start a second
# dev-server.py if one's already serving.
set -euo pipefail
cd "$(dirname "$0")"

if ! pgrep -f "dev-server.py" > /dev/null; then
  python3 dev-server.py > /dev/null 2>&1 &
  disown
  sleep 1
fi

adb -d reverse tcp:8765 tcp:8765
adb -d shell am start -n com.wesbos.homehq/.MainActivity --es url http://localhost:8765/

echo "Deployed -- check the frame."
