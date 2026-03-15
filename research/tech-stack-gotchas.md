# Tech Stack Gotchas & Best Practices

Research compiled March 2026 for the Onyx stack: Tauri 2 + React 18 + CodeMirror 6 + Zustand + SQLite (rusqlite) + WKWebView (macOS).

---

## 1. Tauri 2

### 1.1 WKWebView Limitations vs Chromium

**Keyboard events consumed by Cocoa text system.** On macOS, WKWebView sits inside the Cocoa responder chain. The native text input system (`interpretKeyEvents:`) intercepts certain keys before they reach JavaScript. Symptoms include:
- Delete and arrow keys producing garbage characters in text fields instead of their expected action ([Apple Developer Forums](https://developer.apple.com/forums/thread/705760))
- Standard shortcuts like Cmd+Q being swallowed by the native layer while Cmd+C/V/X/A are specially handled via `performKeyEquivalent:` ([wx-dev discussion](https://groups.google.com/g/wx-dev/c/9d5h7tt9epk))
- Dead key compositions failing silently when Safari doesn't fire `compositionend` events (CodeMirror has specific workarounds for this)

**CSS feature gaps in WebKit:**
- `backdrop-filter` requires the `-webkit-` prefix in Safari 18+, and CSS variables cannot be used with it ([mdn/browser-compat-data #25914](https://github.com/mdn/browser-compat-data/issues/25914))
- `scroll-behavior: smooth` combined with `overflow: hidden` produces no scrolling at all in Safari; programmatic `scrollTo()` is blocked when the CSS property is set ([WebKit bug #238497](https://bugs.webkit.org/show_bug.cgi?id=238497))
- CSS Containment (`contain`) is supported since Safari 15.4, so this is safe to use

**Relevance to Onyx:** The keyboard interception issue is the most critical one. CodeMirror 6 works around many WebKit quirks, but custom keybindings (especially involving dead keys or non-Latin keyboards) need testing on macOS specifically. Avoid relying on `scroll-behavior: smooth` in CSS -- use JS-based smooth scrolling instead.

### 1.2 Memory Management

**WebView memory is not directly controllable.** The WKWebView process manages its own memory, and cached data in the WebView directory grows over time with no built-in Tauri API to purge it ([Discussion #8029](https://github.com/tauri-apps/tauri/discussions/8029)).

**Memory benchmarks may be misleading.** Tauri's advertised low memory footprint can be inaccurate -- WebKit's WKWebView uses 90+ MB more than reported in some measurements because the WebContent process memory is counted separately from the app process ([Issue #5889](https://github.com/tauri-apps/tauri/issues/5889)).

**Memory leaks from IPC.** After several thousand command invocations, memory usage creeps up until GC runs. This is a known pattern with the JSON serialization layer ([Issue #9190](https://github.com/tauri-apps/tauri/issues/9190), [Issue #4026](https://github.com/tauri-apps/tauri/issues/4026)).

**Relevance to Onyx:** Given Onyx targets 30-50 MB, monitor the actual WKWebView process memory (Activity Monitor > WebContent) separately from the Tauri process. The auto-save debounce (500ms) helps limit IPC frequency, but heavy operations like `search_files` or `get_all_titles` on large vaults should be monitored.

### 1.3 IPC Overhead

**JSON serialization is the default and only built-in format.** Every `invoke()` call serializes arguments to JSON on the JS side, deserializes in Rust, then serializes the return value back. For large payloads (file contents, search results with 1000+ items), this is measurable ([Medium article](https://medium.com/@srish5945/tauri-rust-speed-but-heres-where-it-breaks-under-pressure-fef3e8e2dcb3)).

**Best practices:**
1. Batch related commands into a single Rust command (e.g., one `batch_operations` command instead of 5 sequential `invoke()` calls)
2. Return only the data the frontend needs -- don't send entire file contents when only metadata is required
3. For very large payloads, consider writing to a temp file and having the frontend read it via the fs plugin, bypassing JSON serialization
4. High-frequency events (e.g., sending data from Rust to JS at >60Hz) will overwhelm the IPC channel ([Discussion #7146](https://github.com/tauri-apps/tauri/discussions/7146))

**Relevance to Onyx:** The current architecture is sensible -- `read_file` returns string content which is inherently JSON-serializable. Watch out for `search_files` and `get_all_titles` as the vault grows. Consider pagination or streaming for results exceeding a few hundred items.

### 1.4 File System Permissions & Sandboxing

**Tauri 2 uses a capability-based permission model.** All FS access is denied by default. Permissions are scoped with glob patterns, and deny rules take precedence over allow rules ([Tauri docs: Permissions](https://v2.tauri.app/security/permissions/)).

**Key gotchas:**
- The `$HOME` scope variable resolves to the user's home directory, but nested paths need explicit glob patterns (e.g., `$HOME/Documents/**` won't match `$HOME/Documents`)
- Mac App Store builds require the `com.apple.security.app-sandbox` entitlement, which restricts file access to app-specific directories unless additional entitlements are added
- `fs.exist` has had bugs with home directory permissions ([Issue #10330](https://github.com/tauri-apps/tauri/issues/10330))

**Relevance to Onyx:** Since Onyx uses registered directories (user picks folders), the current approach of using Rust commands for all file I/O is correct. For Mac App Store distribution, the sandbox entitlements will need careful configuration to allow access to user-selected directories.

### 1.5 Auto-Updater Pitfalls

**The updater runs inside the app binary.** If the app crashes on startup, the updater never executes, leaving users stranded ([Issue #12720](https://github.com/tauri-apps/tauri/issues/12720)).

**macOS-specific issues:**
- Cross-device installation: If the app is installed on an external drive, the updater fails with "Cross-device link" because it extracts to the system temp directory and uses `rename()` which doesn't work across mount points ([plugins-workspace #2458](https://github.com/tauri-apps/plugins-workspace/issues/2458))
- App icon loss: After auto-update, the app icon may disappear in Finder's Applications view ([Issue #4613](https://github.com/tauri-apps/tauri/issues/4613))
- Network blocked in production: Sandboxed production builds can have all network access blocked despite working in dev mode ([Issue #13878](https://github.com/tauri-apps/tauri/issues/13878))
- Notarization can hang indefinitely for first-time submissions or large binaries ([Issue #14579](https://github.com/tauri-apps/tauri/issues/14579))

### 1.6 macOS-Specific Issues

**App Nap throttles timers.** When minimized, macOS App Nap will throttle JS timers (setTimeout/setInterval) after ~5 minutes, effectively pausing background work. The file watcher runs in Rust so it's unaffected, but any JS-side periodic operations (session save, debounced writes) will be delayed ([Issue #5147](https://github.com/tauri-apps/tauri/issues/5147)). Workaround: use the `macos-app-nap` crate to disable it, or ensure critical timers run in Rust.

**Window resize bugs.** Rapidly minimizing/maximizing can leave the webview permanently stuck at the wrong size, showing a black strip at the bottom. This is a wry/WKWebView layer bug with no application-level workaround -- the user must restart the app ([Issue #14843](https://github.com/tauri-apps/tauri/issues/14843)). Window management tools like Magnet can also cause the webview to not resize with the window ([Issue #6927](https://github.com/tauri-apps/tauri/issues/6927)).

**Version upgrade hangs.** A Windows-specific but notable issue: upgrading from Tauri 2.5 to 2.6+ can cause the app to hang at startup with `setup()` never being called ([Issue #14614](https://github.com/tauri-apps/tauri/issues/14614)). Pin your Tauri version and test upgrades carefully.

---

## 2. React 18 in Desktop Context

### 2.1 StrictMode Double-Render

**Effects fire twice in development.** React 18 StrictMode mounts, unmounts, then re-mounts every component to expose missing cleanup. This means:
- Every `useEffect` that calls `invoke()` will fire twice in dev mode, doubling IPC traffic
- Tauri event listeners set up in `useEffect` will be registered twice if cleanup isn't correct
- File I/O side effects (writes, creates) could execute twice

**The fix is always proper cleanup:**
```typescript
useEffect(() => {
  let unlisten: (() => void) | undefined;
  const setup = async () => {
    unlisten = await listen('event', handler);
  };
  setup();
  return () => { unlisten?.(); };
}, []);
```

**Critical async gotcha:** The `listen()` call is async, so `unlisten` may still be `undefined` when the cleanup runs if the component unmounts before the promise resolves. This causes listener leaks where the count increases with each StrictMode remount ([Issue #8913](https://github.com/tauri-apps/tauri/issues/8913)). Mitigation: track a `cancelled` flag and call `unlisten` inside the `.then()` if cancelled.

**Relevance to Onyx:** The double-render is dev-only and won't affect production. But it makes dev debugging noisy. Consider wrapping Tauri `invoke()` calls in effects that check a mounted flag, and ensure all `listen()` calls have proper async cleanup.

### 2.2 Memory Leaks in Long-Running Apps

Desktop apps run for hours or days without page refreshes. Common leak sources:
1. **Event listeners not cleaned up** -- every `listen()`, `addEventListener()`, or `ResizeObserver` must have a corresponding cleanup
2. **Closures capturing stale references** -- callbacks registered with Tauri events that close over component state will retain those references
3. **Timers** -- `setInterval` without `clearInterval` in cleanup
4. **Large data in state** -- search results, file content cached in React state that's never cleared

**Best practice:** Use `WeakRef` or `WeakMap` for caches (as Onyx already does with `viewTabIdMap`). Limit the size of in-memory caches with LRU eviction.

### 2.3 Concurrent Features Assessment

**useTransition -- potentially useful for Onyx:**
- Wrapping sidebar tree rebuilds, search result updates, or backlink panel refreshes in `startTransition` keeps the editor responsive during these operations
- Typing in the editor remains instant while expensive sidebar/panel updates are deferred
- Causes double re-renders of the transitioned components, so don't apply globally

**useDeferredValue -- useful for search/filter:**
- Wrapping the search query value in `useDeferredValue` lets the input stay responsive while results lag slightly behind
- Good fit for QuickOpen and CommandPalette

**What to avoid:**
- Don't use transitions for editor state updates -- CodeMirror owns its own state and doesn't go through React
- Don't wrap every state update in `startTransition` -- it adds overhead and complexity
- On lower-end machines, deferred updates can stack up and create perceived lag

---

## 3. CodeMirror 6

### 3.1 Extension Ordering and Priority

Extensions are flattened into a sequence. Precedence is controlled by `Prec.highest`, `Prec.high`, `Prec.default`, `Prec.low`, `Prec.lowest`. All extensions in a higher bucket come before all in a lower one. Within a bucket, array order matters.

**Key ordering rules:**
- DOM event handlers are ordered by precedence; the first handler returning `true` stops propagation
- Keymaps are checked in precedence order -- put custom keymaps at `Prec.high` or they'll be shadowed by default keymaps
- Theme base styles should be at `Prec.lowest` so user themes can override them

**Relevance to Onyx:** The `sharedExtensions` array order matters. If custom keybindings (formatting.ts, outliner.ts) don't fire, check if they're being shadowed by the default keymap. Live preview decorations need correct precedence relative to syntax highlighting.

### 3.2 Decoration Lifecycle

**RangeSetBuilder requires sorted input.** Ranges must be added in ascending order by `from` position and `startSide`. Violating this throws a cryptic error. When iterating syntax tree nodes, they're not guaranteed to be in document order -- sort first.

**Stale decorations:** Decorations provided via `EditorView.decorations` facet are recomputed on every view update. If using a `StateField` to store decorations, you must map them through document changes in the `update` method, or they'll point to wrong positions after edits.

**Direct vs indirect decorations:** Decorations that change vertical layout (widgets, line decorations with height changes) must be provided directly. Indirect decorations (via `provide: view => ...`) are only computed after the viewport is determined, which means they can't affect the viewport calculation -- use them for syntax highlighting, search matches, and similar visual-only changes.

**Relevance to Onyx:** The live preview extension (livePreview.ts) uses decorations that replace/hide content, which changes vertical layout. These must be direct decorations. The tag and wikilink highlighting extensions can safely use indirect/viewport-scoped decorations for performance.

### 3.3 Performance with Large Documents

CodeMirror 6 uses viewport-based rendering -- only visible lines are in the DOM, replaced by gap elements elsewhere. This means:
- Documents with millions of lines are handled efficiently ([CM forum](https://discuss.codemirror.net/t/large-file-loading-rendering-with-a-few-million-lines/8428))
- Long wrapped lines can cause content "popping" during scroll -- this is an accepted trade-off
- Extensions that iterate the entire document (rather than the viewport) will negate viewport optimization

**Performance rules:**
1. Decorations should be viewport-scoped where possible (`MatchDecorator` does this automatically)
2. Avoid `doc.toString()` or iterating all lines in extension code -- use `view.visibleRanges`
3. `MatchDecorator` had a bug where it rebuilt all decorations on normal edits instead of incrementally -- ensure you're on a recent version
4. State fields that store per-line data for the entire document will scale linearly with document size

### 3.4 Memory Leaks from ViewPlugins

- `EditorView.destroy()` does not automatically call `destroy()` on widget decorations -- if widgets hold references to external resources, they'll leak
- StyleModule stylesheets are created but not always recycled when views are destroyed ([discuss.codemirror.net](https://discuss.codemirror.net/t/stylemodule-memory-leak/5127))
- In Onyx's split-pane architecture with persistent `EditorView` instances, state swapping via `setState()` should properly clean up old state field references

**Relevance to Onyx:** Since Onyx caches `EditorState` per tab and swaps them into persistent views, ensure that state fields and plugins from the old state don't retain references to the view. The `editorStateCache` pattern is sound but monitor memory over time with many tab switches.

### 3.5 State Field vs Facet vs Decoration

| Mechanism | Use When | Example |
|-----------|----------|---------|
| **State Field** | You need mutable state that updates with transactions | Fold state, lint diagnostics, frontmatter range |
| **Facet** | You need computed/configured values that multiple extensions can contribute to | Theme config, tab size, read-only flag |
| **ViewPlugin** | You need access to the DOM or view lifecycle | Scroll position sync, tooltip positioning |
| **Decoration (via facet)** | You need to style/replace content | Syntax highlighting, live preview |

Don't use a StateField when a Facet suffices -- state fields are recomputed on every transaction.

### 3.6 WebKit/WKWebView-Specific Issues

- **IME composition stuck:** Safari can fail to fire `compositionend` for dead key compositions, leaving the editor stuck in composition mode. CM6 has a workaround, but it's fragile -- test with Japanese/Chinese/Korean input methods ([discuss.codemirror.net](https://discuss.codemirror.net/t/ime-is-not-working-properly-when-line-wrapping-in-safari/3250))
- **Selection handling:** CM6 uses `Selection.getComposedRanges()` on Safari for shadow DOM selection, which behaves differently from Chrome's `getSelection()`
- **iOS Safari drag handles:** Selection drag handles can go missing on iOS Safari -- relevant if Onyx ever targets iPad

---

## 4. Zustand

### 4.1 Store Splitting

**When to split:** When the store exceeds ~400 lines or when unrelated state domains cause unnecessary re-renders across components. Onyx's single `app.ts` store at 400 lines is at the threshold.

**Splitting strategies:**
1. **By domain:** `editorStore`, `sidebarStore`, `panelStore` -- each with its own selectors
2. **By update frequency:** High-frequency state (cursor position, scroll) separate from low-frequency (theme, config)
3. **Shared state via composition:** Stores can import and call actions from other stores

### 4.2 Selector Performance

**Gotcha: Object identity.** Zustand uses `Object.is` by default. Returning a new object from a selector causes re-renders even if values haven't changed:
```typescript
// BAD: creates new object every call
const { tabs, activeTab } = useStore(s => ({ tabs: s.tabs, activeTab: s.activeTab }));

// GOOD: use shallow comparison
const { tabs, activeTab } = useStore(
  s => ({ tabs: s.tabs, activeTab: s.activeTab }),
  shallow
);

// BEST: separate selectors
const tabs = useStore(s => s.tabs);
const activeTab = useStore(s => s.activeTab);
```

Individual primitive selectors are the cheapest option and cause minimal re-renders.

### 4.3 Middleware Gotchas

- **persist middleware:** `set` and `get` modified by middleware are not applied to `getState`/`setState` accessed directly from the store API -- only to the `set`/`get` inside the store creator
- **subscribeWithSelector:** Required if you want to subscribe to specific state slices outside React components. Without it, `subscribe()` fires on every state change
- **immer middleware:** Adds overhead per state update. For a store with frequent updates (cursor position, typing), immer's structural sharing may not be worth the cost

### 4.4 Zustand + React 18 Concurrent Mode

**Tearing is solved.** Zustand uses `useSyncExternalStore` under the hood, which guarantees all components in a render pass see the same state snapshot. No action needed -- this just works ([egghead.io](https://egghead.io/lessons/react-prevent-screen-tearing-for-react-18-in-a-zustand-like-app-with-usesyncexternalstore)).

**Selector stability:** Unlike the old `useMutableSource`, `useSyncExternalStore` supports unstable inline selectors without re-subscribing. No need to wrap selectors in `useCallback`.

---

## 5. SQLite via rusqlite

### 5.1 WAL Mode Gotchas

**WAL file growth:** By default, SQLite checkpoints when the WAL reaches 1000 pages. But if a long-running read transaction is open, checkpointing is blocked and the WAL grows unboundedly. In Onyx's architecture with a single connection behind a Mutex, this shouldn't happen -- but be aware if you ever add concurrent readers ([SQLite WAL docs](https://sqlite.org/wal.html)).

**Large transactions:** WAL performs poorly for transactions larger than ~100 MB and may fail with I/O errors above 1 GB. The indexer should commit in batches rather than one giant transaction.

**WAL file persistence:** The `-wal` and `-shm` files are quasi-persistent. Don't treat them as temp files -- deleting them while the database is open causes corruption.

### 5.2 Connection Pattern

**Single connection + Mutex is correct for Onyx.** Rusqlite disables SQLite's per-connection mutex because it enforces thread safety at compile time. The `Mutex<Connection>` pattern in Onyx's `AppState` is the canonical approach for Tauri apps ([Discussion #1226](https://github.com/rusqlite/rusqlite/discussions/1226)).

**Avoid connection pools for single-app use.** r2d2's default timeout closes idle connections, and when SQLite sees all connections closed, it cleans up the WAL file. If your app then tries to use a cached connection, you get errors. Stick with the single connection.

**busy_timeout:** Set `PRAGMA busy_timeout = 5000` to handle brief contention windows when the file watcher's reindex and a user-initiated query overlap.

### 5.3 Query Performance at Scale

**50K+ rows is well within SQLite's comfort zone.** With proper indexes, queries over 50K rows complete in microseconds. Key pragmas for performance:
```sql
PRAGMA journal_mode = wal;
PRAGMA synchronous = normal;    -- safe with WAL, faster than "full"
PRAGMA foreign_keys = on;
PRAGMA cache_size = -8000;      -- 8 MB page cache (default is 2 MB)
PRAGMA temp_store = memory;
```

**Index the query patterns:**
- `files(path)` -- for lookups by path
- `links(source, target)` -- for backlink queries
- `tags(file_path, tag)` -- for tag queries
- Composite indexes for `query_by_type` patterns

### 5.4 Migration Strategy

**rusqlite_migration** is the standard library. It uses SQLite's `user_version` pragma (a single integer at a fixed offset) instead of creating migration tracking tables. This is lighter and avoids the bootstrapping problem.

```rust
let migrations = Migrations::new(vec![
    M::up("CREATE TABLE files (...)"),
    M::up("ALTER TABLE files ADD COLUMN type TEXT"),
    M::up_with_hook("...", |tx| { /* complex Rust migration logic */ Ok(()) }),
]);
migrations.to_latest(&mut conn)?;
```

Migrations are append-only. Never modify an existing migration -- always add a new one.

### 5.5 Concurrent Access

**Single writer, multiple readers in WAL mode.** But since Onyx uses a single connection behind a Mutex, reads and writes are serialized anyway. This is fine for a desktop app -- the Mutex contention is negligible compared to IPC overhead.

If you ever need concurrent reads (e.g., search while indexing), you could open a second read-only connection. WAL mode allows this without blocking.

---

## 6. CSS in WebKit/WKWebView

### 6.1 Features That Work in Chrome but Not Safari/WKWebView

| Feature | Status in WebKit | Workaround |
|---------|-----------------|------------|
| `backdrop-filter` without prefix | Requires `-webkit-backdrop-filter` | Use both prefixed and unprefixed |
| CSS variables in `backdrop-filter` | Not supported in Safari 18 | Use literal values |
| `scroll-behavior: smooth` + `overflow: hidden` | Broken -- no scrolling occurs | Use JS `scrollTo({ behavior: 'smooth' })` |
| Programmatic scroll with `scroll-behavior: smooth` CSS | `scrollTop` assignment blocked | Remove CSS property, use JS-only smooth scroll |
| `:has()` selector | Supported since Safari 15.4 | Safe to use |
| CSS Containment (`contain`) | Supported since Safari 15.4 | Safe to use |
| `color-mix()` | Supported since Safari 16.2 | Safe to use |
| Container queries | Supported since Safari 16 | Safe to use |
| `@layer` | Supported since Safari 15.4 | Safe to use |

### 6.2 Font Rendering Differences

Safari/WebKit uses Core Text for font rendering on macOS, producing slightly different glyph widths and subpixel positioning than Chrome's Skia. This can cause:
- Text wrapping at different points
- Subtle alignment shifts in monospace code
- Different font-weight rendering (WebKit tends to render fonts slightly heavier)

**Mitigation:** Use `-webkit-font-smoothing: antialiased` for consistent rendering. Test with the actual target fonts (Literata, DM Sans, IBM Plex Mono) in the Tauri webview, not just Chrome.

### 6.3 Scrolling Behavior

- **Rubber-band scrolling:** WKWebView on macOS has elastic/rubber-band overscroll by default. Use `overscroll-behavior: none` on scroll containers to disable it
- **Scroll snap:** Fully supported in WebKit, but timing differs from Chrome
- **Momentum scrolling:** WebKit has native momentum scrolling in overflow containers; Chrome simulates it. The feel is different -- test both
- **Scrollbar styling:** `::-webkit-scrollbar` pseudo-elements work in both WebKit and Chrome (Chrome adopted them from WebKit). The newer `scrollbar-width` and `scrollbar-color` CSS properties are supported in Safari 18+

### 6.4 CSS Performance Considerations

- `will-change` is respected by WebKit but using it excessively increases compositing layers and memory
- `transform: translateZ(0)` hack for GPU compositing works but is less necessary in modern WebKit
- CSS animations perform equally well in WebKit and Chromium for simple transforms/opacity

---

## Summary: Top Gotchas for Onyx Specifically

Ranked by likely impact:

1. **Tauri IPC serialization cost** -- Monitor `search_files` and `get_all_titles` as vaults grow. Consider pagination or batching. (Section 1.3)

2. **WKWebView keyboard interception** -- Test all custom keybindings with non-English keyboards and dead keys. CodeMirror handles most cases but Onyx's custom shortcuts (Cmd+Option+[/]) need explicit testing. (Section 1.1)

3. **App Nap throttling timers** -- The 500ms auto-save debounce and session persistence will stall when the app is minimized for 5+ minutes. Move critical timers to Rust or disable App Nap. (Section 1.6)

4. **React useEffect async listener cleanup** -- The `listen()` promise can resolve after unmount, leaking listeners. Use a cancellation flag pattern. (Section 2.1)

5. **CodeMirror decoration ordering** -- RangeSetBuilder requires sorted ranges. Any extension that decorates out-of-order syntax tree nodes will crash. (Section 3.2)

6. **WAL file growth** -- Won't be an issue with the current single-connection Mutex pattern, but keep batch sizes reasonable in the indexer. (Section 5.1)

7. **Zustand selector identity** -- Object-returning selectors without `shallow` cause unnecessary re-renders. Prefer individual primitive selectors. (Section 4.2)

8. **WebView resize bugs** -- Rapid minimize/maximize can permanently break the webview size on macOS. No workaround exists in application code. (Section 1.6)

9. **IME composition in Safari** -- Dead key compositions can leave the editor stuck. Mostly handled by CM6, but test with Japanese/Korean input. (Section 3.6)

10. **`scroll-behavior: smooth` in CSS** -- Don't set it globally; it breaks programmatic scrolling in WebKit. Use JS-only smooth scroll. (Section 6.1)

---

## Sources

- [Tauri: Webview Versions](https://v2.tauri.app/reference/webview-versions/)
- [Tauri: IPC Concepts](https://v2.tauri.app/concept/inter-process-communication/)
- [Tauri: Permissions](https://v2.tauri.app/security/permissions/)
- [Tauri: File System Plugin](https://v2.tauri.app/plugin/file-system/)
- [Tauri: macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri: Updater Plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri Issue #14843 -- Webview stuck at wrong size](https://github.com/tauri-apps/tauri/issues/14843)
- [Tauri Issue #5147 -- App stops after minimizing](https://github.com/tauri-apps/tauri/issues/5147)
- [Tauri Issue #5889 -- Memory benchmark concerns](https://github.com/tauri-apps/tauri/issues/5889)
- [Tauri Issue #9190 -- Memory leaks reading files](https://github.com/tauri-apps/tauri/issues/9190)
- [Tauri Issue #8913 -- Unable to unlisten properly in useEffect](https://github.com/tauri-apps/tauri/issues/8913)
- [Tauri Issue #12720 -- Updater design limitations](https://github.com/tauri-apps/tauri/issues/12720)
- [Tauri Issue #14614 -- Hang upgrading to 2.6+](https://github.com/tauri-apps/tauri/issues/14614)
- [Tauri Discussion #7146 -- High-rate IPC](https://github.com/tauri-apps/tauri/discussions/7146)
- [Tauri Discussion #8029 -- WebView cache cleanup](https://github.com/tauri-apps/tauri/discussions/8029)
- [Tauri Discussion #1226 -- rusqlite connection management](https://github.com/rusqlite/rusqlite/discussions/1226)
- [Tauri + Rust performance breakdown (Medium)](https://medium.com/@srish5945/tauri-rust-speed-but-heres-where-it-breaks-under-pressure-fef3e8e2dcb3)
- [Building Tauri Apps That Don't Hog Memory (Medium)](https://medium.com/@hadiyolworld007/building-tauri-apps-that-dont-hog-memory-at-idle-de516dabb938)
- [CodeMirror: System Guide](https://codemirror.net/docs/guide/)
- [CodeMirror: Decoration Example](https://codemirror.net/examples/decoration/)
- [CodeMirror: Configuration Example](https://codemirror.net/examples/config/)
- [CodeMirror: Reference Manual](https://codemirror.net/docs/ref/)
- [CodeMirror Forum -- IME in Safari](https://discuss.codemirror.net/t/ime-is-not-working-properly-when-line-wrapping-in-safari/3250)
- [CodeMirror Forum -- StyleModule leak](https://discuss.codemirror.net/t/stylemodule-memory-leak/5127)
- [CodeMirror Forum -- Large file performance](https://discuss.codemirror.net/t/large-file-loading-rendering-with-a-few-million-lines/8428)
- [React: StrictMode docs](https://react.dev/reference/react/StrictMode)
- [React 18 useEffect double call fix](https://dev.to/jherr/react-18-useeffect-double-call-for-apis-emergency-fix-27ee)
- [React concurrent rendering performance guide](https://www.curiosum.com/blog/performance-optimization-with-react-18-concurrent-rendering)
- [useTransition performance analysis](https://www.developerway.com/posts/use-transition)
- [Zustand: useSyncExternalStore tearing prevention](https://egghead.io/lessons/react-prevent-screen-tearing-for-react-18-in-a-zustand-like-app-with-usesyncexternalstore)
- [Zustand: subscribeWithSelector discussion](https://github.com/pmndrs/zustand/discussions/1892)
- [SQLite: WAL documentation](https://sqlite.org/wal.html)
- [SQLite: Performance tuning guide](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [rusqlite_migration crate](https://cj.rs/rusqlite_migration/)
- [WebKit bug #238497 -- scroll-behavior breaks scrollTo](https://bugs.webkit.org/show_bug.cgi?id=238497)
- [Apple Developer Forums -- WKWebView keyboard input](https://developer.apple.com/forums/thread/705760)
- [mdn/browser-compat-data #25914 -- backdrop-filter prefix](https://github.com/mdn/browser-compat-data/issues/25914)
