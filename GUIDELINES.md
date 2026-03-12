# Onyx — Development Guidelines

Rules and conventions for building Onyx. These apply to all contributors (human and AI).

---

## 1. Surface Parity

**Every action must be available in three places:**

1. **Menu bar** — the canonical registry. If an action exists, it has a menu item.
2. **Keyboard shortcut** — listed in the menu item's accelerator.
3. **UI control** (where appropriate) — button, context menu item, or command palette entry.

Never add a button or shortcut for something that isn't also in the menu bar. When in doubt, add the menu item first.

## 2. Offline-First

- No network calls. No analytics. No telemetry.
- All data lives on the user's filesystem. SQLite is a cache, not a source of truth.
- If the SQLite index is deleted, the app rebuilds it from disk files on next launch.

## 3. Performance Budget

- Target: 30-50MB RAM at rest with ~5,000 notes indexed.
- Every feature must justify its memory cost.
- Prefer Rust for CPU-bound work (indexing, search, template rendering). JS handles UI only.
- No lazy-loading of core features — the app is small enough to load everything upfront.

## 4. Code Style

- **Frontend:** React 18 + TypeScript. Plain CSS with custom properties (no Tailwind, no CSS-in-JS).
- **Backend:** Rust, idiomatic error handling (`Result<T, String>` for Tauri commands).
- **State:** Zustand for UI state. CodeMirror 6 owns editor state. Rust owns file/index data.
- **Imports:** Use `type` keyword for type-only imports (especially CodeMirror types like `Extension`, `DecorationSet`).
- Keep components focused. Extract shared logic to `src/lib/`.

## 5. File Operations

- All file I/O goes through Rust commands — never use browser APIs for file access.
- Writes use atomic temp-file-then-rename pattern.
- Auto-save with 500ms debounce. No save dialogs.
- Destructive operations (delete, rename) must be undoable or confirm-gated.

## 6. Error Handling

- Never silently swallow errors. At minimum, `console.error` with context.
- User-facing errors should appear as toasts or inline messages, not alerts.
- Rust commands return `Result<T, String>`. Frontend catches and handles.

## 7. Accessibility

- All interactive elements must be keyboard-navigable.
- Context menus need arrow key navigation.
- Search/list UIs need proper ARIA roles (`listbox`, `option`, `aria-activedescendant`).
- Respect system preferences (reduced motion, high contrast) where feasible.

## 8. Commit Hygiene

- One logical change per commit.
- Message format: imperative mood, what + why. Example: "Fix frontmatter re-fold on tab switch"
- Co-author tag for AI-assisted commits.

## 9. Testing

- Rust: unit tests for extractors, parsers, DB operations, and template logic. Write tests for new pure-function code as it's built — especially the template engine, date path generation, and indexer extractors. These are high-ROI tests: well-defined inputs/outputs, no mocking needed.
- Frontend: manual testing via dev server for now. Automated frontend tests remain a Tier 2 goal, but React error boundaries must be in place to prevent white-screen crashes (see Phase 4.6).
- Always run `cargo check`, `cargo test`, and `npx tsc --noEmit` before committing.

## 10. Post-Phase Review Loop

Run this after completing each phase, before moving on. Execute independently — no user approval between steps.

1. **`/linus` review** — Linus reviews the full diff since last phase. Fix all issues he flags (even minor nits).
2. **Commit** the Linus fixes.
3. **`/team` review** — Assemble the relevant specialist team to review the current state.
4. **`/linus` evaluates team feedback** — Linus triages team findings into "fix now" vs "document for later."
5. **Fix** all "fix now" items. **Document** "later" items in ARCHITECTURE.md §18 (Known Technical Debt).
6. **Compile check** — `cargo check`, `cargo test`, `npx tsc --noEmit`. All must pass.
7. **Build and launch** — Run `cargo tauri dev`, check for runtime errors (white screen, console errors, panics). Fix anything that surfaces.
8. **Commit and report** — Summarize what was fixed, what was documented, and any gotchas discovered. Include a numbered list of verification steps the user should test manually.
