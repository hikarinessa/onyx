# Note-Taking App Development: Gotchas & Hard-Won Lessons

Research compiled from post-mortems, bug reports, forum discussions, and open-source project issues across the note-taking app ecosystem. Organized by problem domain with app-specific callouts.

---

## 1. File System Edge Cases

### 1A. Special Characters in Filenames

Obsidian forbids `* " \ / : | ?` in note titles because titles are filenames. This is a fundamental tension: users want expressive titles ("What is 2+2?"), the OS disagrees. Cross-platform makes it worse.

- **Case sensitivity divergence:** macOS is case-insensitive by default (`Notes.md` = `notes.md`), Linux is case-sensitive. Obsidian does not handle casing consistently across platforms, leading to phantom duplicates or broken links after syncing between Mac and Linux.
- **Unicode/codepage corruption:** Obsidian vaults with non-English filenames get corrupted when opened on machines with different codepage configurations. Markdown links stop working silently.
- **Emoji in filenames:** Partially broken with some sync services (Dropbox in particular). Some file systems store emoji as multi-byte sequences that get mangled in transit.
- **Brackets in filenames:** Zettlr had a bug where images with brackets in the filename would not render (#3825). This is because brackets are markdown syntax -- any filename character that overlaps with markdown syntax is a potential landmine.

**Onyx relevance:** Onyx uses filenames as identifiers and wikilink targets. A strict cross-platform character allowlist is essential. Consider percent-encoding or substitution for characters that differ across platforms rather than outright banning them.

### 1B. Symlinks

- **iCloud ignores symlinks entirely.** Users who symlink shared directories into their vault find those directories invisible on mobile.
- Symlinks create ambiguity for file watchers: a change to the symlink target fires events on the target path, not the symlink path. If your watcher is monitoring the symlink path, you miss updates.
- Circular symlinks can cause infinite directory traversal during indexing.

**Onyx relevance:** Onyx's multi-directory model avoids the symlink-into-vault pattern, but registered directories could still contain symlinks. The indexer should either resolve symlinks or explicitly skip them, and guard against cycles.

### 1C. Cloud Sync Conflicts

This is the single most complained-about category across all apps studied.

- **Obsidian + iCloud:** Users report 1-minute vault load times, notes vanishing, and silent overwrites where one device's version wins without notification. Obsidian's official guidance now warns against using third-party sync alongside Obsidian Sync.
- **Obsidian + Dropbox:** Generally works but generates conflict files (`Note (conflict).md`) that clutter the vault and confuse the link graph.
- **Joplin's approach:** Exports SQLite data to plaintext files that sync via Dropbox/Nextcloud, then re-imports on the other side. This avoids syncing the database directly (which is a "huge no-no" per HN discussion) but introduces its own problems: data loss when sync target folders are moved, and database growth far exceeding actual note content.
- **Notion's solution:** Took years to build offline mode. Required downloading every record a page depends on (not just the page itself), building a CRDT-based sync engine for conflict-free merges, and handling structural changes (pages moving, databases gaining rows) in an "offline forest" that must stay synchronized.

**Onyx relevance:** Onyx is offline-first with no sync (yet). This is a strength -- but files on disk may still be edited by other tools or live in synced folders (iCloud Drive, Dropbox). The file watcher + auto-save combo needs to handle the case where a file changes on disk while the user has unsaved edits in the editor.

### 1D. Large Vaults / Many Files

- **Obsidian at 40,000 notes:** Mobile vault load takes 3+ minutes. Reindexing happens on every vault open and takes ~27 minutes. Desktop is faster but still sluggish.
- **Obsidian with many attachments:** Binary files (images, PDFs) in the vault trigger cache reinitialization on folder structure changes. The `node_modules` problem -- accidentally indexing thousands of irrelevant files -- is common enough that a dedicated plugin exists to ignore paths.
- **Indexing cost:** The wikilink autocomplete in Obsidian takes 4 seconds per keystroke in large vaults because it searches all note titles on each input.

**Onyx relevance:** Onyx's background indexer runs in a separate thread with debounced reindex (3s). This is good. But ensure the indexer can handle 10,000+ files without blocking the UI, and that autocomplete queries against SQLite are indexed properly (the `get_all_titles` command should not do full table scans).

---

## 2. Search & Indexing Pitfalls

### 2A. Stale Indexes

- Joplin users report search returning results for deleted notes, or failing to find recently created notes, because the index hasn't caught up.
- Obsidian's search lacks advanced query features (no boolean operators, no regex in default search), which means the index design constrains the feature ceiling.

### 2B. Memory During Indexing

- Obsidian indexing causes high RAM/CPU usage, especially when it encounters unexpected file types. The entire vault metadata is loaded into memory.
- Windows Search Indexer demonstrates the general problem: indexing large file collections causes the WAL file to grow unbounded if checkpointing can't keep up, leading to disk space exhaustion and performance degradation.

### 2C. Incremental vs Full Reindex

- Obsidian mobile does full reindex on every vault open (no incremental). This is the primary cause of the 3+ minute load times on large vaults.
- The ideal approach: track file modification times, only reindex changed files, and maintain a persistent index that survives app restarts. But this requires careful invalidation -- renamed files need their old index entries removed and new ones added atomically.

**Onyx relevance:** Onyx stores index data in SQLite and uses file watching for incremental updates. The indexer should track `mtime` and skip unchanged files on startup. Consider storing a hash alongside `mtime` to catch cases where `mtime` is unreliable (some sync tools preserve original timestamps).

---

## 3. Editor State Management

### 3A. CodeMirror 6 Specific Gotchas

These are directly relevant to Onyx's architecture:

- **`view.setState()` scroll regression:** Restoring a saved `EditorState` via `setState()` can place the cursor at the bottom and scroll there, discarding the intended scroll position. Scroll position is stored in the DOM, not in the functional state -- it must be restored separately after the state swap.
- **Undo history across tab switches:** If you create a new `EditorState` (rather than caching and restoring the old one), the user loses undo history. But if the first state change in a newly opened tab is the content load, Ctrl+Z will undo the entire content -- showing an empty editor.
- **Widget cursor jumps:** Cursor navigation with arrow keys can skip over entire decoration widgets instead of positioning at their boundaries. This affects live preview mode with inline widgets.
- **Immutability violations:** `EditorState` is immutable. Directly mutating properties (instead of dispatching transactions) causes silent corruption. This is easy to accidentally do when passing state objects around.

### 3B. General Editor State Lessons

- **Cursor position loss on external edit:** When a file changes on disk and the editor reloads content, preserving the user's cursor position requires mapping the old position through the content diff. Naive approaches (restore line number) break when lines are inserted above the cursor.
- **Scroll position loss:** Multiple apps (Obsidian, Zettlr) have had bugs where switching tabs and switching back resets scroll position. The fix is to cache scroll position per-tab and restore it after the DOM settles (requestAnimationFrame or similar).

**Onyx relevance:** Onyx already caches `EditorState` per tab and maintains `scrollCache`. The key risk is the interaction between external file changes (via watcher) and the cached state. When a file changes externally, the cached `EditorState` must be updated without destroying undo history -- this means applying the external diff as a transaction, not replacing the state wholesale.

---

## 4. Auto-Save Pitfalls

### 4A. Race Conditions with File Watchers

The classic auto-save race condition:

1. User types in editor
2. Auto-save fires, writes to disk
3. File watcher detects change, triggers "file changed externally" logic
4. App reloads file from disk, potentially disrupting the editor

This feedback loop must be broken. Common approaches:
- Maintain a "last write timestamp" and ignore watcher events within a window after writing
- Use a flag (`weJustWroteThis`) that the watcher checks
- Compare file content hash before triggering reload

### 4B. Atomic Writes and Watcher Events

Atomic writes (write to temp file, rename to target) are essential to prevent corruption on crash. But they generate unexpected file watcher events:

- Create temp file
- Write content to temp
- Delete original
- Rename temp to original
- Update attributes
- Flush buffers

One "save" can generate 6+ events. Without debouncing, this triggers 6 reloads. With debouncing, there's a window where the file doesn't exist (between delete and rename) -- if another process reads during this window, it sees a missing file.

### 4C. Conflict with External Editors

Users edit the same file in VS Code, Vim, or another markdown editor simultaneously. Without coordination:
- Auto-save in App A overwrites changes from App B
- Neither app detects the conflict
- The user discovers data loss later

Obsidian Sync uses diff-match-patch for conflict resolution. For local-only apps, the minimum viable approach is: before writing, check if `mtime` has changed since last read; if so, prompt the user.

**Onyx relevance:** Onyx uses atomic writes (temp + rename) with 500ms debounce auto-save. The watcher has 3s debounce. Verify that the watcher ignores events from Onyx's own writes. The `mtime` check before write is not currently documented -- this should be added to prevent silent overwrites when files change externally.

---

## 5. Link Graph Complexity

### 5A. Rename Cascades

When a file is renamed, every wikilink pointing to it must update. This is deceptively complex:

- **Ambiguous links:** `[[Note]]` could match `Note.md`, `Folder/Note.md`, or `Other/Note.md`. Renaming one requires deciding whether links were referring to it or to a different file with the same name.
- **Alias resolution:** Some links use display text (`[[Note|My Note]]`). Renaming the target should update the link target but not the display text.
- **Bulk renames:** Renaming a folder means renaming every file inside it, each of which may have incoming links. The cascade must be batched to avoid O(n^2) index updates.
- **Frontmatter references:** Links in YAML frontmatter (e.g., `related: [[Other Note]]`) need different parsing than links in body text.

Foam (VS Code extension) handles this well -- automatic wikilink updates on rename, enabled by default. DEVONthink does not update links on rename at all, which users find surprising.

### 5B. Orphan Detection

Detecting orphaned notes (no incoming links) requires a full graph traversal. This is expensive on large vaults and the result goes stale immediately after any edit. Obsidian's backlinks plugin tracks this but only for the currently open note.

### 5C. Circular References

Transclusion (embedding note content in another note) turns the note graph from a DAG into a general directed graph. Circular transclusions (`A embeds B, B embeds A`) must be detected and broken to prevent infinite rendering loops. This is hard to detect efficiently in a lazy-loading system.

**Onyx relevance:** Onyx tracks links in SQLite via the indexer. The `fileOps.ts` rename path updates links, but the ambiguity problem (multiple files with same name in different directories) needs careful handling given Onyx's multi-directory model. When implementing transclusion later (Phase 8+), add cycle detection from day one.

---

## 6. Memory Leaks in Long-Running Desktop Apps

### 6A. Electron / WebView Specific

- **Obsidian reports:** Users see 1GB+ RAM after sustained typing (630MB to 1,080MB in 5 minutes of typing). Idle memory reaches 5GB+ in extreme cases.
- **Plugin cleanup failures:** Obsidian plugins that register event listeners but don't clean up on disable cause memory retention. A 40MB data structure in a plugin persists in memory even after the plugin is toggled off.
- **Detached DOM nodes:** In React + Electron/Tauri apps, components that unmount but retain references (via closures, event listeners, or WeakMap entries that aren't actually weak) leak memory proportional to usage duration.
- **PDF and media leaks:** Obsidian has documented memory leaks on PDF open/close cycles -- each open allocates rendering buffers that aren't fully freed.

### 6B. Tauri Specific

- **Large file reads:** Tauri's file reading can consume disproportionate memory -- a 140MB file read caused 11.5GB RAM usage on a 16GB system. 50-80MB files consumed 2-5GB.
- **IPC overhead:** Every `invoke()` call serializes data across the JS-Rust boundary. Frequent small calls (e.g., on every keystroke for auto-save status) add up.
- **Thread leaks:** Rust threads spawned for background tasks (file watching, indexing) that aren't properly joined on shutdown become orphaned.

### 6C. Mitigation Strategies

- Profile memory periodically during development, not just when users complain
- Ensure all event listeners registered in `useEffect` or CM6 extensions are removed on cleanup
- For CM6: `EditorView.destroy()` must be called when views are no longer needed
- WeakMap is not a guarantee against leaks if the key object is retained elsewhere
- Periodic forced GC in development builds to surface leaks earlier

**Onyx relevance:** Onyx's `EditorView` instances are persistent (1-2 max for split panes) which is good -- no view creation/destruction churn. The main risks are: CM6 extension cleanup if extensions are reconfigured, event listener cleanup in React components, and the file watcher thread's `Drop` impl (already documented as a known pattern). Monitor memory during extended editing sessions.

---

## 7. Features That Seem Simple but Are Hard

### 7A. Tables

The single hardest "simple" feature in markdown editors:

- **Markdown table syntax is hostile to editing.** Pipe-aligned columns require recalculating alignment on every cell edit. Adding/removing columns means reformatting every row.
- **Cell editing UX:** Tab-to-next-cell, arrow-key navigation within and between cells, selection across cells -- each requires custom key handling that fights with the editor's default behavior.
- **Merge cells, column resize:** Not representable in standard markdown. You either extend the format (breaking compatibility) or limit functionality.
- **Copy-paste from spreadsheets:** Users expect to paste tabular data and get a markdown table. Parsing clipboard HTML/TSV is fragile.
- Bear 2 built a custom markdown parser specifically to handle tables (among other features). It was "another significant project" that consumed substantial development time.

### 7B. Transclusion / Embeds

Embedding one note's content inside another:

- Turns the note graph into a directed graph (possibly with cycles)
- Read-only transclusion is tractable; editable transclusion is a research problem (Peritext CRDT paper addresses this for collaborative editing)
- Granularity decisions: embed whole notes? Headings? Arbitrary blocks? Each level adds complexity.
- Stale content: if the source note changes, every transclusion must update. In a large vault, this means tracking reverse dependencies for every block.

### 7C. Drag and Drop

- **File drops (images, attachments):** Must handle the file copy/move, generate the correct markdown reference, and place it at the drop position in the editor. Cross-platform drag data formats differ.
- **Block/line reordering:** Logseq's entire UX depends on this. Implementing smooth drag-to-reorder in a text editor (not a list UI) requires custom DOM manipulation that conflicts with the editor's own content management.
- **Tab reordering:** Simpler than in-editor drag, but still requires careful state management to avoid dropping tabs or duplicating them.

### 7D. Image Handling

- **Paste from clipboard:** Must detect image data on clipboard, save to disk (where?), generate markdown reference, insert at cursor. The "where to save" question alone has multiple valid answers (same folder, attachments subfolder, central media folder).
- **Relative vs absolute paths:** Markdown image references should be relative for portability, but relative to what -- the file or the vault root?
- **Image preview in editor:** Requires inline widgets in CM6 that load and render images. Large images need lazy loading and size constraints. Broken image references need graceful fallback.

### 7E. WYSIWYG / Live Preview

- **Cursor position ambiguity:** In live preview, `**bold**` renders as **bold**. Where does the cursor go when clicking between "b" and "o"? The visual position maps to an offset in the hidden syntax. Every decoration must handle this mapping.
- **Selection across formatted regions:** Selecting text that spans formatted and unformatted regions requires revealing the syntax at selection boundaries.
- **Folded regions:** Frontmatter, code blocks, and other foldable content create regions where the visual line count differs from the document line count. All line-based operations (goto line, error reporting) must account for this.
- CRDTs have trouble with rich text formatting -- "applying existing CRDT algorithms in a naive way to represent formatted text does not yield the desired behaviors" (Ink & Switch, Peritext paper).

---

## 8. App-Specific Lessons

### 8A. Obsidian

**What went wrong:**
- Plugin ecosystem became a crutch for missing core features. Users install 20+ plugins, then blame Obsidian when things break.
- No built-in optimization for large vaults. Performance degrades linearly with vault size.
- iCloud sync is a persistent pain point with no clean solution (short of paying for Obsidian Sync).
- Mobile app is architecturally disadvantaged -- IndexedDB transactions aren't flushed to disk reliably, causing vault corruption.

**What went right:**
- Plain markdown files on disk. Zero lock-in. This single decision drives most of Obsidian's adoption.
- Community plugins, despite the quality issues, created an ecosystem that no competitor can match.
- CodeMirror 6 adoption gave them a solid editor foundation.

### 8B. Notion

**What went wrong:**
- Online-first architecture made offline support a multi-year engineering effort.
- Block-based data model means every unit of content is a database row. At 200+ billion blocks, Postgres needed application-level sharding.
- Putting all loaded page data into memory (RecordCache) means complex pages consume significant RAM.
- Sync conflicts on non-text properties (select fields, database rows) are harder to merge than text.

**What went right:**
- The block model enables remarkable flexibility -- the same data model powers docs, databases, kanban boards, and galleries.
- CRDT-based sync engine, once built, handles conflicts well.
- Aggressive offline caching with SQLite (eventually) made the app usable without network.

### 8C. Logseq

**What went wrong:**
- Outliner-first + file-based storage is a fundamental mismatch. Block-level operations (indent, outdent, reference) require random access, but markdown files are sequential.
- The file-to-database migration has been in progress since late 2022 and as of early 2026 is still not complete. Core architectural rewrites are brutally difficult.
- Editor lag on every keystroke was the primary user complaint, caused by writing to files on every change.
- Clojure/ClojureScript is a niche technology that limits the contributor pool.
- During the multi-year database migration, competitors (Remnote, Reflect, Tana) shipped AI features and captured mindshare.

**What went right:**
- Block references and block embeds worked well once they worked, enabling powerful knowledge management patterns.
- Open source with a passionate community that tolerated years of architectural transition.

### 8D. Bear

**What went right:**
- Simplicity as a feature. Bear does fewer things but does them well.
- Native app performance (Swift/AppKit) means instant startup and low memory.
- Bear 2's custom markdown parser was a multi-year investment that paid off -- it handles tables, footnotes, and YAML while remaining a "stellar markdown citizen."

**What went wrong:**
- Bear 1 to Bear 2 migration required users to update all devices simultaneously (Bear 1 can't sync with Bear 2). Users without iCloud sync risked data loss if they deleted Bear 1 prematurely.
- Apple-only. No Windows or Linux support limits the addressable market.

### 8E. MarkText

**What went wrong:**
- Built a custom editor engine (Muya) from scratch instead of using CodeMirror or ProseMirror. Muya needed "refactoring to improve data structure, performance, and reduce memory usage" -- a second system within the project.
- Single maintainer. When the maintainer stopped contributing, 43 PRs went unreviewed, the project stalled, and eventually was abandoned.
- Muya was supposed to work in both Electron and browsers, adding scope without adding contributors.
- Latest npm release of Muya: 2+ years old, still marked "not for production use."

**Lesson for Onyx:** Building on CodeMirror 6 instead of a custom engine was the right call. CM6 has a full-time maintainer (Marijn Haverbeke) and an active community. The marginal control gain from a custom engine is not worth the maintenance burden.

### 8F. Joplin

**What went wrong:**
- SQLite database as the canonical store means notes aren't human-readable files. Export is required for interoperability.
- Sync via file export/import is fragile. Moving the sync target folder causes data loss. Database grows much larger than the actual note content.
- Encrypted sync has key-sharing problems with shared notebooks.

### 8G. Notable

**What went wrong:**
- Went closed source (September 2019, v1.8.4) after building community goodwill as open source. The community felt betrayed.
- The developer's reasoning (financial sustainability) was valid, but the transition was poorly communicated.
- The community forked the last open-source version, but momentum was lost.

**Lesson for Onyx:** If Onyx ever goes public, be explicit about the license and long-term model from day one.

### 8H. Standard Notes

**What went right:**
- Encryption-first architecture with versioned encryption protocols that can be upgraded.
- Trustless server design -- the server is treated as potentially hostile.

**What went wrong:**
- Encryption version management is complex. A compromised server could theoretically downgrade clients to older, weaker encryption versions.
- Application-level encryption is "frequently underestimated, poorly implemented" according to security researchers -- the cryptographic library is "just the tip of the iceberg."

---

## 9. SQLite-Specific Gotchas (WAL Mode)

Directly relevant to Onyx's Rust backend using rusqlite with WAL mode:

### 9A. Checkpoint Starvation

In WAL mode, the WAL file grows as writes accumulate and only shrinks when a checkpoint runs. But checkpoints cannot complete while any connection has an open read transaction. A long-running query (e.g., a full-text search scan) blocks checkpointing, and the WAL file grows without bound.

**Symptoms:** Disk usage climbs steadily, performance degrades as the WAL file grows (reads must scan more of the WAL).

**Fix:** Keep read transactions short. Run explicit checkpoints periodically. Consider `PRAGMA wal_autocheckpoint=0` and managing checkpoints manually from a dedicated thread.

### 9B. Concurrent Auto-Checkpoints

If multiple connections have auto-checkpoint enabled (the default), they can race. Connection A starts auto-checkpoint, connection B tries its own auto-checkpoint, gets `SQLITE_BUSY` immediately (busy handler is NOT invoked for checkpoint-vs-checkpoint conflicts).

**Fix for Onyx:** Since all DB access is behind a Mutex (documented in `db.rs`), this shouldn't be an issue -- but verify that no code path opens a second connection outside the Mutex.

### 9C. Busy Handler Nuances

The busy handler behaves differently depending on the operation:
- **Writes:** busy handler is invoked, will retry
- **Passive checkpoints:** busy handler is NEVER invoked
- **Full/restart checkpoints:** busy handler is invoked for readers/writers, but NOT for competing checkpointers

---

## 10. Migration & Compatibility

### 10A. Markdown Flavor Divergence

Every app develops its own markdown dialect:
- Obsidian: `![[embed]]`, `%%comments%%`, callout syntax
- Logseq: `((block-refs))`, `{{queries}}`
- Typora: Aims for strict GFM/CommonMark superset but has small incompatibilities
- Bear: Custom syntax for highlights, nested tags

Files created in one app don't render correctly in another. The more custom syntax you add, the deeper the lock-in -- even for "plain markdown" apps.

**Onyx relevance:** Onyx uses standard wikilinks, YAML frontmatter, and `***` for block separators. The `***` choice (instead of `---`) is documented as avoiding frontmatter ambiguity. Keep tracking where Onyx diverges from CommonMark/GFM and document it.

### 10B. Frontmatter Compatibility

- YAML frontmatter is not part of CommonMark. It's a de facto standard but implementations vary.
- Some apps require the opening `---` on line 1 with no preceding whitespace. Others are lenient.
- Nested YAML structures (arrays, objects) are handled inconsistently across apps.
- `serde_yaml` (the Rust crate) is deprecated. Onyx uses `serde_yaml_ng` which is the maintained fork -- good call, but watch for parsing differences between YAML libraries.

### 10C. Round-Trip Fidelity

Opening a file from another app, making no changes, and saving should produce an identical file. In practice:
- Trailing whitespace gets stripped or added
- Line endings change (CRLF vs LF)
- Frontmatter key ordering changes (YAML doesn't guarantee key order)
- Blank lines at end of file get added or removed

Each of these causes spurious diffs in version control and can trigger unnecessary reindex.

**Onyx relevance:** Onyx's `write_file` should preserve the original line ending style. Consider a "no-op write" check: if content hasn't changed, don't write (avoids spurious watcher events and preserves `mtime`).

---

## Summary: Top 10 Lessons for Onyx

1. **Break the auto-save/file-watcher feedback loop.** Ignore watcher events that originate from your own writes. Check `mtime` before writing to detect external changes.

2. **Index incrementally, not on every startup.** Track `mtime` (and optionally content hash) to skip unchanged files. Full reindex should be a manual recovery option, not the default.

3. **Keep read transactions short in SQLite WAL mode.** Long reads block checkpointing, causing WAL file growth and performance degradation.

4. **Cache EditorState per tab, restore scroll separately.** CM6 scroll position lives in the DOM, not the state object. Restore it after `setState()` settles.

5. **External file changes must apply as transactions, not state replacements.** Replacing `EditorState` wholesale destroys undo history. Diff the external change and apply it as a transaction to preserve undo stack.

6. **Filenames are a cross-platform minefield.** Validate characters, handle case sensitivity, and test with Unicode. Don't assume what the OS allows.

7. **Tables will take 3x longer than you think.** Cell navigation, column alignment, paste handling, and format compatibility each have their own complexity budget.

8. **Don't build a custom editor engine.** MarkText's Muya is the cautionary tale. CM6 is the right foundation -- invest in extensions, not replacements.

9. **Memory profiling is not optional for long-running apps.** Tauri's JS-Rust boundary, CM6 extension lifecycle, and React component cleanup are all leak vectors. Profile during development, not after users complain.

10. **Every custom syntax decision is a lock-in decision.** Document deviations from CommonMark/GFM explicitly. Users will eventually want to leave, and their experience doing so determines your reputation.

---

## Sources

### Obsidian
- [10 Problems with Obsidian](https://medium.com/@theo-james/10-problems-with-obsidian-youll-realize-when-it-s-too-late-17e903886847)
- [Performance Issues with Large Vault (40K notes)](https://forum.obsidian.md/t/performance-issues-on-iphone-14-pro-with-large-vault-40-000-notes-using-obsidian-sync/98759)
- [Slow Performance with Large Vaults](https://forum.obsidian.md/t/slow-performance-with-large-vaults/16633)
- [Problems with Large Vaults](https://www.fabriziomusacchio.com/blog/2023-01-22-obsidian_mobile_and_large_vaults/)
- [Memory Leak After Plugin Disable](https://forum.obsidian.md/t/memory-leak-after-turning-off-plugin/48567)
- [Insane Memory Usage](https://forum.obsidian.md/t/im-having-some-insane-memory-usage-memory-leak-in-obsidian/80076)
- [Understanding iCloud Sync Issues](https://forum.obsidian.md/t/understanding-icloud-sync-issues/78186)
- [Sync Overwrites Newer Data](https://forum.obsidian.md/t/obsidian-sync-on-iphone-overwrites-newer-data-causing-data-loss/85214?page=3)
- [Vault Corruption - ANSI Characters](https://forum.obsidian.md/t/vault-corruption-ansi-characters-in-filenames/29347)
- [Filename Casing Across OSes](https://forum.obsidian.md/t/handle-filename-casing-illegal-characters-consistently-across-os-es/22543)
- [Obsidian Falling Behind Alternatives](https://www.xda-developers.com/obsidian-is-starting-to-fall-behind-alternatives/)
- [Obsidian Frustrations](https://medium.com/@michaelswengel/obsidian-is-frustrating-me-so-much-4bb43e222648)

### Notion
- [How We Made Notion Available Offline](https://www.notion.com/blog/how-we-made-notion-available-offline)
- [The Data Model Behind Notion's Flexibility](https://www.notion.com/blog/data-model-behind-notion)
- [Sharding Postgres at Notion](https://www.notion.com/blog/sharding-postgres-at-notion)
- [The Great Re-Shard](https://www.notion.com/blog/the-great-re-shard)
- [HN Discussion: Notion Data Model](https://news.ycombinator.com/item?id=27200177)

### Logseq
- [Logseq Migration Journey: Challenges and Delays](https://www.solanky.dev/p/logseq-migration-journey-challenges-delays-and-hopes)
- [Why the Database Version](https://discuss.logseq.com/t/why-the-database-version-and-how-its-going/26744)
- [Database Version: Too Drastic Choice?](https://discuss.logseq.com/t/database-version-too-drastic-choice/20346)
- [Logseq Performance Analysis](https://www.goedel.io/p/tft-performance-logseq)
- [Logseq OG vs Logseq DB](https://discuss.logseq.com/t/logseq-og-markdown-vs-logseq-db-sqlite/34608)

### Bear
- [Behind the Scenes of Bear 2](https://blog.bear.app/2023/08/behind-the-scenes-of-the-journey-to-bear-2/)
- [Get Ready for Bear 2](https://blog.bear.app/2023/07/get-ready-for-bear-2/)

### MarkText
- [Project Abandoned (GitHub Issue)](https://github.com/marktext/marktext/issues/4098)
- [Looking for Contributors (GitHub Issue)](https://github.com/marktext/marktext/issues/1290)
- [Muya Editor Engine (GitHub)](https://github.com/marktext/muya)

### Joplin
- [HN: Joplin SQLite Sync Issues](https://news.ycombinator.com/item?id=33533715)
- [Joplin Architecture](https://joplinapp.org/help/dev/spec/architecture/)
- [Recovering Lost Notes](https://github.com/laurent22/joplin/issues/1763)

### CodeMirror 6
- [Scroll Position Lost on Content Replace](https://github.com/codemirror/dev/issues/676)
- [Cursor Behavior on State Reload](https://discuss.codemirror.net/t/cursor-isnt-behaving-when-saving-and-reloading-states/3913)
- [Undo History for First Change](https://discuss.codemirror.net/t/disable-ctrl-z-undo-for-the-very-first-change/4202)

### File Watching
- [File Watcher Race Condition (Deno)](https://github.com/denoland/deno/issues/13035)
- [Race Conditions Watching File System (Atom)](https://github.com/atom/github/issues/345)
- [How to Build a File Watcher with Debouncing in Rust](https://oneuptime.com/blog/post/2026-01-25-file-watcher-debouncing-rust/view)

### SQLite WAL
- [SQLite WAL Documentation](https://sqlite.org/wal.html)
- [WAL Checkpoint Starvation](https://sqlite-users.sqlite.narkive.com/muT0rMYt/sqlite-wal-checkpoint-starved)
- [SQLite Concurrent Writes](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/)
- [Checkpoint Starvation Forum](https://sqlite.org/forum/info/7da967e0141c7a1466755f8659f7cb5e38ddbdb9aec8c78df5cb0fea22f75cf6)

### Tauri
- [Memory Leaks When Reading Files](https://github.com/tauri-apps/tauri/issues/9190)
- [Building Tauri Apps That Don't Hog Memory](https://medium.com/@hadiyolworld007/building-tauri-apps-that-dont-hog-memory-at-idle-de516dabb938)

### CRDTs & Collaboration
- [Peritext: CRDT for Rich Text (Ink & Switch)](https://www.inkandswitch.com/peritext/)
- [OT vs CRDT (TinyMCE)](https://www.tiny.cloud/blog/real-time-collaboration-ot-vs-crdt/)

### General
- [I Tried to Build My Own Markdown Editor (DEV Community)](https://dev.to/davidartifacts/i-tried-to-build-my-own-markdown-editor-and-reality-hit-hard-k8e)
- [Notable HN Discussion](https://news.ycombinator.com/item?id=23883270)
- [Syncing Notes with Obsidian](https://ergaster.org/posts/2023/08/23-syncing-notes-with-obsidian/)
