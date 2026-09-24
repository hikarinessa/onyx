# Canvas: an offline thinking board that shows your notes

**Status:** Draft, 2026-09-24. Supersedes #35 (read-only viewer).
**Tier:** XL (about 30 files across Rust and TypeScript). Needs explicit approval before implementation.

## Why

Thinking on a board happens in Miro today: it is online, it lives apart from the notes, and nothing on a board can point at a note. Onyx already holds the notes, and the existing Obsidian canvases (a year-review board per year, plus a handful of topic boards) cannot be opened in it at all. A canvas file type in Onyx gives one offline place to cluster ideas, map concepts, lay out timelines and assemble year reviews next to the notes they draw from.

## Success Criteria

- **SC1.** Every existing `.canvas` file opens in Onyx and reads as it did in Obsidian: text cards render their markdown, a text card holding `![[monthly-note#Section]]` shows that section of the note live, file cards pointing at images show the image, file cards pointing at notes show the note.
- **SC2.** A concept-map board (stickies joined by labelled, solid and dashed curved edges) and a timeline board (stickies clustered along labelled columns, minus freestanding lines) can be built in Onyx from scratch without switching to Miro.
- **SC3.** In either input mode (mouse or trackpad, chosen in Settings), navigation feels like Miro to the user: in mouse mode the wheel zooms at the pointer and right- or middle-drag pans; in trackpad mode two-finger scroll pans and pinch zooms.
- **SC4.** Text on a canvas (stickies, cards, labels, edge labels, frame labels) is found by full-text search, and choosing a result opens the canvas centred on that item.
- **SC5.** A note placed on a canvas lists that canvas in its backlinks.

## Measurement

Omitted: personal app, no telemetry.

## Behavioral Invariants

- **I1.** Opening, panning, zooming or selecting on a canvas never writes the file. Only an edit to the board's content does.
- **I2.** Nothing done on a canvas writes to a note. Note cards are read-only views.
- **I3.** A canvas save is refused when the file changed on disk since it was read, and the user is told (status bar conflict prompt), the same protection notes have. The canvas save path must not repeat #124.
- **I4.** Notes behave exactly as before. Backlinks only gain canvas entries; Quick Open only gains canvas files.
- **I5.** The largest existing canvas (98 items, 76 of them photos) pans and zooms without visible stutter.
- **I6.** An imported Obsidian canvas loses no data on save: every node, edge and unknown field it had is written back.
- **I7.** Every change to the board (add, delete, move, resize, restyle, edit text, connect) can be undone and redone with Cmd+Z / Cmd+Shift+Z.

## Scope

The first release ships viewer and editor together. The work is still ordered into slices that each have their own test, so progress is checkable before the whole lands.

