#!/usr/bin/env bash
# Parses ui/app.js/config.js/config.local.js as strict ES2022 (npx acorn --ecma2022) and
# exits non-zero if any of them fail -- see README's "Deploying for real" section for why.
# ES2022, not a blanket "latest": that's this frame's WebView's actual syntax ceiling
# (Chrome 106, confirmed working -- see docs/pf1007l-webview-106.md), so newer syntax
# (e.g. ES2023's array-copying methods, which are new built-ins, not new syntax, so this
# check can't catch them anyway) still needs to be avoided by hand. This only catches
# parse-time syntax errors -- the failure mode that's historically silently killed the
# entire script on this WebView (first an accidental async/await, later a Prettier-added
# trailing comma), not "uses an API this engine doesn't have".
# Shared by deploy.sh and dev-deploy.sh rather than duplicated, so there's one check to
# keep in sync, not two.
set -euo pipefail
cd "$(dirname "$0")"

acorn_err=$(mktemp)
for f in ui/app.js ui/config.js ui/config.local.js; do
  [ -f "$f" ] || continue
  if ! npx --yes acorn --ecma2022 "$f" > /dev/null 2>"$acorn_err"; then
    echo "$f fails to parse as ES2022 -- this WebView can't run it." >&2
    cat "$acorn_err" >&2
    rm -f "$acorn_err"
    exit 1
  fi
done
rm -f "$acorn_err"
