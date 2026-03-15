# Onyx — Session Wrap-Up Checklist

Project-specific steps for `/gg`. These run after the generic sections.

## Version

- Check if a minor or patch version bump is warranted based on the session's changes
- Compare the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` — they must all match
- If a bump is needed, offer: `[R1] Bump version` (ask minor vs patch, update all three files + CLAUDE.md `Current version`)

## Documentation Sync

Check each doc below. Only flag ones that need updating based on this session's changes.

| File | Update if... |
|------|-------------|
| `CLAUDE.md` | Files added/removed, line counts shifted significantly, phase status changed, new gotchas discovered |
| `CHANGELOG.md` | Any user-visible changes were made (features, fixes, breaking changes) |
| `docs/DEVPLAN.md` | A phase milestone was reached or phase scope changed |
| `docs/ARCHITECTURE.md` | Architectural patterns changed (version header + relevant sections) |
| `docs/DEPENDENCIES.md` | Crates/packages added, removed, or swapped |
| `docs/DEBT.md` | New debt introduced or existing items resolved |
| `docs/GUIDELINES.md` | Development conventions changed |
| `docs/ISSUES.md` | Label schema or issue workflow changed |

If updates are needed, offer: `[R2] Update docs`

## GitHub Issues

This is the most important section. Be thorough — scan the full session history.

### Close resolved issues
- Fetch open issues: `gh issue list --state open --limit 30`
- Cross-reference against the session's work — did any get fixed, even partially?
- For each resolved issue, offer: `[R3] Close resolved issues` (with a summary comment referencing commits)

### Capture new issues
Scan the entire conversation for anything that should be tracked. Look for:
- **Bugs encountered** — things that broke during testing, edge cases discovered, regressions noticed
- **Workarounds applied** — anything marked "good enough for now" or "revisit later" is an issue
- **Deferred work** — features discussed but not implemented, improvements suggested but skipped
- **Review feedback not acted on** — team/linus review items marked as "defer" or "investigate later"
- **Known limitations** — things explicitly called out as not working yet or having rough edges
- **Performance concerns** — anything flagged as potentially slow at scale
- **TODO/FIXME/HACK comments** — cross-reference with Section 4 (TODOs Introduced)

Present a numbered list of candidate issues with:
- Suggested title
- One-line description
- Suggested labels (Priority: P1-P4, Type: Bug/Task/Enhancement, Status: Backlog)

Then offer: `[R4] Create selected issues` — let the user pick which ones to create (e.g., "R4 1,3,5" to create items 1, 3, and 5)

## Stale Branches

Check for local branches that have been merged into main and can be pruned:
- `git branch --merged main` — list branches fully merged into main
- Exclude `main` itself and any branch currently checked out
- If any found, list them and offer: `[R6] Prune merged branches` (deletes local only, not remote)

## Release Build

- If a version was bumped AND pushed to main, ask if the user wants a release build
- If yes, offer: `[R5] Build DMG + create GitHub release`
- Build command: `cargo tauri build` (warn: uses significant RAM)
- DMG location: `src-tauri/target/release/bundle/dmg/`
- Install: copy `.app` to `/Applications/`
- Release: `gh release create v{version} {dmg_path} --title "..." --notes "..."`

## Tech Debt

- If new debt items were introduced or discovered, check `docs/DEBT.md` is up to date
- If items were resolved, offer to mark them as resolved
