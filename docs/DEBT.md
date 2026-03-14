# Onyx — Known Technical Debt

Consolidated from CLAUDE.md and ARCHITECTURE.md. Items are grouped by area, not priority.

---

## Resolved

- ~~#1 Tab switch destroys undo/cursor/scroll state~~ — Fixed Phase 2: `EditorState` cached per tab, swapped via `setState()`
- ~~#2 Extract shared `openFileInEditor`~~ — Fixed Phase 2: `src/lib/openFile.ts`
- ~~#4 `findAvailablePath` TOCTOU race~~ — Fixed Phase 4.5: `path_exists` Rust command replaces `read_file` existence check
- ~~#5 Delete action stubbed/no feedback~~ — Fixed Phase 4.5: `trash_file` implemented, delete works via context menu
- ~~#8 Watcher debounce thread never exits~~ — Fixed Phase 4.6: `AtomicBool` shutdown flag, checked each loop iteration, set on drop
- ~~#16 No React error boundary~~ — Fixed Phase 4.6: error boundary wraps editor and sidebar, prevents white-screen data loss
- ~~#17 Session persistence uses localStorage~~ — Fixed Phase 4.6: moved to `~/.onyx/session.json` via Rust commands
- ~~#11 Full-doc decoration scan~~ — Fixed Phase 7: wikilinks, tags, and live preview all use viewport-aware iteration (`view.visibleRanges`). Pre-scan from line 1 to first visible line for code block state tracking.

---

## Open — Editor & Extensions

