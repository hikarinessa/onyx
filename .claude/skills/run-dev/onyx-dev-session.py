#!/usr/bin/env python3
"""Set which notes the Onyx dev app opens, and put the dev session back afterwards.

  backup                      copy session.json and cursor-positions.json aside (once per run)
  open PATH MODE [--line N]   open PATH alone in MODE (source|preview|review); with --line,
                              save the cursor at line N so the note opens scrolled there
  restore                     put the backed-up files back

Only touches ~/.onyx-dev (the dev build's data), never ~/.onyx.
"""
import json
import shutil
import sys
import time
from pathlib import Path

DEV = Path.home() / ".onyx-dev"
FILES = ["session.json", "cursor-positions.json"]
BACKUP = DEV / ".run-dev-backup"


def backup():
    BACKUP.mkdir(exist_ok=True)
    for name in FILES:
        if (DEV / name).exists():
            shutil.copy2(DEV / name, BACKUP / name)
    print(f"backed up to {BACKUP}")


def restore():
    if not BACKUP.exists():
        sys.exit("no backup to restore")
    for name in FILES:
        if (BACKUP / name).exists():
            shutil.copy2(BACKUP / name, DEV / name)
    shutil.rmtree(BACKUP)
    print("restored")


def open_note(path, mode, line):
    note = Path(path)
    if not note.is_file():
        sys.exit(f"no such file: {path}")
    session_path = DEV / "session.json"
    session = json.loads(session_path.read_text())
    tab = {"path": str(note), "name": note.name, "editorMode": mode}
    session["panes"] = [{"tabs": [tab], "activeTabPath": str(note)}]
    session["activePaneIndex"] = 0
    session["splitRatios"] = []
    session_path.write_text(json.dumps(session))
    if line:
        lines = note.read_text().split("\n")
        offset = sum(len(l) + 1 for l in lines[: max(0, line - 1)])
        cursor_path = DEV / "cursor-positions.json"
        cursors = json.loads(cursor_path.read_text()) if cursor_path.exists() else {}
        cursors[str(note)] = {"head": offset, "anchor": offset, "scrollTop": 0, "ts": int(time.time() * 1000)}
        cursor_path.write_text(json.dumps(cursors))
    print(f"opens {note.name} in {mode}" + (f" at line {line}" if line else ""))


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["backup"]:
        backup()
    elif args[:1] == ["restore"]:
        restore()
    elif args[:1] == ["open"] and len(args) >= 3:
        line = int(args[args.index("--line") + 1]) if "--line" in args else None
        open_note(args[1], args[2], line)
    else:
        sys.exit(__doc__)
