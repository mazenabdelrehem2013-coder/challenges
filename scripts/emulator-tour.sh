#!/usr/bin/env bash
# Installs the Android app on an emulator, walks through the main screens and saves screenshots.
# It joins as "Emulator test" and deletes that account again at the end.
set -u
OUT=tour; mkdir -p "$OUT"
APP=com.employeechallenges.app
n=0
shot() { n=$((n+1)); sleep "${2:-3}"; adb exec-out screencap -p > "$OUT/$(printf %02d $n)-$1.png"; echo "saved $1"; }
# Tap the first on-screen element whose text matches (python regex).
tap() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml ui.xml >/dev/null 2>&1
  xy=$(python3 - "$1" <<'PY'
import re, sys, xml.etree.ElementTree as ET
pat = re.compile(sys.argv[1])
for n in ET.parse('ui.xml').iter('node'):
    if pat.search(n.get('text','')) or pat.search(n.get('content-desc','')):
        a,b,c,d = map(int, re.findall(r'\d+', n.get('bounds')))
        print((a+c)//2, (b+d)//2); break
PY
)
  if [ -n "$xy" ]; then adb shell input tap $xy; echo "tapped $1"; else echo "not found: $1"; fi
}
adb install -r challenges.apk
# Let the emulator settle, and clear any "isn't responding" popup from its launcher.
sleep 30; tap '^Wait$'; adb shell input keyevent 3; sleep 5
adb shell screenrecord --time-limit 170 /sdcard/tour.mp4 & REC=$!
adb shell monkey -p $APP -c android.intent.category.LAUNCHER 1 >/dev/null
shot join 25
tap '^Wait$'
tap 'Your name'; sleep 2
for w in Emulator; do adb shell input text "$w"; sleep 1; done
adb shell input keyevent 62; sleep 1; adb shell input text test; sleep 1
adb shell input keyevent 4; sleep 2   # hide the keyboard
tap ' · '; shot join-filled 3
tap '^Join$'; shot home 12
tap '^Ranks$'; shot leaderboard 6
tap '^Challenge$'; shot new-challenge 6
tap '^Alerts$'; shot alerts 6
tap '^Profile$'; shot profile 6
tap '^Delete my account$'; shot delete-confirm 3
tap '^Delete my account$'; shot after-delete 10
kill $REC 2>/dev/null; sleep 3; adb pull /sdcard/tour.mp4 "$OUT/tour.mp4" || true
ls -la "$OUT"