- **Duplicate preview sync.** Editor.tsx syncs `previewModeField` in both the tab-switch effect and a separate `useEffect(editorMode)`. Consider consolidating to a single sync point.
- **Code-block pre-scan scaling.** `tags.ts` and `livePreview.ts` scan from line 1 to the first visible line on every viewport change. O(n) from top of doc. Could cache per doc version. Not a problem under ~50K lines.
- **Heading line decorations not hoisted.** `Decoration.line()` in `buildPreviewDecorations` uses a dynamic class per heading level (h1-h6). Could pre-build 6 constants.
- **Multi-cursor formatting.** `toggleWrap` in `formatting.ts` offset drift fixed, but needs multi-cursor integration test.
- **Inline formatting inside wikilinks.** `livePreview.ts` — Bold/italic regexes match inside `[[some *emphasized* link]]`, producing overlapping decorations. Cosmetic.
- **Frontmatter auto-fold rAF race.** `frontmatter.ts:98` — `requestAnimationFrame` captures `view` from constructor. On rapid tab switch, the rAF fires after `setState()` loaded a different document, potentially folding the wrong range.
- **Module-level mutable refs not cleared on HMR.** (#18) `activeTabIdBox`, `_liveViewRef`, `editorStateCache`, `scrollCache`, `lastSavedContent` in Editor.tsx persist across React hot-reloads. Not a problem in production.

## Open — Tables

- **Table `transact()` is a no-op.** `tableAdapter.ts` — Each mutation (`insertLine`, `deleteLine`, `replaceLines`, `setCursorPosition`) dispatches independently. Multi-step operations (transpose, sort, move column) produce N undo steps instead of one. Batching requires collecting changes and dispatching once, but `getLine()` reads from `view.state` which updates after each dispatch — needs careful offset tracking. Fix if users report janky undo.
- **Duplicate table scanning.** `livePreview.ts` — `detectTableRanges()` (ViewPlugin, visible ranges) and `buildTableBlockDecos()` (StateField, full tree) both walk the syntax tree for tables on every relevant update. Could consolidate by having the StateField expose skip-lines for the ViewPlugin. Fix if table-heavy docs feel sluggish.

## Open — File Operations & Watcher

- **Auto-save stale path after rename.** `Editor.tsx:142` — The debounced save closure captures `tab.path` at edit time. If the user renames the file within the 500ms window and types, the save fires at the old (deleted) path. Narrow window but can create ghost files.
- **`unregister_directory` doesn't stop watcher.** `commands.rs:258` — `notify` watcher continues watching the removed directory. File modifications trigger reindexing with empty `dir_id`, polluting search results with orphan entries.
- **Orphan rename fails.** `commands.rs:493` — `validate_path` checks the new path against the allowlist, but only the old path was `allow_path`'d. Renaming an orphan note returns "Access denied".
- **`dirs.rs` non-atomic save.** `dirs.rs:101` — Uses `fs::write()` instead of temp+rename. Crash during save truncates `directories.json`. Low probability.
- **External edit conflict detection.** (#3) If a file is modified externally while Onyx has it open with unsaved changes, the stale editor cache can overwrite the external edit on the next auto-save. **Fix:** On `fs:change` events for open files, compare on-disk content with `lastSavedContent`. If they differ and the editor also has unsaved changes, show a conflict notification.
- **Watcher self-write suppression vs IPC cache.** Verify that the file watcher's self-write suppression actually prevents `fs:change` emission to the frontend after Onyx's own saves. If it doesn't, the IPC cache (5s TTL) is being cleared on every auto-save and is effectively useless.
- **Mtime map `.clear()` cap strategy.** The 500-entry cap uses `.clear()` which nukes all tracked mtimes. An LRU eviction would be more correct. Low severity — fallback is content comparison, not data loss.
- **Frontmatter parsing can mangle malformed files.** (#24) `commands.rs` update_frontmatter can prepend new frontmatter if the closing `---` delimiter is missing. Could produce a file with two frontmatter blocks. Add validation that rejects writes when existing frontmatter is unparseable.

## Open — UI & State

- **Stale store in `openFileInEditor`.** `openFile.ts:29` — `getState()` snapshot goes stale across `await` boundaries. If the user switches tabs during IPC round-trips, `replaceActiveTab` can replace the wrong tab.
- **Focus trapping.** Command palette and QuickOpen overlays don't trap Tab focus. Keyboard-only users can Tab behind the overlay.
- **Tab reorder accessibility.** Drag-to-reorder is mouse-only. Add Cmd+Shift+Left/Right for keyboard users.
- **ARIA on command palette.** Category headers need `role="separator"` or group wrapping for screen readers.
- **QuickOpen missing ARIA.** (#7) Add `role="listbox"`, `role="option"`, `aria-activedescendant` for screen reader support.
- **Context menu lacks keyboard navigation.** (#6) Currently mouse-only. Add arrow key navigation and Enter to select.
- **QuickOpen results capped at 10.** (#19) Hardcoded limit. For vaults with many similarly-named files, the desired result may not appear. Add "show more" or increase limit.
- **Bookmark desync on reindex.** (#10) If a file is deleted and re-created, `ON DELETE CASCADE` removes old bookmarks. UI won't update until tab switch.
- **Bookmark toggle on unindexed file fails silently.** (#12) Frontend catches "File not indexed" error but doesn't surface it. Needs toast/notification system.
- **Sidebar auto-expand on deep file open.** (#23) Opening a deeply nested file doesn't auto-expand its parent folders in the sidebar.
- **`periodicNotes.ts` bypasses `fileOps.ts`.** (#25) Periodic note creation manually calls `loadFileIntoCache` + `openFile` + `bumpFileTreeVersion` instead of routing through `fileOps.ts`.
- **Recent docs use localStorage.** (#26) Third persistence layer alongside Rust IPC and session. Migrate to `~/.onyx/state.json` if recent docs grow in importance.
- **`useToday` timer drift on sleep/wake.** (#27) Midnight timer can drift if machine sleeps. Stale "today" highlight until next month navigation.
- **Untyped property type inference is basic.** (#20) `ContextPanel.tsx` infers types via simple typeof checks. Won't handle edge cases like numeric strings, nested objects, or null.
- **Split panes not yet implemented.** ARCHITECTURE.md specifies split panes but Phase 7 shipped without them. Planned for Phase 9.

## Open — Database & Indexing

- **Autocomplete scaling.** `get_all_titles` fetches all indexed files on `[[` with empty prefix. Cache with short TTL for vaults >5k files.
- **Single Mutex<Connection> for all DB access.** (#21) One connection serves both indexer writes and UI reads. At 10k+ files, lock contention during initial scan could cause UI jank. Separate reader/writer connections if needed.
- **No index on `json_extract(frontmatter, '$.type')`.** (#13) `query_by_type` does a full table scan. Fine for <50k files.
- **`update_frontmatter` doesn't update `title` column.** (#14) If frontmatter edit changes the title, `files.title` column won't reflect it until next reindex.
- **`rename_dir_prefix` byte offset vs UTF-8.** (#15) `substr` uses `old_p.len()` (byte length) but SQLite `substr` works on characters. Multi-byte folder names would slice wrong.
- **`unchecked_transaction` in db.rs.** (#9) Safe since all DB access is behind a Mutex, but consider using `transaction()` if Mutex is ever replaced.
- **Tag extraction is case-sensitive.** (#22) `indexer.rs` tag regex won't match `#Tag` or `#TAG`. Obsidian treats tags as case-insensitive. Decide whether to match.
- **`get_dates_with_notes` runs 31 individual queries.** (#28) Each is O(1) via unique index. Could rewrite as single `WHERE path IN (...)` if it becomes a bottleneck.
- **`search_content` runs synchronously on main thread.** Walks all registered dirs + reads every .md file from disk on each search. Fine for <1000 files. For large vaults, move to async with `build_parallel()` or stream results via Tauri channels.
