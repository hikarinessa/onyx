#!/bin/bash
# Capture only the Onyx dev app's main window (found from its PID), even when other
# windows cover it. Never captures the whole screen.
# Usage: capture-onyx.sh <out.png>
set -u
out=${1:?usage: capture-onyx.sh <out.png>}
pid=$(pgrep -f "target/debug/onyx$" | head -1)
[ -n "$pid" ] || { echo "dev app not running" >&2; exit 1; }
swift_src=$(mktemp -t onyxwin).swift
cat > "$swift_src" <<'EOF'
import CoreGraphics
let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in list where (w[kCGWindowOwnerPID as String] as? Int) == pid
    && (w[kCGWindowLayer as String] as? Int) == 0
    && (w[kCGWindowName as String] as? String) == "Onyx" {
  print(w[kCGWindowNumber as String]!)
  break
}
EOF
win=$(swift "$swift_src" "$pid" 2>/dev/null)
rm -f "$swift_src"
[ -n "$win" ] || { echo "no Onyx window for pid $pid" >&2; exit 1; }
screencapture -x -o -l "$win" "$out" || exit 1
echo "$out (window $win, pid $pid)"