**In:**
- **P1. File type and viewer.** `.canvas` files are listed in the tree, watched, opened in a tab, restored with the session. The board renders every JSON Canvas node type (text → markdown card, file → note card or image, link → link card, group → frame) and every edge (side-anchored curves, arrowheads, labels, colours). Navigation in both input modes, zoom to fit, zoom to 100%. *Independent test:* all existing canvases open; the largest pans smoothly; the file on disk is byte-identical after a session of navigating (I1).
- **P2. Live notes on the board.** Note cards and embeds inside markdown cards render through the same renderer as notes, update when the note changes on disk, and resolve `#Section` subpaths (the fix for #123, made in the shared path so notes gain it too). *Independent test:* a card embedding `![[note#Section]]` shows only that section; editing the note elsewhere updates the card.
- **P3. Editing.** Create, select (click, shift-click, marquee), move, resize, delete, duplicate, restyle. Tools: sticky, markdown card, text label, frame, connector; add a note card by dragging a note from the sidebar or through a Quick-Open-style picker. Stickies auto-fit their text. Edges: drag from a side handle to another item; set label, colour, dashed, arrowheads. Frames move what they contain. Undo/redo. Autosave through the conflict-safe save path. *Independent test:* build the concept-map board from SC2, close and reopen: identical; undo back to empty.
- **P4. Links and search.** The indexer reads canvas files: note cards and wikilinks inside card text become links (SC5); renaming or moving a note updates canvas file paths and wikilinks; canvas text is searched by full-text search with results that centre the item (SC4). *Independent test:* rename a note shown on a canvas; the card still shows it and the note's backlinks still list the canvas.
- **P5. Look and settings.** Filled post-it stickies with a soft shadow, a quiet dot grid, colours from a theme-aware palette (the tree-colour pattern), and the mouse/trackpad toggle in Settings. *Independent test:* switch themes; every sticky colour stays legible.

**Out:**
- Dataview blocks: they render as code, like any unknown fenced block.
- Freehand pen, shapes, freestanding lines and arrows. The format keeps room for them (Decision: format).
- Editing a note from inside its card (opening it in a tab is one click away).
- Converting a sticky into a note.
- Export to image or PDF.
- Opening Onyx canvases in Obsidian (not guaranteed, though the base format keeps it largely possible).
- Pasting or dropping images from outside the registered directories, and clipboard images.
- Collaboration, templates, voting, timers.
- A heuristic that detects mouse vs trackpad: the Settings toggle decides.

**Depends on:**
- #123 (section embeds) is fixed as part of P2, not before it.
- #124 (auto-save conflict) is fixed as part of P3's shared save path (Decision: saving).

## Decisions

- **Format: JSON Canvas 1.0 plus an `onyx` object** — chose extending the open spec (jsoncanvas.org) over an Onyx-only format because existing files open with no converter and the spec already covers most of what's needed: text/file/link/group nodes, side-anchored edges with labels, colours and arrowheads, and z-order as array order. Onyx additions go in one `onyx` object per node, edge or file (never loose top-level keys), so they are easy to find and other readers ignore them:
  - node: `onyx.kind` (`"sticky"`, `"label"`; absent means a markdown card), `onyx.color` (palette name).
  - edge: `onyx.dash` (bool), `onyx.color`.
  - top level: `onyx.version`, and later `onyx.items` for strokes, shapes and free lines (the reserved room for drawing), each with a place in the same z-order.
  Unknown fields from other writers are kept and written back (I6).
- **Imported text nodes become markdown cards** — Obsidian text nodes are rendered markdown, and the year boards depend on that. Stickies exist only where `onyx.kind` says so.
- **Colours: palette names resolved per theme** — follows `treeStyles.ts` (`"teal"` → `var(--canvas-color-teal)`). JSON Canvas presets `"1"`–`"6"` map to palette names on read; hex values are kept as custom colours. Chosen over storing hex so stickies stay legible in every theme (P5).
- **File paths in file nodes: relative to the canvas's registered root** — matches Obsidian's vault-relative paths, so existing files resolve unchanged. A file outside that root is stored as an absolute path. A path that no longer exists falls back to name lookup, as images in notes already do (`resolve_attachment`).
- **Rendering: DOM items in one transformed world layer, edges in an SVG layer inside it** — chosen over drawing to a `<canvas>` element because cards must reuse the note renderer (DOM) and a later drawing layer fits as SVG. Pan and zoom are one CSS transform on the world layer. Items outside the viewport are not mounted.
- **Card content renders through CodeMirror, read-only, with live preview** — provisional pending spike S1. Chosen over extending the hand-written HTML converter in `embeds.ts` (it has no tables, images, callouts or inline HTML, and a second renderer would drift from how notes look) and over adding a markdown library (a new dependency that would also drift). Markdown cards need an editor for editing anyway, so the same view serves both. To stay fast: a card's view mounts only when on screen and above a zoom threshold; below it the card shows a lightweight summary (title and first lines). Stickies and labels render with the inline renderer and switch to a minimal editor while being edited.
- **Link context comes from the view, not the active tab** — `embeds.ts`, `images.ts` and `livePreview.ts` read `selectActiveTabPath()` to resolve links. On a canvas, links inside a note card must resolve from the note's folder. A facet on each view supplies its context path, defaulting to the tab's path, so note editors behave as before (I4).
- **Saving: one conflict-safe save function shared by notes and canvases** — the canvas serialises its model and saves through a helper that handles `CONFLICT:` and `DELETED:` rejections and raises the status bar prompt. Note auto-save moves onto the same helper, which fixes #124. Chosen over a canvas-only save path because two save paths could disagree about the same conflict.
- **Viewport is saved per machine, in the session** — pan and zoom position belong to the machine, not the board, so they live in `session.json` beside the tab, and viewing a canvas never writes the file (I1).
- **Undo: board-level history of model snapshots** — the model is small (hundreds of items), so each committed change stores the previous model. A text edit inside a card commits as one entry when the card loses focus. Chosen over command objects for simplicity.
- **Input modes (setting `canvas.inputMode`, default `mouse`):**
  - Mouse: wheel zooms at the pointer; right- or middle-drag pans; right-click without movement (under 4px) opens the context menu; left-drag on empty space draws a marquee; Space + left-drag pans.
  - Trackpad: two-finger scroll pans; pinch zooms at the pointer; left-drag on empty space draws a marquee; Space + drag pans.
  - Both: Cmd+= / Cmd+- zoom, Shift+1 zoom to fit, Shift+0 zoom to 100%.
- **Tab kind comes from the file extension** — `fileKinds.ts` gains `isCanvasPath`; `EditorPane` renders `CanvasView` for canvas tabs and skips its CodeMirror setup. The listed places that assume an editor are guarded by the same check (see plan).
- **Search reads canvas text in Rust** — `search_content` includes `.canvas` files, extracts searchable text from the JSON (card text, labels, edge labels, frame labels) and returns the matched node id, so the result can centre it. Searching the raw JSON would match keys and ids.

## Implementation Plan

| File / Module | Action | Purpose |
|---|---|---|
| `src-tauri/src/skip.rs` | Modify | Add `canvas` to `LISTED_EXTENSIONS` (tree + watcher) |
| `src-tauri/src/canvas.rs` | Create | Parse JSON Canvas: links (file nodes, wikilinks in text), searchable text per node, JSON-aware path rewrite for rename |
| `src-tauri/src/indexer.rs` | Modify | Index `.canvas` files; branch to `canvas.rs` for links |
| `src-tauri/src/watcher.rs` | Modify | Reindex `.canvas` on change |
| `src-tauri/src/commands.rs` | Modify | `commit_file` reindex, `search_content` over canvases, `rename_file` rewrite inside canvases, `resolve_link_target` strips `#subpath` (#123) |
| `src-tauri/src/db.rs` | Modify | `link_stem`/`resolve_link` ignore `#subpath` (#123) |
| `src-tauri/src/config.rs` | Modify | `canvas.inputMode` setting |
| `src/lib/fileKinds.ts` | Modify | `isCanvasPath` |
| `src/lib/canvas/model.ts` | Create | Types, parse/serialise with unknown-field round-trip, preset→palette mapping |
| `src/lib/canvas/history.ts` | Create | Snapshot undo/redo |
| `src/lib/canvas/geometry.ts` | Create | Edge routing (side choice, bezier), hit testing, frame containment, fit-to-view |
| `src/lib/canvas/autofit.ts` | Create | Sticky font size to fit its box |
| `src/lib/saveFile.ts` | Create | Shared conflict-safe save (fixes #124) |
| `src/components/canvas/CanvasView.tsx` | Create | Board: world transform, culling, selection, tools, context menu |
| `src/components/canvas/useViewport.ts` | Create | Pan/zoom input per mode |
| `src/components/canvas/CanvasCard.tsx` | Create | Markdown, note, image, link cards; sticky; label; frame |
| `src/components/canvas/CardEditor.ts` | Create | Read-only / editable CodeMirror card views with a context-path facet |
| `src/components/canvas/CanvasEdges.tsx` | Create | SVG edges, labels, handles |
| `src/extensions/embeds.ts` | Modify | Section extraction for `#Section` (#123); context path from facet |
| `src/extensions/images.ts`, `livePreview.ts` | Modify | Context path from facet |
| `src/components/EditorPane.tsx`, `Editor.tsx` | Modify | Render `CanvasView` for canvas tabs; guard inline title, scroll lock, pane cleanup, flush-save |
| `src/lib/openFile.ts`, `src/lib/session.ts` | Modify | Canvas path skips `loadFileIntoCache`; session restores canvas tabs and viewport |
| `src/App.tsx` | Modify | `fs:change` for canvas tabs: reload when clean, conflict prompt when modified |
| `src/lib/fileOps.ts` | Modify | `createCanvas`; `.md` assumptions guarded |
| `src/components/Sidebar.tsx` / `SidebarContextMenu.tsx` | Modify | "New canvas"; drag a note onto a canvas |
| `src/components/SearchPanel.tsx`, `QuickOpen.tsx` | Modify | Canvas results centre the item; canvas icon |
| `src/lib/configTypes.ts`, `configBridge.ts`, `Settings.tsx` | Modify | Input mode toggle |
| `src/styles/theme.css`, `layout.css` | Modify | Canvas palette tokens per theme, board styles |
| `docs/ARCHITECTURE.md`, `docs/DEVPLAN.md`, `CLAUDE.md` | Modify | Record the canvas design and file map |

**Order of operations:**
1. Spikes S1 and S2 (below). Their results confirm or change the rendering and input decisions before anything is built on them.
2. P1 file type: `skip.rs`, `fileKinds`, tab kind in `EditorPane`, open/session, `model.ts` with round-trip tests.
3. P1 viewer: world layer, culling, cards, edges, `useViewport` in both modes.
4. P2: context-path facet, #123 section resolution and extraction, card views.
5. P3: shared save (#124), history, tools, selection, stickies with autofit, frames, connectors, fs:change handling.
6. P4: `canvas.rs`, indexing, rename rewrite, search.
7. P5: palette, look, Settings toggle; docs.

**Spikes:**
- **S1. Card views at scale.** 30 read-only live-preview CodeMirror views inside a CSS-scaled container, in the dev app: frame time while panning, memory, and whether cursor and selection land correctly at zoom 0.5 and 2.0 when a card is being edited. Pass: smooth panning at 30 visible cards, correct cursor placement. Fail: fall back to extending the `embeds.ts` renderer for display and mount an editor only on the card being edited.
- **S2. Pinch in WKWebView.** Which events a trackpad pinch produces in Tauri's WebKit (`wheel` with `ctrlKey`, or WebKit `gesturestart/gesturechange`), and whether a mouse wheel and a two-finger scroll are delivered identically (they are expected to be, which is why the mode is a setting).

**Data / contract changes:**
- `.canvas` files are written by Onyx (JSON Canvas 1.0 plus `onyx` fields).
- The index gains rows for canvas files and links from them. No schema migration: canvas files use the existing `files` and `links` tables.
- `config.json` gains `canvas.inputMode`.

## Risks & Rollback

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Many CodeMirror card views are slow or misplace the cursor under zoom | M | H | Spike S1 first; culling and zoom threshold; fallback renderer named in S1 |
| 76 full-size photos exhaust memory | M | M | Lazy decode, unmount off-screen, downscaled rendering at low zoom |
| Canvas files in the index change Quick Open, rename rewriting and the empty-folder check in ways notes notice (I4) | M | M | P4 tests cover each: rename rewriting leaves notes untouched, Quick Open ranks notes as before |
| Rename rewriting corrupts canvas JSON | L | H | Rewrite through a JSON parse and serialise, never text replacement; round-trip test on every existing file shape |
| Pinch events differ from expectation in WKWebView | M | M | Spike S2 before `useViewport` |
| Obsidian-written fields lost on save (I6) | L | H | Round-trip tests on copies of real files' structure |
| XL scope stalls with nothing usable | M | M | Slices ordered so P1 alone opens every existing canvas |

**Rollback:** canvas support is additive. Removing `canvas` from `LISTED_EXTENSIONS` and the tab-kind branch hides it; canvas files on disk are untouched JSON. The #123 and #124 fixes stand on their own and stay.

## Test Plan

- [ ] Round-trip: parse and serialise each node type, edge options and unknown fields; output equals input structurally (I6).
- [ ] Opening and navigating a canvas leaves the file byte-identical (I1).
- [ ] Preset colours `"1"`–`"6"` map to palette names; hex kept.
- [ ] Edge geometry: side choice when `fromSide`/`toSide` are absent; frame containment on move.
- [ ] Autofit: long and short sticky text stay inside the box at every size.
- [ ] History: a sequence of edits undoes to the start and redoes to the end.
- [ ] Shared save: `CONFLICT:` and `DELETED:` rejections set the right state for notes and canvases (#124).
- [ ] Section embeds: `![[note#Section]]` resolves `note` and extracts to the next heading of equal or higher level; unknown section shows a clear error (#123).
- [ ] Rust: canvas links indexed; rename rewrites file paths and wikilinks inside a canvas and nothing else; search finds sticky text and returns its node id.
- [ ] Notes unaffected: backlinks, Quick Open and rename behave as before on a vault with no canvases (I4).

**Manual verification:**
1. Open every existing canvas; compare against Obsidian screenshots.
2. Build a concept map and a timeline board in each input mode.
3. Edit a note shown on a canvas in another pane; the card updates.
4. Change the canvas file on disk while it has unsaved edits; the conflict prompt appears and nothing is overwritten.
5. Pan and zoom the largest canvas; check smoothness.

## Size & Confidence

**Size:** large, bordering on XL.
**Confidence:** 60% in the plan as written. It drops if S1 fails (the rendering decision changes and card editing needs its own path), and rises to about 75% once S1 and S2 pass.

## Open Questions

- **OQ1.** The rendering decision is provisional on S1.
