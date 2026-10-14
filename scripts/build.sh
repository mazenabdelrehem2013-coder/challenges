#!/usr/bin/env bash
# Builds the website Firebase Hosting serves (public/):
#   /        the phone app's web version (employees can use it in a browser too)
#   /admin   the manager and HR dashboard
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$ROOT/public"
(cd "$ROOT/mobile" && CI=1 npx expo export --platform web --output-dir "$ROOT/public")
(cd "$ROOT/dashboard" && npx vite build --outDir "$ROOT/public/admin" --emptyOutDir)
cp -r "$ROOT/site/." "$ROOT/public/"
echo "Built into public/"
