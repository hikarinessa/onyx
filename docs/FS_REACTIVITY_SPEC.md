# File System Reactivity — Design Spec

**Issue:** #10 (consolidated)
**Status:** Phase A+B implemented
**Scope:** Ensure every UI surface stays in sync with disk — whether changes come from inside Onyx or externally.

---

## 1. Problem Statement

The app has six distinct symptoms (see #10) that share a root cause: **there is no unified reactivity contract between disk state and UI state.** The watcher emits events, but consumers are fragmented — some listen, some don't, and internal mutations bypass the event path entirely.

### Current event flow

```
                 ┌─────────────┐
  External ───►  │  watcher.rs │──► fs:change event ──► Sidebar (debounced 1s)
  changes        │  (notify)   │                        App.tsx (cache invalidate)
                 └──────┬──────┘
                        │ 3s debounce
                        ▼
                 ┌─────────────┐
                 │ indexer.rs  │──► DB updated (links/tags/files)
                 └─────────────┘

                 ┌─────────────┐
  Internal ───►  │  fileOps.ts │──► bumpFileTreeVersion() ──► Sidebar
  mutations      │             │    (no event emitted)        (only)
                 └─────────────┘
```

### What's broken

| Gap | Impact |
|-----|--------|
| G1. Internal mutations don't emit `fs:change` | Calendar, backlinks, recent docs never hear about creates/deletes/renames done through the UI |
| G2. No consumer for `fs:change` beyond Sidebar + cache invalidate | Editor tabs, calendar, recent docs, context panel all ignore external changes |
| G3. Auto-save doesn't guard against deleted/renamed files | Deleted files get resurrected; renamed files spawn ghosts |
| G4. Indexer doesn't reconcile on startup | Files changed while app was closed leave stale DB entries |
| G5. No `Rescan`/overflow handling | Silently dropped events cause permanent index drift |
| G6. `create_periodic_note` skips link/tag extraction | Periodic notes invisible to backlinks until manually edited |

### Target event flow

```
                 ┌─────────────┐
  External ───►  │  watcher.rs │──┐
  changes        └─────────────┘  │
                                  ├──► fs:change event ──► ALL consumers
                 ┌─────────────┐  │    (single path)       (via Tauri listen)
  Internal ───►  │ commands.rs │──┘
  mutations      │ (emits      │
                 │  before IPC │
                 │  returns)   │
                 └─────────────┘
```

---

## 2. Design Principles

1. **One event path, no branching.** Internal mutations stop doing their own UI updates. Rust commands emit `fs:change` synchronously before returning the IPC response. `fileOps.ts` becomes thin: IPC call + wait for event-driven UI update. No `source` field, no consumer-side branching.
2. **Event-driven + startup reconciliation.** Real-time events for responsiveness; startup scan for consistency after app was closed.
3. **Defensive auto-save.** `deletedPaths` set as fast path; mtime check in `write_file` as the disk-level safety net. Two layers, not three.
4. **Minimal blast radius.** Targeted refresh per consumer (don't full-scan the tree because one file changed). Universal 500ms coalescing window for bulk operations.

---

## 3. Architecture

### 3.1 Unified change bus

All file mutations — internal and external — emit `fs:change` from Rust. **`fileOps.ts` no longer calls `bumpFileTreeVersion()` or does direct UI updates.** It calls the Rust command and returns. Consumers react to the event.

**Event payload:**

```rust
#[derive(Clone, Serialize)]
pub struct FileChangeEvent {
    pub kind: String,              // "create" | "modify" | "remove" | "rename"
    pub path: String,              // affected path (new path for renames)
    pub old_path: Option<String>,  // previous path (renames only)
}
```

No `source` field. One path, zero branching.

**Emitters:**
- `watcher.rs` — external changes (as today)
- `commands.rs` — after every successful mutation, emitted *before* the IPC response returns to JS. Self-write suppression prevents the watcher from double-emitting.

**Rename events are always atomic.** A rename is always a single `{ kind: "rename", path, old_path }` — never decomposed into remove + create at the consumer level. For external renames where the watcher sees separate remove/create, the watcher buffers a remove for 200ms; if a create for a same-sized file follows, coalesce into a rename. Otherwise, emit the remove.

### 3.2 Frontend event listeners

Each component subscribes to `fs:change` via Tauri's `listen()` in its own `useEffect`, with its own cleanup via `unlisten`. No Zustand pub/sub layer — Tauri's event system is already the bus.

`App.tsx` keeps a single listener for cross-cutting concerns:
- Invalidate IPC cache
- Update `deletedPaths` set (for auto-save guard)
- Cancel pending auto-save timers for affected paths

Components listen individually:
- Sidebar → `listen("fs:change")` → debounced tree refresh
- Calendar → `listen("fs:change")` → re-query if path matches periodic pattern
- ContextPanel → `listen("fs:change")` → set `backlinksStale` flag, re-query only if visible
- Editor → reacts via store state changes (tab closed/renamed by App.tsx handler)

All consumer listeners share a **500ms coalescing window** to handle bulk operations (e.g., 200 files pasted into a directory).

### 3.3 Auto-save guard

Two layers, not three:

1. **Fast path (sync, in-memory):** Before save, check `deletedPaths: Set<string>` in the store. If the tab's path is in the set → skip save, mark tab as "orphan-unsaved."
2. **Safety net (disk-level):** `write_file` in Rust already does an mtime check. If the file doesn't exist, there's no mtime → write fails. Change the error from string prefix (`CONFLICT:`) to a proper error code (`DELETED` | `CONFLICT`) so the frontend can distinguish "file gone" from "file modified externally."

No `file_exists` IPC. The mtime check already covers the disk-level case.

**UX for dirty tab + external delete:** Non-modal indicator (tab turns red/italicised, status bar warning). Only prompt on next save attempt or tab switch — never steal focus mid-keystroke.

### 3.4 Startup reconciliation

Replaces current `full_scan()` which only adds/updates but never prunes.

```rust
fn reconcile(db: &Database, directories: &[Directory]) {
    // 1. Walk all registered dirs → collect (path, mtime) set
    // 2. Query all indexed paths + indexed_at timestamps from DB
    // 3. Diff:
    //    - On disk but not in DB → index_file()
    //    - In DB but not on disk → batch DELETE WHERE path IN (...)
    //    - In both, mtime > indexed_at → reindex_file()
    // 4. Resolve pending backlinks (see 3.6)
    // 5. Emit index:complete when done
}
```

Key details (from Prism):
- Use `files.indexed_at` column (already exists) for mtime comparison — no separate in-memory map needed across restarts.
- **Batch operations:** Collect all stale paths, delete in a single `DELETE ... WHERE path IN (...)` transaction. Same for bulk inserts.

### 3.5 `Rescan` / overflow handling

When the watcher receives a `Rescan` event (FSEvents coalesced, inotify overflow), trigger a targeted reconciliation for the affected directory — same logic as startup reconciliation but scoped to one directory.

> **Note: Periodic background reconciliation — deferred.** The original spec proposed a 10-minute polling loop. Per review feedback, this is a crutch for not trusting the watcher. Proper `Rescan` handling + startup reconciliation should be sufficient. **If testing reveals silently dropped events that `Rescan` doesn't catch, revisit with an adaptive interval (long when healthy, short after incidents).** Track in DEBT.md if needed.

### 3.6 Backlink resolution on file creation

When a new file is created (or reconciliation discovers a new file), resolve pending backlinks:

```rust
fn resolve_pending_links(db: &Database, new_file_path: &str, new_file_id: i64) {
    // Find links where target matches new_file_path's stem and target_id IS NULL
    // UPDATE links SET target_id = new_file_id WHERE ...
}
```

This fixes the silent data integrity issue where `[[New File]]` links remain unresolved even after `New File.md` is created.

### 3.7 Rename detection

> **Note: `notify-debouncer-full` — deferred.** The current custom debounce thread works, is readable, and the rename bugs reported (#18) are in `fileOps.ts` (internal rename), not the watcher. **Before adopting `notify-debouncer-full`, investigate: (a) are there real user-reported external rename detection bugs? (b) does the crate's API support our self-write suppression pattern? (c) what's the maintenance/compatibility story?** For now, keep raw notify + custom debounce. Add rename coalescing heuristic in the watcher (buffer removes for 200ms, coalesce with following creates) only if external renames prove to be a real issue.

### 3.8 Fix `create_periodic_note` indexing

Currently calls `db.upsert_file()` with `None` for frontmatter — skips link/tag extraction entirely. Change to call `Indexer::reindex_file()` after creation so periodic notes with `[[wikilinks]]` and `#tags` are immediately indexed.

---

## 4. Consumer Contracts

The source of truth for what each UI surface does in response to events.

### Sidebar (file tree)

| Event | Action |
|-------|--------|
| `create` | Refresh parent directory node |
| `remove` | Remove node from tree, refresh parent |
| `rename` | Remove old node, insert new node (or refresh both parents if cross-directory) |
| `modify` | No-op (content changes don't affect tree) |

### Editor tabs

| Event | Action |
|-------|--------|
| `remove` | If tab open → clean: close silently. dirty: non-modal indicator, prompt on next interaction |
| `rename` | If tab open for old path → update tab ID/path, migrate editor cache |
| `modify` | If tab open → compare content hash (not just mtime). clean + content differs: auto-reload. dirty: show conflict prompt |

### Calendar

| Event | Action |
|-------|--------|
| `create/remove` where path matches periodic note pattern | Re-query dot dates for visible month |
| `rename` where old or new path matches periodic note pattern | Same |

### Context panel (backlinks, properties)

| Event | Action |
|-------|--------|
| Any event touching active file's path | Refresh properties panel |
| Any `create/remove/rename/modify` | Set `backlinksStale = true`. Re-query only when backlinks section is visible (lazy) |

### Recent docs

| Event | Action |
|-------|--------|
| `remove` | Mark entry as stale (dim + non-clickable) |
| `rename` | Update path in ring buffer |

### Session persistence

| Event | Action |
|-------|--------|
| `remove` | Remove from saved session (don't restore dead tabs on next launch) |
| `rename` | Update path in session |

---

## 5. Implementation Plan

### Phase A — Backend foundation

1. **Emit `fs:change` from all Rust commands**
   - `trash_file`, `rename_file`, `create_periodic_note` emit event before returning IPC response
   - `write_file` emits `modify` (already has self-write suppression to prevent watcher double-emit)
   - Expand `FileChangeEvent` payload with `old_path` field
   - Change `write_file` conflict error from string prefix to proper error codes (`DELETED` | `CONFLICT`)

2. **Add startup reconciliation to `indexer.rs`**
   - New `reconcile()` function that diffs disk vs DB using `indexed_at` timestamps
   - Batch deletes for stale entries, batch inserts for new files
   - Replace current `full_scan()` with `reconcile()` on startup

3. **Fix `create_periodic_note` to do full indexing**
   - Call `Indexer::reindex_file()` after creation (extract frontmatter, links, tags)

4. **Add `resolve_pending_links()` to indexer**
   - Called after every file creation (including reconciliation discoveries)
   - Updates `target_id` on existing link records that match the new file

5. **Handle `Rescan` events in watcher**
   - On `Rescan` / overflow, trigger scoped reconciliation for affected directory

### Phase B — Frontend reactivity

6. **Refactor `fileOps.ts` to be event-driven**
   - Remove `bumpFileTreeVersion()` calls from delete/rename/create
   - Remove direct tab manipulation from delete (tab close moves to event handler)
   - Remove direct cache migration from rename (moves to event handler)
   - `fileOps.ts` becomes: call Rust IPC, return. That's it.

7. **Centralize cross-cutting event handling in `App.tsx`**
   - Single `listen("fs:change")` for: invalidate IPC cache, update `deletedPaths`, cancel auto-save timers, handle tab close/rename
   - Remove Sidebar's duplicate `fs:change` listener

8. **Wire up component listeners**
   - Sidebar: `listen("fs:change")` → 500ms debounced tree refresh
   - Calendar: `listen("fs:change")` → 500ms debounced re-query (filtered to periodic paths)
   - ContextPanel: `listen("fs:change")` → set `backlinksStale` flag, lazy re-query
   - Recent docs: `listen("fs:change")` → stale marking + rename path update

9. **Implement auto-save guard**
   - `deletedPaths` set in store, populated by App.tsx event handler
   - Editor checks set before save; on hit → mark tab "orphan-unsaved"
   - Handle new `DELETED` error code from `write_file` as fallback

### Phase C — Hardening

10. **Tab lifecycle polish**
    - Dirty tab + external delete: non-modal red indicator, prompt on interaction
    - External modify + clean tab: auto-reload (with content-hash check to avoid no-op reloads)
    - External modify + dirty tab: conflict prompt

11. **Session restore validation**
    - On restore, check each file exists before opening tab
    - Skip dead entries, log warning

12. **Automated tests**
    - Rust integration test: create/delete/rename files, assert DB state after `reconcile()`
    - Rust unit test: `resolve_pending_links()` correctness
    - TS test: fire synthetic `fs:change` events, assert store state transitions

---

## 6. Migration / Compatibility

- **No schema changes.** DB tables stay the same. `indexed_at` column already exists.
- **No new IPC commands.** Expanding existing `fs:change` event payload (additive — `old_path` is optional).
- **`fileOps.ts` API unchanged.** Same functions, same signatures. Internal refactor only.
- **Error code change in `write_file`:** Frontend must handle new `DELETED` code in addition to existing `CONFLICT:` prefix. Backwards-compatible if we keep the string prefix and add a structured variant.

---

## 7. Testing Strategy

| Test | Method |
|------|--------|
| External file create/delete/rename → tree updates | Manual: Finder ops while Onyx is open |
| Internal delete → tab closes, calendar updates, recent docs dims | Manual: sidebar delete, verify all consumers |
| Auto-save doesn't resurrect deleted files | Manual: delete open file externally, wait 500ms+, verify no ghost |
| Startup reconciliation | Manual: delete/create files while Onyx is closed, relaunch, verify index |
| Rename via sidebar → no ghost files | Manual: rename open file, verify single file with correct content |
| Periodic note creation → backlinks work immediately | Manual: create periodic note with `[[wikilink]]`, check backlinks |
| Bulk external changes | Manual: copy 50+ files into registered dir, verify all appear |
| Reconciliation correctness | **Automated:** Rust integration test |
| Pending backlink resolution | **Automated:** Rust unit test |
| Store state transitions on fs:change | **Automated:** TS unit test with synthetic events |

---

## 8. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Race between Rust emit and IPC response (event arrives before JS processes response) | Medium | Event handler and IPC response handler must be idempotent. Test ordering. |
| Self-write suppression fails → double event for internal mutations | Low | Existing 2s cooldown is generous. If it fires, consumers are idempotent (re-query is harmless). |
| Over-refreshing on bulk operations | Medium | 500ms coalescing window on all consumer listeners |
| Removing `bumpFileTreeVersion` from fileOps breaks existing flow | Medium | Verify Sidebar picks up event-driven refresh before removing version bumps. Can keep version bumps as temporary fallback during migration. |
| Rename coalescing heuristic (200ms buffer) causes latency for real deletes | Low | 200ms is imperceptible. If it proves annoying, reduce to 100ms. |

---

## 9. Deferred Decisions

| Decision | Trigger to revisit | Tracked in |
|----------|--------------------|------------|
| Adopt `notify-debouncer-full` | Real bug report involving external rename detection failure | This spec, Section 3.7 |
| Add periodic background reconciliation | Evidence of silently dropped watcher events that `Rescan` doesn't catch | DEBT.md |
| Content-hash based self-write suppression (instead of time-based) | False positives from 2s cooldown causing missed external edits | DEBT.md |

---

## 10. Dependencies

No new crate or JS dependencies for the initial implementation.

If `notify-debouncer-full` is adopted later:

| Crate | Change |
|-------|--------|
| `notify` | Keep (transitive) |
| `notify-debouncer-full` | Add |

---

## 11. Out of Scope

- Multi-window support (single window, split panes only)
- Cross-device sync (offline-first, no network)
- Watching non-markdown files (images, PDFs — future consideration)
- Graph view / dataview reactivity (Phase 11+)
