#!/usr/bin/env bash
# Builds the clickable demo site (phone app + dashboard + in-browser back end) into $1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?usage: build-site.sh <output-dir>}"
TMP="$(mktemp -d)"
mkdir -p "$OUT"
rm -rf "$OUT/phone" "$OUT/dashboard" "$OUT/demo-api.js"
mkdir -p "$OUT/phone/assets" "$OUT/dashboard"

node "$ROOT/demo/build.mjs" "$OUT/demo-api.js"

(cd "$ROOT/dashboard" && npx vite build --base ./ --outDir "$TMP/dash" --emptyOutDir >/dev/null)
cp -r "$TMP/dash/assets" "$OUT/dashboard/"
python3 - "$TMP/dash/index.html" "$OUT/dashboard/index.html" "$ROOT/demo/dashboard-shim.html" <<'PY'
import sys
html = open(sys.argv[1]).read()
shim = open(sys.argv[3]).read()
open(sys.argv[2], 'w').write(html.replace('<script type="module"', shim + '<script type="module"', 1))
PY

(cd "$ROOT/mobile" && EXPO_PUBLIC_API_URL=http://demo.local CI=1 npx expo export --clear --platform web --output-dir "$TMP/phone" >/dev/null)
sed -e 's#uri:"/assets/node_modules/expo-router/#uri:window.__PHONE_BASE+"assets/router/#g' \
    -e 's#"/assets/node_modules/@expo-google-fonts/#window.__PHONE_BASE+"assets/fonts/#g' \
    "$TMP"/phone/_expo/static/js/web/entry-*.js > "$OUT/phone/app.js"
cp -r "$TMP/phone/assets/node_modules/@expo-google-fonts" "$OUT/phone/assets/fonts"
cp -r "$TMP/phone/assets/node_modules/expo-router" "$OUT/phone/assets/router"
cp "$ROOT/demo/phone.html" "$OUT/phone/index.html"
if grep -q '"/assets/' "$OUT/phone/app.js"; then echo "warning: unrewritten asset paths in phone/app.js" >&2; fi
cp "$ROOT/demo/index.html" "$OUT/index.html"
rm -rf "$TMP"
echo "Built $OUT"
