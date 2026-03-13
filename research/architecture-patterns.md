# Architecture Patterns Research — Onyx

Research into software architecture patterns relevant to a Tauri 2 + React 18 + CodeMirror 6 + SQLite + Zustand desktop note-taking app (~9,400 LOC, single-window, split state ownership).

Compiled: 2026-03-13

---

## Table of Contents

1. [Architecture Patterns for Desktop Apps with Web Frontends](#1-architecture-patterns-for-desktop-apps-with-web-frontends)
2. [State Management Patterns](#2-state-management-patterns)
3. [Plugin-Free Extensibility](#3-plugin-free-extensibility)
4. [File-Based App Patterns](#4-file-based-app-patterns)
5. [Editor Architecture Patterns](#5-editor-architecture-patterns)
6. [Performance Patterns](#6-performance-patterns)
7. [Undo/Redo Across Boundaries](#7-undoredo-across-boundaries)

---

## 1. Architecture Patterns for Desktop Apps with Web Frontends

### 1A. Natural Boundary Architecture (Tauri's Built-In Pattern)

**What it is:** Tauri enforces a process-level split between a Rust backend (core process) and a web frontend (webview process), communicating via async message passing (JSON-RPC-like IPC). This is not MVVM or MVC — it is closer to a client-server architecture running on one machine.

**How it applies to Onyx:** Onyx already follows this naturally. Rust owns file I/O, SQLite, indexing, and the file watcher. React owns UI state, tabs, panels. The IPC boundary is the `invoke()` command system. This is the correct grain of separation for a Tauri app — trying to force MVVM or MVC across the IPC boundary adds abstraction without benefit.

**Concrete application:** Keep the current split. The Rust side is the "server" (data, file ops, indexing). The React side is the "client" (presentation, interaction). Commands are the API contract between them. Document command signatures as you would a REST API.

**Tradeoffs:**
- (+) Process isolation means a crash in the webview doesn't corrupt data
- (+) Serialization boundary forces clean contracts
- (-) Every cross-boundary call pays JSON serialization cost
- (-) Can't share types at compile time (Rust structs vs TS interfaces maintained separately)

### 1B. Hexagonal Architecture (Ports & Adapters)

**What it is:** Domain logic lives in a core that defines "ports" (trait interfaces). Infrastructure (database, filesystem, UI) implements those ports via "adapters." The domain never depends on infrastructure — dependencies point inward.

**How it applies to Onyx:** The Rust backend benefits most from this. Currently `commands.rs` calls directly into `db.rs` and filesystem functions. Hexagonal architecture would extract traits (ports) for storage and file operations, with concrete implementations (adapters) for SQLite and the local filesystem. This makes the core testable without a real database or filesystem.

**Concrete application:**
```
src-tauri/src/
  domain/          # Pure business logic, no dependencies
    note.rs        # Note entity, link extraction, frontmatter parsing
    ports.rs       # trait NoteStore, trait FileSystem, trait SearchIndex
  adapters/
    sqlite.rs      # impl NoteStore for SqliteStore
    local_fs.rs    # impl FileSystem for LocalFs
  commands.rs      # Thin layer: deserialize args -> call domain -> serialize response
```

**Tradeoffs:**
- (+) Domain logic becomes independently testable
- (+) Swapping storage (e.g., adding sync) doesn't touch domain code
- (-) More files and indirection for a ~2,100 LOC Rust backend — may be premature
- (-) Trait objects have minor runtime cost vs direct calls

**Verdict for Onyx:** Worth considering if/when adding sync or a second storage backend. At current size, the indirection cost exceeds the benefit. The natural Tauri IPC boundary already provides the most important architectural separation.

### 1C. Service-Oriented Architecture (VS Code's Pattern)

**What it is:** VS Code structures its entire codebase around services — each service owns a specific concern (editor, files, workspace, extensions). Services are resolved via a custom dependency injection system using decorators (`createDecorator()`). The instantiation service creates objects and auto-resolves their service dependencies.

**How it applies to Onyx:** Onyx is 10-50x smaller than VS Code. The full DI system is overkill. But the principle of "each concern gets a named service with a clear interface" is valuable. Currently Onyx has `fileOps.ts`, `editorBridge.ts`, `session.ts`, `commands.ts` — these are proto-services.

**Concrete application:** Formalize these as service modules with explicit interfaces, without a DI framework:
```typescript
// services/fileService.ts — single source of truth for file mutations
// services/indexService.ts — wraps Rust indexer commands
// services/sessionService.ts — tab/pane persistence
// services/editorService.ts — bridge to CM6 views
```

**Tradeoffs:**
- (+) Clear ownership of concerns
- (+) Services can be tested with mock IPC
- (-) Without actual DI, services still import each other directly
- (-) Risk of over-engineering at this scale

### 1D. Zettlr's Service Provider Pattern

**What it is:** Zettlr (Electron, CodeMirror-based note app) uses "service providers" that run in the main process and are autonomous — they boot themselves, manage their own lifecycle, and provide functionality to the rest of the app. Modules (exporter, importer) are triggered by user actions. This is a lighter-weight alternative to VS Code's DI system.

**How it applies to Onyx:** This maps well to Onyx's Rust side. The file watcher, indexer, and periodic notes system are already autonomous services. Formalizing this pattern means each service provider:
1. Has an `init()` and `shutdown()` lifecycle
2. Registers its own Tauri commands
3. Manages its own state

**Concrete application:** The `watcher.rs` already has a `Drop` impl for shutdown. Extend this pattern to indexer and periodic notes. Each module registers its commands during `setup()` rather than having a monolithic command registration.

**Tradeoffs:**
- (+) Each service owns its lifecycle — cleaner than a god `lib.rs`
- (+) Services can be enabled/disabled independently
- (-) Need to manage boot order if services depend on each other
- (-) Adds structural complexity to a small codebase

---

## 2. State Management Patterns

### 2A. Split State Ownership (Current Pattern)

**What it is:** Different systems own different slices of state. In Onyx: Zustand owns UI state (tabs, panels, panes, nav stacks), CM6 owns editor state (document content, undo history, cursor, selections), Rust/SQLite owns persistent data (file index, links, tags, bookmarks).

**How it applies to Onyx:** This is already the pattern. It works well because each system is optimized for its slice:
- CM6's immutable state + transactions are purpose-built for text editing
- Zustand is lightweight and avoids React's context re-render problems
- SQLite with WAL mode handles concurrent reads from the indexer

**Concrete application:** The key discipline is maintaining clear boundaries. The `editorBridge.ts` pattern — where Editor.tsx registers its views and external code uses the bridge API — is exactly right. The anti-pattern is reaching across boundaries (e.g., a sidebar component directly calling `view.dispatch()`).

**Tradeoffs:**
- (+) Each system handles its own concern optimally
- (+) No single store bottleneck
- (-) Synchronization between stores requires explicit coordination
- (-) Debugging requires understanding three state systems

### 2B. Command Pattern for UI Actions

**What it is:** Every user action is encapsulated as a command object with `execute()` and optionally `undo()`. Commands can be logged, replayed, batched, and bound to keyboard shortcuts or menu items. VS Code's command palette is built on this.

**How it applies to Onyx:** Onyx already has `lib/commands.ts` with a command registry used by the command palette and menu bar. This can be deepened — every meaningful user action (rename file, create note, toggle bookmark, move tab) becomes a registered command. This gives you:
- Unified keyboard shortcut binding
- Command palette discovery
- Potential undo/redo for non-editor actions
- Telemetry/debugging hooks (log every command executed)

**Concrete application:**
```typescript
interface Command {
  id: string;
  label: string;
  execute: (...args: any[]) => void | Promise<void>;
  undo?: (...args: any[]) => void | Promise<void>;
  keybinding?: string;
  when?: () => boolean; // context-dependent availability
}
```
Every feature registers commands. Menu bar items, keyboard shortcuts, and the command palette all resolve commands by ID.

**Tradeoffs:**
- (+) Single source of truth for all user-facing actions
- (+) Easy to add new actions without touching UI wiring
- (+) Commands are self-documenting (ID + label + keybinding)
- (-) Indirection cost — simple actions now go through a registry
- (-) `undo()` for file operations is complex (see Section 7)

### 2C. CQRS (Command Query Responsibility Segregation)

**What it is:** Separate the "write" path (commands that mutate state) from the "read" path (queries that fetch state). The write side can validate, transform, and persist data. The read side can denormalize and optimize for fast retrieval.

**How it applies to Onyx:** The Rust backend already has an implicit CQRS split. Write commands: `write_file`, `rename_file`, `trash_file`, `update_frontmatter`, `toggle_bookmark`. Read queries: `search_files`, `get_backlinks`, `get_all_tags`, `list_directory`. Making this explicit helps reason about:
- Which commands trigger reindexing
- Which queries can be cached on the frontend
- Which operations need to invalidate frontend caches

**Concrete application:** Categorize Tauri commands into two groups. Writes go through `fileOps.ts` which handles the full mutation sequence (disk -> DB -> UI sync). Reads can be cached in Zustand or a query cache, invalidated by file watcher events.

**Tradeoffs:**
- (+) Clear mental model for data flow
- (+) Read path can be aggressively cached
- (+) Write path can enforce invariants in one place
- (-) Adds conceptual overhead for a single-user desktop app
- (-) The "eventual consistency" concern of CQRS doesn't apply (no distributed system)

### 2D. Zustand Store Splitting

**What it is:** Instead of one monolithic Zustand store, split into domain-specific stores. Zustand officially recommends a single store with slices, but multiple stores work when domains are independent.

**How it applies to Onyx:** The current single store (`app.ts`, ~400 lines) handles tabs, panels, panes, cursor, navigation, and commands. As features grow, consider splitting:
- `useTabStore` — tabs, active tab, tab order
- `useLayoutStore` — sidebar, context panel, pane split
- `useNavStore` — navigation stacks per tab
- `useCommandStore` — command registry (or keep outside Zustand entirely)

**Concrete application:** Only split if the store exceeds ~600-800 lines or if unrelated state changes cause unnecessary re-renders. Use Zustand's selector pattern (`useStore(s => s.activeTab)`) to minimize re-renders before splitting.

**Tradeoffs:**
- (+) Smaller stores are easier to reason about
- (+) Independent stores avoid cross-domain re-renders
- (-) Cross-store coordination requires explicit pub/sub
- (-) Splitting too early fragments the mental model

---

## 3. Plugin-Free Extensibility

### 3A. Registry Pattern

**What it is:** A central registry where features register themselves. The app core doesn't know about specific features — it only knows about the registry interface. Features self-register during initialization.

**How it applies to Onyx:** This is ideal for a no-plugin app that still needs to be extensible. Onyx already uses this for commands. Extend it to:
- **CM6 extensions:** An extension registry where each feature (wikilinks, tags, formatting, linting, live preview) registers its extensions. The editor pulls from the registry at mount time.
- **Context panel sections:** Each section (calendar, backlinks, properties, outline, recent docs) registers itself with metadata (label, icon, default collapsed state).
- **File type handlers:** Register handlers for different frontmatter `type` values.
- **Sidebar actions:** Register context menu items from individual feature modules.

**Concrete application:**
```typescript
// Extension registry
const editorExtensions = createRegistry<() => Extension[]>();
// In wikilinks.ts:
editorExtensions.register('wikilinks', () => [wikilinksExtension()]);
// In Editor.tsx:
const extensions = editorExtensions.getAll().flatMap(fn => fn());
```

**Tradeoffs:**
- (+) New features plug in without modifying core components
- (+) Features can be toggled by including/excluding from registry
- (+) Testing: register only the extensions under test
- (-) Indirection — harder to trace what's active by reading code
- (-) Registration order can matter (e.g., keymap priority)

### 3B. Composition Root

**What it is:** All wiring happens in one place (the "composition root"), typically near the app entry point. Individual modules export functions/classes but don't wire themselves together. The composition root imports everything and assembles the dependency graph.

**How it applies to Onyx:** `App.tsx` is already a partial composition root — it registers commands, sets up keyboard shortcuts, and handles menu events. Making this more explicit means moving all "wiring" code out of individual components and into a dedicated initialization phase.

**Concrete application:**
```typescript
// init.ts — composition root
export function initApp() {
  const commands = createCommandRegistry();
  registerFileCommands(commands);
  registerEditorCommands(commands);
  registerNavigationCommands(commands);

  const extensions = createExtensionRegistry();
  registerWikilinks(extensions);
  registerTags(extensions);
  registerFormatting(extensions);
  // ...

  return { commands, extensions };
}
```

**Tradeoffs:**
- (+) One place to see everything that's wired up
- (+) Easy to reorder, toggle, or replace features
- (-) All imports pulled into one file — large import graph
- (-) Doesn't work well if wiring depends on runtime conditions

### 3C. React Context as Lightweight DI

**What it is:** React's Context API provides a built-in dependency injection mechanism. Instead of components importing services directly, they receive them via context. This allows swapping implementations for testing or different modes.

**How it applies to Onyx:** Useful for services that components need without prop drilling: the command registry, the editor bridge, the file operations service. Not useful for high-frequency state (that's Zustand's job).

**Concrete application:**
```typescript
const ServiceContext = createContext<{
  commands: CommandRegistry;
  fileOps: FileOpsService;
  editor: EditorBridge;
}>(null!);

// In App.tsx:
<ServiceContext.Provider value={services}>
  <AppLayout />
</ServiceContext.Provider>

// In any component:
const { commands } = useServices();
```

**Tradeoffs:**
- (+) Components are decoupled from concrete implementations
- (+) Testing can provide mock services
- (-) Context doesn't work outside React (Rust commands, CM6 extensions)
- (-) Adds a layer when direct imports would be simpler

---

## 4. File-Based App Patterns

### 4A. Atomic Write (Temp + Rename)

**What it is:** Write to a temporary file in the same directory, then `rename()` to the target path. Since `rename()` is atomic at the filesystem level (on POSIX), this prevents partial/corrupt writes on crash.

**How it applies to Onyx:** Onyx already does this — the CLAUDE.md notes "Atomic writes (temp + rename)." This is the correct baseline pattern.

**Important caveat (from Dan Luu's "Files Are Hard"):** `rename()` is atomic with respect to concurrent access, but it is NOT necessarily atomic on crash. On ext4 (Linux), data written to the temp file may not be on disk when `rename()` completes unless you `fsync()` the file first. The full crash-safe sequence is:

1. Write to temp file in same directory
2. `fsync()` the temp file
3. `rename()` temp to target
4. `fsync()` the parent directory

**Concrete application:** In `commands.rs`, verify the write_file command follows the full four-step sequence. If using `std::fs::write()` (which doesn't fsync), switch to manual open/write/fsync/rename.

**Tradeoffs:**
- (+) Prevents corrupt files on crash
- (+) Readers always see complete old or complete new content
- (-) Two fsyncs per write — measurable latency (~1-5ms on SSD, more on HDD)
- (-) The 500ms debounce already batches writes, so the per-save cost is acceptable

### 4B. Write-Ahead Log (SQLite WAL)

**What it is:** SQLite's WAL mode writes changes to a sequential log file, then asynchronously checkpoints back to the main database. Readers read from the main DB + WAL concurrently with writers.

**How it applies to Onyx:** Already in use (`db.rs` sets WAL mode). Key properties:
- Multiple readers (UI queries) can run concurrently with one writer (indexer)
- WAL mode + `synchronous = NORMAL` avoids fsync on most transactions
- Checkpointing happens automatically but can be triggered manually

**Dedicated writer pattern:** Since Onyx has one writer (the indexer/watcher thread) and one reader (the UI thread via commands), the natural pattern is correct. If you ever add more writers, queue writes through a single channel to avoid WAL contention.

**Tradeoffs:**
- (+) Concurrent read/write — UI never blocks on indexer
- (+) Crash recovery is automatic (SQLite replays the WAL)
- (-) WAL file can grow if a long-running read prevents checkpointing
- (-) WAL mode uses slightly more memory than rollback journal

### 4C. File Watcher Debouncing

**What it is:** File watchers (like `notify` in Rust) fire events rapidly during saves (create temp, write, rename, etc.). Debouncing collects events over a window and processes them in batch.

**How it applies to Onyx:** Already implemented with a 3-second debounce in `watcher.rs`. The key subtleties:

- **Self-change detection:** When Onyx writes a file, the watcher fires. Need to distinguish "our save" from "external change" (editor, git pull, etc.). Common approaches: keep a set of recently-written paths with timestamps, or use a write token that the watcher checks.
- **Batch processing:** The 3-second window should collect all changed paths, then reindex them in one batch rather than individually.
- **Ordering:** If a file is created then immediately renamed (atomic write pattern), the watcher may fire both events. The debounce window should collapse these to a single "file changed" event on the final path.

**Tradeoffs:**
- (+) Prevents redundant reindexing
- (+) Coalesces rapid changes (e.g., git checkout switching many files)
- (-) 3-second delay before index reflects changes
- (-) Edge case: user creates file, immediately searches — may not find it

### 4D. Conflict Detection for External Changes

**What it is:** When an external process (another editor, git, sync tool) modifies a file that's open in the app, the app detects the conflict and either auto-reloads or prompts the user.

**How it applies to Onyx:** The file watcher detects external changes. The question is what to do:

1. **If the editor has unsaved changes:** Prompt user ("File changed on disk. Reload and lose changes, or keep your version?")
2. **If the editor matches disk:** Silent reload
3. **Hybrid:** Show a notification bar in the editor ("File changed externally") with reload button

**Concrete application:** Compare the in-memory content hash with the on-disk content hash. If they differ and the editor has unsaved changes (dirty flag), show a conflict UI. If the editor is clean, silently reload.

**Tradeoffs:**
- (+) Prevents silent data loss
- (+) Enables workflows with external tools (git, other editors)
- (-) Interrupts the user's flow
- (-) Hash comparison on every watcher event adds CPU cost

---

## 5. Editor Architecture Patterns

### 5A. CM6 Extension Composition

**What it is:** CM6 extensions are composed from primitives: state fields (state), view plugins (DOM side effects), facets (configuration), decorations (visual modifications), and keymaps. A feature is typically a function that returns an array of these primitives bundled together.

**How it applies to Onyx:** Each file in `src/extensions/` follows this pattern already. The key architectural principle: **each extension should be a self-contained feature function that returns `Extension[]`**. Extensions should not import from each other — shared data flows through facets or state fields.

**Best practice for large apps:**
```typescript
// wikilinks.ts
export function wikilinks(config?: WikilinkConfig): Extension[] {
  return [
    wikilinksStateField,
    wikilinksDecoration,
    wikilinksKeymap,
    wikilinksTheme,
  ];
}
```

**Tradeoffs:**
- (+) Extensions are independently testable
- (+) Can be toggled on/off by including/excluding from the extensions array
- (-) Cross-extension communication requires shared facets, which adds indirection
- (-) Extension ordering in keymaps matters and can cause subtle bugs

### 5B. Viewport-Aware Decorations

**What it is:** CM6 only renders the visible viewport plus a margin. Decorations that only affect appearance (syntax highlighting, search matches) should only compute for the visible range. Decorations that affect layout (block widgets, line replacements) must be provided directly (not via `provide`).

**How it applies to Onyx:** The `tags.ts` extension is already noted as "viewport-aware." The `livePreview.ts` extension (370 lines) does heading/bold/italic/checkbox rendering — these are layout-affecting decorations that must be computed eagerly.

**Performance rule of thumb:**
- **Syntax highlighting, tag coloring, wikilink styling:** Use `ViewPlugin` with `PluginField.decorations`, compute only for visible ranges
- **Block widgets, heading collapse, checkbox replacement:** Use `StateField` with `provide: f => EditorView.decorations.from(f)`, compute for full document
- **Hybrid (live preview):** Compute replacements only for visible range, but provide them directly since they affect line height

**Tradeoffs:**
- (+) Viewport-aware decorations scale to documents of any size
- (+) Only visible content pays the decoration cost
- (-) Decorations must be rebuilt on scroll (but CM6 handles this efficiently)
- (-) Edge case: decorations at viewport boundary can flash during fast scrolling

### 5C. State Field vs View Plugin Decision Framework

**What it is:** CM6 offers two main extension points — state fields (pure, functional, part of the state transaction cycle) and view plugins (imperative, has access to DOM and viewport). Choosing correctly prevents performance issues and state bugs.

**Decision rules:**
| Use Case | Use State Field | Use View Plugin |
|---|---|---|
| Persistent data across transactions | Yes | No |
| DOM manipulation | No | Yes |
| Decoration that affects layout | Yes (with `provide`) | No |
| Decoration for visible range only | No | Yes |
| Event listeners (click, scroll) | No | Yes |
| Undo-able state | Yes | No |
| External async data (autocomplete results) | No | Yes |

**How it applies to Onyx:**
- `frontmatter.ts` (folding state) — State field: correct
- `livePreview.ts` (decorations) — Needs both: state field for replacing decorations, view plugin for cursor-aware behavior
- `autocomplete.ts` — View plugin: correct (async data from Rust)
- `linting.ts` — State field: correct (lint results persist across edits)

**Tradeoffs:**
- (+) Correct choice prevents state synchronization bugs
- (+) State fields are deterministic and replayable
- (-) View plugins can't participate in transactions
- (-) Mixing both for one feature increases complexity

### 5D. Editor Bridge Pattern (Avoiding the God Component)

**What it is:** Instead of putting all editor logic in a single React component, extract an imperative API layer (the "bridge") that external code uses to interact with the editor. The React component only handles mounting/unmounting and forwarding props.

**How it applies to Onyx:** Already implemented via `editorBridge.ts` + `Editor.tsx`. The bridge provides `scrollToLine()`, `insertAtCursor()`, `replaceTabContent()`, etc. External consumers (sidebar, context panel, command palette) import from the bridge, never from Editor.tsx directly.

**Extension of the pattern:** The bridge can also be the single point where CM6 state changes are observed and forwarded to Zustand:
```typescript
// In editorBridge.ts
export function onEditorStateChange(callback: (update: ViewUpdate) => void) {
  // registers an updateListener that calls back to Zustand/services
}
```

**Tradeoffs:**
- (+) Editor.tsx stays focused on CM6 lifecycle, not app logic
- (+) Bridge API is stable even as editor internals change
- (+) External code can be tested with a mock bridge
- (-) Another abstraction layer to maintain
- (-) Bridge must be kept in sync with actual CM6 capabilities

---

## 6. Performance Patterns

### 6A. Sidebar Virtualization

**What it is:** Only render the file tree nodes visible in the viewport. As the user scrolls, mount/unmount nodes dynamically. Libraries: react-window (lightweight, fixed-height items), react-virtuoso (variable-height, more features), react-vtree (tree-specific, built on react-window).

**How it applies to Onyx:** The sidebar (`Sidebar.tsx`, ~460 lines) renders the full file tree. For a Zettelkasten with 5,000+ files across multiple directories, this means 5,000+ DOM nodes. At ~1,000 files, React renders fine. At 5,000+, initial mount and re-renders become noticeable.

**Concrete application:** react-vtree is purpose-built for tree virtualization:
```typescript
import { FixedSizeTree } from 'react-vtree';

// Flatten tree to iterable, render only visible nodes
<FixedSizeTree
  treeWalker={treeWalker}
  itemSize={28}  // each row height
  height={sidebarHeight}
  width={sidebarWidth}
>
  {FileTreeNode}
</FixedSizeTree>
```

**When to implement:** Profile with a real Zettelkasten. If sidebar mount time exceeds ~50ms or scrolling stutters, virtualize.

**Tradeoffs:**
- (+) O(viewport) DOM nodes instead of O(total files)
- (+) Consistent performance regardless of file count
- (-) Adds dependency and complexity
- (-) Fixed row height assumption may conflict with rename-in-place UX
- (-) Keyboard navigation (arrow keys through tree) needs custom handling

### 6B. Search Result Streaming

**What it is:** Instead of waiting for all search results before showing any, stream results to the UI as they're found. Tauri channels support this natively.

**How it applies to Onyx:** `search_files` currently returns `Vec<SearchResult>` — the frontend waits for the full result. For large vaults, this can take 500ms+. Using a Tauri channel, results appear incrementally.

**Concrete application:**
```rust
#[tauri::command]
async fn search_files_stream(query: String, channel: Channel<SearchResult>) {
    // Send results as they're found
    for result in search_iter(&query) {
        channel.send(result).unwrap();
    }
}
```

**Tradeoffs:**
- (+) Perceived performance — user sees results instantly
- (+) Can cancel search early if user types a new query
- (-) Ordering: results arrive in discovery order, not relevance order
- (-) More complex frontend state (accumulating partial results)

### 6C. Memoization and Selector Patterns

**What it is:** Use Zustand selectors to subscribe to specific state slices, preventing re-renders when unrelated state changes. Use `React.memo` on components that receive stable props. Use `useMemo`/`useCallback` only where profiling shows re-renders are costly.

**How it applies to Onyx:** Key areas to check:
- `TabBar.tsx` re-renders on any store change? Should only re-render on tab changes.
- `Sidebar.tsx` re-renders on cursor position changes? Should only re-render on file tree changes.
- `StatusBar.tsx` re-renders on tab order changes? Should only re-render on active tab/cursor changes.

**Concrete application:**
```typescript
// Bad: subscribes to entire store
const store = useAppStore();

// Good: subscribes only to needed slice
const tabs = useAppStore(s => s.tabs);
const activeTab = useAppStore(s => s.activeTab);
```

**Tradeoffs:**
- (+) Fine-grained subscriptions eliminate unnecessary re-renders
- (+) No library needed — built into Zustand
- (-) Too many selectors can fragment the mental model
- (-) Selectors that compute derived values should use `useShallow` or external memoization

### 6D. Lazy Extension Loading

**What it is:** Don't load all CM6 extensions at mount time. Load expensive extensions (autocomplete, linting, live preview) on demand or after initial render.

**How it applies to Onyx:** The `sharedExtensions` array is built once on first mount. If an extension is expensive to initialize (e.g., autocomplete fetching all tags from Rust), it can be loaded after the editor is visible:

```typescript
// Mount with core extensions
const coreExtensions = [basicSetup, keymap, theme];

// After mount, add heavy extensions via compartment
const autocompleteCompartment = new Compartment();
// Initially empty:
autocompleteCompartment.of([])
// After data loads:
view.dispatch({
  effects: autocompleteCompartment.reconfigure(autocompleteExtension())
});
```

**Tradeoffs:**
- (+) Faster initial editor mount
- (+) Extensions load only when their data is ready
- (-) Compartment management adds complexity
- (-) User may notice features "appearing" after a delay

### 6E. Index Query Caching

**What it is:** Cache the results of expensive Rust queries (backlinks, tags, search) on the frontend, invalidated by file watcher events.

**How it applies to Onyx:** Every time the context panel renders, it calls `get_backlinks(path)`. If the user switches between two tabs rapidly, this fires repeatedly for the same paths. A simple cache with TTL or event-based invalidation prevents redundant IPC calls.

**Concrete application:**
```typescript
const queryCache = new Map<string, { data: any; timestamp: number }>();

async function cachedInvoke<T>(cmd: string, args: any, ttlMs = 5000): Promise<T> {
  const key = `${cmd}:${JSON.stringify(args)}`;
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.timestamp < ttlMs) return cached.data;
  const result = await invoke<T>(cmd, args);
  queryCache.set(key, { data: result, timestamp: Date.now() });
  return result;
}

// On file watcher event: clear relevant cache entries
listen('file-changed', (event) => {
  // Invalidate backlinks, tags, search results for changed files
});
```

**Tradeoffs:**
- (+) Eliminates redundant IPC calls
- (+) Context panel feels instant on tab switch
- (-) Stale data if invalidation logic is incomplete
- (-) Memory grows with cache size (bound it or use LRU)

---

## 7. Undo/Redo Across Boundaries

### 7A. Scoped Undo (Current Approach)

**What it is:** Each system manages its own undo history. CM6 handles editor undo natively (per-document undo stack). File operations (rename, delete, move) have no undo. Sidebar state changes have no undo.

**How it applies to Onyx:** This is the current behavior and is the correct default for most note-taking apps. Obsidian works this way — Cmd+Z undoes editor changes, but renaming a file is permanent (though files go to OS trash on delete).

**Tradeoffs:**
- (+) Simple, predictable, well-tested (CM6's undo is battle-hardened)
- (+) No cross-system coordination needed
- (-) User can't undo a rename or property change with Cmd+Z
- (-) Discrepancy: some actions feel like they should be undoable but aren't

### 7B. Compound Command Pattern

**What it is:** When an operation spans multiple systems (e.g., "rename file" changes the filename on disk, updates all wikilinks in other files, renames the tab, updates the sidebar), encapsulate the entire operation as a compound command that can record the state before and after, enabling reversal.

**How it applies to Onyx:** File rename is the most complex cross-boundary operation. A compound command for rename would:
1. Record the old path, new path, and all affected wikilinks
2. Execute the rename (disk + DB + tabs + editor caches + sidebar)
3. On undo: rename back, restore old wikilinks, refresh UI

**Concrete application:**
```typescript
interface UndoableOperation {
  description: string;
  execute: () => Promise<void>;
  undo: () => Promise<void>;
}

class OperationHistory {
  private past: UndoableOperation[] = [];
  private future: UndoableOperation[] = [];

  async execute(op: UndoableOperation) {
    await op.execute();
    this.past.push(op);
    this.future = [];
  }

  async undo() {
    const op = this.past.pop();
    if (op) {
      await op.undo();
      this.future.push(op);
    }
  }
}
```

**Tradeoffs:**
- (+) User can undo file renames, property changes, bookmark toggles
- (+) Single undo stack for the entire session
- (-) Every undoable operation must implement both execute and undo
- (-) Undo for file operations is fragile (what if external changes happened?)
- (-) Interleaving editor undo (CM6) with app undo (operation history) is confusing

### 7C. Snapshot-Based Undo

**What it is:** Before executing a cross-boundary operation, take a snapshot of affected state. On undo, restore the snapshot. Used in Microsoft's patent for undo/redo across multiple files in Visual Studio.

**How it applies to Onyx:** Simpler than compound commands for certain operations. For example, before changing frontmatter via the properties panel:
1. Snapshot the current file content
2. Apply the change
3. On undo: write the snapshot content back and reload editor state

**Tradeoffs:**
- (+) Simpler implementation — just save/restore data
- (+) Works for any operation without writing custom undo logic
- (-) Memory cost of storing snapshots
- (-) Snapshot of a large file on every property edit is wasteful
- (-) Doesn't compose well — what if two snapshots overlap?

### 7D. Practical Recommendation for Onyx

For a ~9,400 LOC app, the pragmatic approach:

1. **Editor undo:** CM6 handles this. Don't interfere.
2. **File delete:** Goes to OS trash (already implemented). That IS your undo.
3. **File rename:** Consider a simple undo buffer — store the last N rename operations with old/new paths. If the user triggers undo within 10 seconds and the editor is on the renamed file, offer to undo the rename.
4. **Property changes (frontmatter):** Since the properties panel writes through `update_frontmatter` which calls `replaceTabContent()`, the CM6 undo stack captures the change. Cmd+Z in the editor undoes the property change. This already works if the property panel pushes changes as CM6 transactions.
5. **Everything else (bookmark toggle, tab operations, panel resize):** Not undoable. Users don't expect undo for these.

**Verdict:** Full cross-boundary undo is a Phase 10+ feature. For now, ensuring property panel changes go through CM6 transactions gives you undo for the most common case where users expect it.

---

## Summary of Recommendations by Priority

### High Priority (worth doing now or next phase)

| # | Pattern | Why |
|---|---------|-----|
| H1 | Command Pattern (2B) | Already started with command registry. Deepening this unifies keyboard shortcuts, menu bar, and command palette with minimal new code. |
| H2 | Registry Pattern (3A) | Extend the existing command registry concept to CM6 extensions and context panel sections. Makes features toggleable and testable. |
| H3 | Zustand Selectors (6C) | Free performance win. Audit existing store subscriptions, use fine-grained selectors. No new dependencies. |
| H4 | Index Query Caching (6E) | Simple Map-based cache with event invalidation. Eliminates redundant IPC on tab switching. |

### Medium Priority (when hitting pain points)

| # | Pattern | When |
|---|---------|------|
| M1 | Sidebar Virtualization (6A) | When file tree exceeds ~2,000 nodes and mount time > 50ms |
| M2 | Zustand Store Splitting (2D) | When `app.ts` exceeds ~600 lines or re-render profiling shows cross-domain issues |
| M3 | Composition Root (3B) | When `App.tsx` wiring code exceeds ~100 lines of init logic |
| M4 | Conflict Detection (4D) | When users report data loss from external file changes |
| M5 | Search Streaming (6B) | When search latency exceeds ~300ms for typical queries |

### Low Priority (architectural investment for future scale)

| # | Pattern | When |
|---|---------|------|
| L1 | Hexagonal Architecture in Rust (1B) | When adding sync, a second storage backend, or comprehensive Rust tests |
| L2 | Service Provider Pattern (1D) | When Rust `lib.rs` becomes hard to navigate (currently 189 lines — fine) |
| L3 | Compound Undo (7B) | Phase 10+ or if users frequently request undo for renames |
| L4 | Lazy Extension Loading (6D) | When editor mount time exceeds ~100ms on cold start |
| L5 | CQRS formalization (2C) | When adding sync or collaborative features |

---

## Sources

### Architecture & Tauri
- [Tauri Architecture](https://v2.tauri.app/concept/architecture/)
- [Tauri Process Model](https://v2.tauri.app/concept/process-model/)
- [Tauri IPC](https://v2.tauri.app/concept/inter-process-communication/)
- [Tauri Calling Rust from Frontend](https://v2.tauri.app/develop/calling-rust/)
- [Tauri IPC and Frontend-Backend Communication (DeepWiki)](https://deepwiki.com/tauri-apps/tauri/3-ipc-and-communication)

### VS Code Architecture
- [VS Code Service Initialization and DI (DeepWiki)](https://deepwiki.com/microsoft/vscode/4.2-service-initialization-and-dependency-injection)
- [VS Code Architecture Overview (SkyWork)](https://skywork.ai/skypage/en/VS-Code-Architecture-Overview/1977611814760935424)
- [VS Code Source Code Organization (GitHub Wiki)](https://github.com/microsoft/vscode/wiki/Source-Code-Organization/b99eb8a107bcb78d61fd9de2ec2996a39cfb0662)
- [VS Code DI System (DEV Community)](https://dev.to/ryankolter/vscode-1-dependency-injectiondi-system-1f95)
- [Understanding VS Code Architecture (Medium)](https://franz-ajit.medium.com/understanding-visual-studio-code-architecture-5fc411fca07)

### Zettlr & Obsidian
- [Zettlr GitHub Repository](https://github.com/Zettlr/Zettlr)
- [Obsidian Workspace Docs](https://docs.obsidian.md/Plugins/User+interface/Workspace)
- [Obsidian Plugin Architecture (DeepWiki)](https://deepwiki.com/obsidianmd/obsidian-api/3-plugin-development)

### Hexagonal Architecture
- [Hexagonal Architecture in Rust (Cogs and Levers)](http://tuttlem.github.io/2025/08/31/hexagonal-architecture-in-rust.html)
- [Master Hexagonal Architecture in Rust (HowToCodeIt)](https://www.howtocodeit.com/guides/master-hexagonal-architecture-in-rust)
- [Hexagonal Architecture and Clean Architecture with Examples (DEV Community)](https://dev.to/dyarleniber/hexagonal-architecture-and-clean-architecture-with-examples-48oi)
- [Hexagonal Architecture as Solution to UI Framework Obsolescence](https://thekitchen.gitlab.io/en/post/frontend-hexagonal-architecture/)

### CodeMirror 6
- [CM6 System Guide](https://codemirror.net/docs/guide/)
- [CM6 Decoration Example](https://codemirror.net/examples/decoration/)
- [CM6 Introduction to Basics (Forum)](https://discuss.codemirror.net/t/an-introduction-to-the-basics-of-codemirror-6/7120)
- [CodeMirror and React (Trevor Harmon)](https://thetrevorharmon.com/blog/codemirror-and-react/)
- [View Plugin vs State Field (Obsidian Forum)](https://forum.obsidian.md/t/codemirror-view-plugin-vs-state-field-for-inline-replacements/78108)

### State Management
- [Event Sourcing (Martin Fowler)](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Event Sourcing Pattern (Azure)](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [Zustand Store Splitting (GitHub Discussion)](https://github.com/pmndrs/zustand/discussions/2496)
- [Working with Zustand (TkDodo)](https://tkdodo.eu/blog/working-with-zustand)
- [Splitting the Store into Slices (Zustand Wiki)](https://github.com/pmndrs/zustand/wiki/Splitting-the-store-into-separate-slices)

### File Operations & Crash Safety
- [Files Are Hard (Dan Luu)](https://danluu.com/file-consistency/)
- [SQLite WAL Mode](https://sqlite.org/wal.html)
- [SQLite Optimizations for Ultra High Performance (PowerSync)](https://www.powersync.com/blog/sqlite-optimizations-for-ultra-high-performance)
- [Atomically (npm library for atomic file writes)](https://github.com/fabiospampinato/atomically)

### Performance & Virtualization
- [React Virtualization: react-window vs react-virtuoso (DEV Community)](https://dev.to/sanamumtaz/react-virtualization-react-window-vs-react-virtuoso-8g)
- [Building a High Performance Directory Component (DEV Community)](https://dev.to/jdetle/memoization-generators-virtualization-oh-my-building-a-high-performance-directory-component-in-react-3efm)
- [React Performance Optimization Best Practices 2025 (DEV Community)](https://dev.to/alex_bobes/react-performance-optimization-15-best-practices-for-2025-17l9)

### Undo/Redo
- [Undo/Redo Implementations in Text Editors (mattduck)](https://www.mattduck.com/undo-redo-text-editors)
- [You Don't Know Undo/Redo (DEV Community)](https://dev.to/isaachagoel/you-dont-know-undoredo-4hol)
- [Creating Undo-Redo with Command Pattern in React (DEV Community)](https://dev.to/mustafamilyas/creating-undo-redo-system-using-command-pattern-in-react-mmg)
- [VS Code Multi-File Undo Issue (GitHub)](https://github.com/microsoft/vscode/issues/638)
- [Undo/Redo Architecture Across Multiple Files (Patent)](https://patents.google.com/patent/US7823060B2/en)

### Dependency Injection & Extensibility
- [Registry Pattern (GeeksforGeeks)](https://www.geeksforgeeks.org/system-design/registry-pattern/)
- [Function Registry Pattern in React (iO TechHub)](https://techhub.iodigital.com/articles/function-registry-pattern-react)
- [Registry (Martin Fowler)](https://martinfowler.com/eaaCatalog/registry.html)
- [React Context for DI, Not State (Test Double)](https://testdouble.com/insights/react-context-for-dependency-injection-not-state-management)
- [DI in React (CodeDrivenDevelopment)](https://codedrivendevelopment.com/posts/dependency-injection-in-react)

### Local-First Software
- [Local-First Software (Ink & Switch)](https://www.inkandswitch.com/essay/local-first/)
- [Local-First Software Architecture Guide (TechBuzzOnline)](https://techbuzzonline.com/local-first-software-architecture-guide/)
- [Offline-First Architecture (Medium)](https://medium.com/@jusuftopic/offline-first-architecture-designing-for-reality-not-just-the-cloud-e5fd18e50a79)
