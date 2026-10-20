#!/usr/bin/env bash
# Parses ui/app.js/config.js/config.local.js as strict ES5 (npx acorn --ecma5) and exits
# non-zero if any of them fail -- see README's "Deploying for real" section for why.
# Shared by deploy.sh and dev-deploy.sh rather than duplicated, so there's one check to
# keep in sync, not two.
set -euo pipefail
cd "$(dirname "$0")"

acorn_err=$(mktemp)
for f in ui/app.js ui/config.js ui/config.local.js; do
  [ -f "$f" ] || continue
  if ! npx --yes acorn --ecma5 "$f" > /dev/null 2>"$acorn_err"; then
    echo "$f fails to parse as ES5 -- this WebView can't run it." >&2
    cat "$acorn_err" >&2
    rm -f "$acorn_err"
    exit 1
  fi
done
rm -f "$acorn_err"
