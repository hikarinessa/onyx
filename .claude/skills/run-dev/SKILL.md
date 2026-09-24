---
description: Use when Onyx needs to be seen or measured running — checking a UI change in the dev app, reproducing a bug on a real note, taking a screenshot of the editor, or running a temporary instrument (scroll recorder, timing log) in the app. Onyx's launch recipe for the generic /run.
user-invocable: true
---

# Run the Onyx dev app on chosen notes

The dev build (`cargo tauri dev`) reads and writes `~/.onyx-dev/`, never the installed app's `~/.onyx/`. It shows the user's real notes (the registered folders), so treat every note as read-only unless the task is to edit it.

Scripts live in `.claude/skills/run-dev/` of the Onyx repo. Run everything from the repo root.

## 1. Choose what opens

Back up the dev session and saved cursor positions once, then set the notes:

```bash
python3 .claude/skills/run-dev/onyx-dev-session.py backup
python3 .claude/skills/run-dev/onyx-dev-session.py open "<abs path>" preview [--line 120]
```

- Mode is `source`, `preview` or `review`. Plain text files (`.txt/.json/.yaml`) always open in Source.
- `--line N` saves the cursor at line N so the note opens scrolled there. In Preview the cursor's line shows raw syntax, so put it a few lines *above* what should render.
- Open one note at a time. Session restore only fills the first pane reliably (#121).

## 2. Launch and wait

Kill any running dev app first (step 4). Then start it as a tracked background task — never with a bare `&` — logging to the scratchpad, and wait for indexing:

```bash
cargo tauri dev > <scratchpad>/dev.log 2>&1        # run_in_background: true
```

Wait with a Monitor/until-loop on `Reconciliation complete|panicked|error\[` in that log, then ~8 s more for the window to paint. Only `console.error` from the page reaches the log (as `[JS] console.error: …`), so temporary instruments log with a unique prefix through `invoke("log_js_error", { message })`. Plain `console.error` also reaches the log, but forwarding stops after 50 reports per page load (the log then says `report cap reached`), and a dev session's own errors can use up most of that.

Rust changes rebuild and relaunch the app on save: stop it before editing `src-tauri/`. Changes to editor extensions need a full restart (`sharedExtensions` is cached; HMR won't rebuild it).

## 3. Capture only the window

```bash
bash .claude/skills/run-dev/capture-onyx.sh <scratchpad>/shot.png
```

It finds the dev app's window from its PID and captures that window alone, even behind other windows. Never use a full-screen capture: it takes whatever else the user has open. Crop with Python PIL before reading the image when a detail matters.

## 4. Stop and restore

```bash
ps -axo pid,ppid,command > <scratchpad>/ps.txt
/usr/bin/grep -E "cargo-tauri tauri dev|target/debug/onyx$|Onyx/node_modules/.bin/vite$" <scratchpad>/ps.txt | /usr/bin/grep -v "zsh -c"
kill <those pids>        # then re-list with the same pattern: only the zsh line may remain
python3 .claude/skills/run-dev/onyx-dev-session.py restore
```

Remove every temporary instrument (search for its log prefix) before committing.

## When the user tests by hand

Automated checks (programmatic scrolling, synthetic events) can miss what a trackpad does. When a bug only shows under real input, add a recorder that logs the moments that matter, relaunch, ask the user to reproduce it, then read the log: their hands, your measurements.
