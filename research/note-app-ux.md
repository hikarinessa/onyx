# Note-Taking App UX: State of the Art (March 2026)

Research survey covering navigation, editor design, sidebars, context panels, keyboard interaction, tabs, search, onboarding, theming, mobile, and novel approaches across the current landscape.

---

## 1. Navigation Paradigms

### The Four Schools

**A. File Tree (Obsidian, VS Code, traditional IDEs)**
- Hierarchical folder/file structure in a left sidebar.
- Strengths: Familiar mental model. Users with large vaults (1000+ notes) report that folders provide necessary structure. Drag-and-drop reorganization is intuitive. Works well for project-based organization.
- Weaknesses: Folders impose a single hierarchy on inherently multi-dimensional knowledge. Users spend time deciding *where* to put a note instead of writing it. Deep nesting becomes unwieldy past 3-4 levels.

**B. Flat List / Tag-Based (Bear, Apple Notes, Simplenote)**
- No visible folder tree. Notes organized by tags, smart folders, or pinning.
- Bear uses nested hashtags (#work/projects) as its entire organizational system, which works "surprisingly well" per multiple reviewers. Apple Notes uses a simple folder + pinned notes model.
- Strengths: Zero friction note creation -- no "where does this go?" question. Tags allow notes to exist in multiple categories. Reduces cognitive overhead for casual users.
- Weaknesses: Scales poorly past ~500 notes without strong search. Power users miss the overview a tree provides. No spatial sense of "where" things are.

**C. Graph View (Obsidian, Roam, Logseq)**
- Visual node-link diagram showing connections between notes.
- Roam's graph is "boring" with a strict bordered appearance. Logseq's sits between Obsidian's and Roam's, "a huge step up from Roam" in interactivity. Obsidian's is the most visually polished.
- Strengths: Makes implicit relationships visible. Satisfying to explore. Useful for discovering orphan notes.
- Weaknesses: The default graph view in all these apps is widely considered **unusable for day-to-day work**. It becomes a hairball at scale. More of a visualization novelty than a navigation tool. Nodus Labs assessment: "doesn't work very well" as primary navigation.

**D. Search-First / Daily Notes (Roam, Logseq, Mem)**
- No folder browsing by default. Open to a daily note. Navigate via search, backlinks, or typed references.
- Roam and Logseq both open to daily notes pages; most writing happens there, with block references linking outward. Mem 2.0 leans even further into search + AI surfacing.
- Strengths: Eliminates organizational overhead entirely. Matches how many people actually think (chronologically). Backlinks create emergent structure.
- Weaknesses: Feels chaotic for reference material. "Logseq's flat structure can feel chaotic" for users who want clear hierarchies. Requires disciplined linking habits to avoid orphaned content.

### Hybrid Approaches Worth Noting

- **Obsidian** succeeds partly because it offers *all four* -- tree, graph, search, and daily notes -- letting users pick their primary mode.
- **Capacities** replaces files/folders entirely with typed objects (person, book, meeting, project), each with properties and relationships. Navigation is by type, not location.
- **Heptabase** adds a fifth paradigm: spatial/canvas navigation, where notes are cards arranged on infinite whiteboards. Users navigate by zooming and panning through spatial clusters.

### Takeaway for Onyx

The tree is the right default for a power-user markdown app, but search-as-navigation (quick open) should be equally prominent. Graph view is a "nice to have" that almost nobody uses daily.

---

## 2. Editor UX

### The Three Modes

**A. Source Mode (plain markdown)**
- Raw syntax visible at all times. No rendering inline.
- Preferred by: developers, Vim/Emacs users, people who want total control.
- Apps: Obsidian (option), any plain text editor.

**B. Split Preview (source left, rendered right)**
- Traditional approach from early markdown editors (Mou, MacDown, StackEdit).
- Largely considered outdated. Wastes screen space. Eye has to jump between panes.

**C. Live Preview / Hybrid (render inline, show syntax at cursor)**
- Syntax hides when cursor moves away; appears when you click into a region.
- Typora pioneered this as "seamless live preview where Markdown syntax disappears as you type." Obsidian adopted it as default in late 2021.
- Now the dominant paradigm. Mark Text, MDXEditor, and most modern editors follow this pattern.

**D. True WYSIWYG / Block-Based (Notion, Craft)**
- No markdown syntax ever visible. Formatting via toolbar, shortcuts, or slash commands.
- Notion's block model: every element (text, image, table, database) is a discrete movable block.
- Craft: polished WYSIWYG with nested documents. "Documents look beautiful on screen."

### User Preferences (from forum discussions and reviews)

- Live preview is the clear winner for markdown-native apps. Users want to see rendered output without losing access to syntax.
- Obsidian's live preview implementation has **known pain points**: callouts break layout when editing, mode-switching UI is confusing ("I totally DON'T get the corresponding UI elements"), and mobile rendering has issues with embedded images.
- Power users often keep source mode available as a toggle for complex formatting or debugging.
- WYSIWYG (Notion/Craft style) appeals to non-technical users but frustrates those who want portable plaintext files.

### Block-Based vs Document-Based

**Block-Based (Notion, Logseq, Roam, Tana):**
- Every bullet/paragraph is an individually addressable unit.
- Blocks can be referenced, embedded, moved, and converted between types.
- Logseq: "every bullet point is a discrete unit that can be referenced anywhere."
- Notion: blocks are "easily reorganized, moved to other pages, converted into other content types."
- Downside: "The block-based editor is pretty, but clunky when you just want to type Markdown." Doesn't feel like writing -- feels like operating a database.

**Document-Based (Obsidian, Bear, iA Writer, Onyx):**
- The note is a file. Editing is continuous text flow.
- "Obsidian feels more pagey -- users tend to create dedicated pages for topics."
- More familiar, lower friction for prose writing. Better for long-form content.
- Weaker at structured data and granular referencing.

### Takeaway for Onyx

Live preview is the right default. Source mode should remain a toggle. Block-based editing is a fundamentally different paradigm -- Onyx should stay document-based but could adopt block-level features (block references, transclusions) without switching to a block editor.

---

## 3. Sidebar Design

### What Goes in the Sidebar

Across apps, left sidebars typically contain (in rough order of frequency):

1. File browser / navigation tree
2. Search
3. Bookmarks / favorites / pins
4. Recent files
5. Tags browser
6. Calendar / daily notes entry point
7. Vault/workspace switcher
8. Settings/preferences access

### Design Patterns

**Obsidian:** Left sidebar has file explorer, search, bookmarks, and tags as separate tab panels. Right sidebar has backlinks, outline, properties, and graph as separate tab panels. Both sidebars support plugin panels. Users can drag panels between sidebars.

**Bear:** Single left sidebar with three sections: notes list, tags tree, and a unified search bar at top. No right sidebar. Extreme simplicity.

**Notion:** Left sidebar has workspace navigation (pages, favorites, shared, private), recent pages, and a "New page" button. No right sidebar in the traditional sense -- properties appear at the top of pages or in a database inspector panel.

**Apple Notes:** Simple folder list on the left, notes list in the middle, editor on the right (three-column layout on wide screens, collapsing to two or one on smaller).

**Arc Browser (relevant for sidebar innovation):** Tabs live in the left sidebar instead of across the top. Divided into "Spaces" (workspaces). Pinned tabs persist across spaces. Lesson: sidebar can replace the tab bar entirely, but "the learning curve is steep" and the sidebar "felt bulky, taking up valuable screen space."

### Best Practices from UX Research

- **Icons alongside labels** make selections more intuitive.
- **Keep the primary sidebar fixed/persistent** so it's always accessible.
- **Contextual sidebars** that show relevant options based on current action improve usability.
- **Collapsible sections** are essential -- users should be able to hide what they don't need.
- Avoid cramming too many panels. Bear's success shows that less can be more.

### How Many Panels Is Too Many

- 2-3 visible sections in a sidebar is the comfort zone.
- Obsidian's approach of tabbed panels (showing one at a time) scales better than stacking.
- Accordion/collapsible patterns work when sections are independent and not all needed simultaneously.

### Takeaway for Onyx

Onyx's current split (file tree + bookmarks in left sidebar, context panel sections on right) is sound. The accordion pattern for the right panel is a good choice. Consider whether the sidebar needs a "recent files" quick-access section -- many users rely on this more than the tree.

---

## 4. Context Panels / Inspectors

### What Belongs in a Right Panel

Across apps, right-side panels typically display:

1. **Backlinks** -- which notes link to the current one (Obsidian, Logseq, Roam)
2. **Outline / Table of Contents** -- heading structure of current document (Obsidian)
3. **Properties / Metadata** -- frontmatter, tags, dates, custom fields (Obsidian, Notion)
4. **Related notes** -- AI-suggested or graph-adjacent notes
5. **Calendar widget** -- for periodic notes navigation
6. **Graph view** -- local graph showing immediate connections

### App-Specific Approaches

**Obsidian:**
- Right sidebar uses a tabbed panel system. Backlinks, outline, tags, properties, and graph each get their own tab.
- Backlink previews are limited to ~20 words, which users find insufficient. A common feature request is longer context snippets.
- The outline view was a top feature request before becoming a core plugin.

**Notion:**
- No traditional right sidebar. Instead, Notion recently added a **details panel** on database pages: a right-side inspector showing properties, which can be customized per view.
- Pages can open as "side peek" (right side of database), "center peek" (modal), or "full page."
- The new Layouts feature lets users create "Simple" (properties + content) or "Tabbed" layouts with a details panel, which "makes pages look significantly more polished."

**Craft:**
- Document styling and metadata accessible via a right-side panel.
- Properties and formatting options are tucked into a secondary panel that can be toggled.

**Roam / Logseq:**
- Roam shows inline references directly in the page. Logseq opens references in the sidebar.
- Both treat the right sidebar as a "second pane" for viewing referenced content rather than as an inspector.

### Design Principles

- **Progressive disclosure**: Show the most-used info (backlinks, outline) by default. Hide less-used metadata behind expandable sections.
- **Context-awareness**: The panel should update based on the active document. Stale panels are worse than no panel.
- **Don't duplicate the editor**: The inspector should show *about* the document (metadata, relationships) not *in* the document (content).
- **Persistent state**: Remember which sections are expanded/collapsed per user preference.

### Takeaway for Onyx

Onyx's context panel (calendar, backlinks, properties, outline, recent docs) covers the right categories. Consider adding a "related notes" section in the future (even without AI -- could be based on shared tags or links). Backlink previews should show enough context to be useful without requiring a click.

---

## 5. Keyboard-First Design

### Philosophy from Vim and Emacs

**Vim's core insight:** Treat editing as a *language* -- verbs (delete, change, yank) + nouns (word, sentence, paragraph). "Think of Vim commands as a language rather than individual keypresses." This composability means a small number of primitives combine into thousands of operations.

**Emacs' core insight:** Commands are first-class citizens. Everything the editor does is a named, searchable, bindable command. This philosophy directly inspired the modern command palette.

**Shared lesson:** Minimize context switching. Experienced users "reach a state where editing becomes fluid and nearly effortless by minimizing context switching and maximizing keyboard efficiency."

### Command Palette Patterns

The command palette has become table stakes for power-user apps. Key design lessons from Superhuman, Linear, VS Code, and Raycast:

1. **Single entry point**: "The command palette must be the one place where users can find every command." Cmd+K (Superhuman, Linear, Slack) or Cmd+Shift+P (VS Code) are the standard triggers.

2. **Passive shortcut learning**: "Every time you use Cmd+K to find a command, the palette displays the keyboard shortcut next to it." Users see shortcuts repeatedly, build muscle memory, and eventually bypass the palette entirely. This is the single most effective shortcut discoverability mechanism.

3. **Context-awareness**: "Knowing what the user will want to do in a given situation is where the super powers will come from." Global commands plus context-specific actions based on current state.

4. **Fuzzy matching**: Raycast's fuzzy search lets users type "ftime" for "Facetime" or "msg" for "Messages." Matching against title, subtitle, keywords, and aliases. Crucial for discoverability.

5. **Recency and frequency weighting**: Show recently/frequently used commands first.

### Discoverability Challenge

"One of the biggest challenges is making sure users know about the command palette." Solutions:
- Show it in onboarding.
- Display keyboard shortcut hints in menus and tooltips.
- Use the command palette as the *teaching tool* -- it teaches other shortcuts passively.

### Takeaway for Onyx

Onyx has both quick open (Cmd+O) and command palette (Cmd+P). The passive shortcut learning pattern (showing the bound shortcut next to each command in the palette) is the highest-leverage improvement for keyboard discoverability. Consider whether Cmd+K might be more natural as the command palette trigger -- it's becoming the standard.

---

## 6. Tab Management

### Paradigms

**A. Browser-Style Tabs (Obsidian, VS Code)**
- Horizontal tab strip at the top.
- Familiar from web browsers. Supports drag-to-reorder, close buttons, and overflow scrolling.
- Obsidian adds: tab stacking (grouping), split panes, and pin.
- Works well up to ~8-12 tabs before becoming hard to scan.

**B. No Tabs / Document Switching (Apple Notes, Bear)**
- No visible tab bar. Click a note in the sidebar to switch. Only one document open at a time.
- Simpler mental model. Works for casual use.
- Frustrating for power users who need to compare or reference multiple documents.

**C. Sidebar Tabs (Arc Browser)**
- Tabs live in the left sidebar column rather than across the top.
- Arc divides into "Spaces" with separate tab lists. Pinned tabs persist across spaces.
- Novel but steep learning curve. "Expect a few hours to unlearn traditional browser habits."

**D. Split Views / Panes**
- Side-by-side document editing. Obsidian supports up to 4+ panes. Onyx supports 2.
- Primary use case: reading one document while editing another, or comparing two documents.
- Chrome recently added split view ("put two tabs together side by side in the same tab").

### What Works at Different Vault Sizes

- **Small (<100 notes)**: Tabs are optional. Sidebar navigation is sufficient.
- **Medium (100-1000)**: Browser-style tabs become important for workflows involving multiple documents. Quick open (fuzzy search) becomes the primary navigation mechanism.
- **Large (1000+)**: Tab management itself becomes a problem. Users need bookmarks/favorites, recent files, and possibly workspaces/spaces to manage cognitive load.

### Takeaway for Onyx

Browser-style tabs + split panes is the right combination for Onyx's target user. Consider adding a "tab history" or "recently closed tabs" feature for large-vault users. Per-tab navigation stacks (already implemented) are a strong differentiator.

---

## 7. Search UX

### Patterns

**A. Inline Search (Cmd+F)**
- Find-and-replace within the current document. Standard, expected, not differentiating.

**B. Global Search**
- Search across all files. Results show filename + snippet with highlighted match.
- Obsidian's search supports operators (path:, tag:, file:, section:) and regex.
- Quality of result ranking and snippet context heavily affects perceived quality.

**C. Search-as-Navigation (Quick Open)**
- Raycast/Alfred pattern: a modal search bar that acts as the primary way to *go* places.
- Fuzzy matching is essential. Raycast lets you type "utub vid" for "Search Youtube Videos."
- Alfred's file search: press space to search files, with smart matching ("ps" finds Photoshop).
- The best quick-open implementations weight: recency > frequency > string match quality.

**D. Filter Syntax / Structured Query**
- Obsidian: `tag:#important path:projects/` in search.
- Amplenote: rich filter UI with faceted search.
- Tana: "Supertags" system that allows metadata-based queries.

### What Delights Users

- **Speed**: Results appearing as-you-type with no perceptible delay. Heptabase advertises "search over 10,000 notes in under one second."
- **Context in results**: Showing enough surrounding text to know if a result is relevant without opening it.
- **Fuzzy tolerance**: Handling typos and partial matches gracefully.
- **Recent/frequent prioritization**: The thing you're probably looking for should be at the top.
- **Keyboard-navigable results**: Arrow keys to select, Enter to open. No mouse required.

### Takeaway for Onyx

Quick open (Cmd+O) is the most important search surface. Fuzzy matching quality and recency weighting are the two highest-impact improvements. Consider adding type-prefixed queries (e.g., `tag:`, `path:`) to quick open for power users.

---

## 8. Onboarding and Empty States

### Best Practices

**Starter Content:**
"A note-taking app might display a sample note or a friendly prompt, making it easier for users to begin writing." Notion pre-fills templates and prompts users to create their first note or database. Basecamp pre-loads a sample project.

**Progressive Disclosure:**
"A new user shouldn't have to guess what the first step is -- they should see it, front and center." But don't overwhelm. Show one clear action, not ten.

**Obsidian's Problem:**
"There's so much content about Obsidian that it's overwhelming" and users "feel an urge to maximize its functionalities before actually writing anything." The core plugin list keeps growing, making it "tough for new users to understand."

**What Works:**
- A "getting started" note with a few examples of features (wikilinks, tags, formatting).
- Empty state messages that *do something* -- not just "No notes yet" but "Create your first note" with a clear action button.
- Minimal onboarding wizard (2 steps: choose a vault location, pick a theme). The 2024-2026 trend is collapsing onboarding from 6 steps to 2.
- Avoid showing all features at once. Let users discover the command palette, backlinks, etc. organically.

### Takeaway for Onyx

First launch should: (1) prompt directory registration, (2) show a welcome note demonstrating core features (wikilinks, tags, shortcuts), (3) subtly hint at the command palette. No modal wizard. No feature tour. Let the app speak for itself with one good example document.

---

## 9. Dark Mode and Theming

### What Makes a Good Dark Theme

**Color fundamentals:**
- Never use pure black (#000000). Use dark grays (#121212 or #1E1E1E) for a softer look.
- Text should be white or off-white (#FAFAFA), not bright white (#FFFFFF) which causes halation.
- Minimum contrast ratio: 4.5:1 for body text, 3:1 for large text.
- Reserve saturated colors for accents only. Saturated colors on dark backgrounds cause eye strain.
- "Dynamic dark mode" -- subtle gradations and overlays, not flat single-color backgrounds.

**Common mistakes:**
- **Pure black backgrounds**: Harsh, creates too much contrast with white text.
- **Insufficient contrast**: Mid-grey text on dark backgrounds "may look elegant but is usually hard to read."
- **Simply flipping the palette**: "Results in awkward images, illegible icons, and ghost UI elements."
- **Saturated colors**: "Blue-on-black, dark green on navy, and similar combos kill legibility."
- **No toggle option**: 82% of users actively prefer apps that offer dark mode (2024 Android Authority survey).
- **Inconsistent elevation**: Dark mode needs surface elevation hierarchy (lighter = higher).
- **Poor image treatment**: Images designed for light backgrounds look wrong on dark.

### Theme Switching Without Jarring Transitions

- The **View Transitions API** enables smooth morphing animations between theme states.
- A circular reveal animation (expanding from the toggle button) is a popular polished approach.
- Use `flushSync()` in React to ensure DOM updates are synchronous during transition.
- **Debounce rapid toggling** to prevent overlapping animations.
- System preference auto-detection (prefers-color-scheme) should be the default, with manual override.

### Takeaway for Onyx

Onyx's dark theme (dark gray, not pure black) aligns with best practices. The three-theme system (dark/light/warm) is good. A smooth transition animation using CSS transitions or the View Transitions API would add polish. Ensure all accent colors are tested against the dark background for legibility.

---

## 10. Mobile vs Desktop

### Feature Parity Expectations

The consensus: **don't aim for parity**. "Many responsive sites do not have 100% feature parity; instead, they remove functionality that is rarely needed on mobile."

**What mobile users need (in priority order):**
1. Quick capture -- creating a new note must be faster than opening the physical app.
2. Search and retrieval -- finding an existing note quickly.
3. Basic editing -- text, formatting, checklists.
4. Reading / review -- consuming existing notes.

**What to cut or simplify:**
- Graph view
- Split panes
- Complex sidebar navigation (collapse to a hamburger or search-first)
- Property editing (show, but defer complex editing to desktop)
- Plugin/extension management

### App-Specific Mobile Assessment

- **Obsidian mobile**: "UI is awkward on a smartphone as it's trying to replicate the desktop UI." Has improved over time but still fights the small screen.
- **Notion mobile**: "Seamless mobile experience" with instant sync, but "complex databases can be harder to navigate on smaller screens."
- **Bear**: Native iOS app. Considered one of the best mobile note-taking experiences because it was designed mobile-first with gestures.
- **Craft**: Apple-native with excellent mobile parity. Voice notes on mobile.

### Takeaway for Onyx

Onyx is a Tauri desktop app. If mobile ever comes, it should be a capture + read + light-edit experience, not a port of the desktop UI. The "for a digital note-taking tool to succeed, creating a new note must require less effort than scribbling on a business card" principle should guide mobile design.

---

## 11. Innovative / Novel Approaches

### Heptabase: Spatial/Canvas Thinking

Notes as cards on infinite whiteboards. Organize by spatial position and visual clustering rather than folders or tags. Whiteboards can nest within each other. Cards can appear on multiple whiteboards. "Helps users think visually, connect ideas, and manage knowledge on an infinite canvas."

**What's novel:** Navigation is *spatial*. You remember where you put something, not what folder it's in. This maps to how human spatial memory works.

### Tana: Supertags and Structured Data

Every note is a node. "Supertags" apply templates and metadata schemas to nodes. A tag isn't just a label -- it's a type definition with fields, views, and behaviors. Everything is a reference; nothing is siloed.

**What's novel:** Bridges the gap between note-taking and database without Notion's block heaviness. The type system makes notes queryable without a query language.

### Capacities: Object-Oriented Notes

Replaces files and folders with typed objects. A person, a book, a meeting, a project -- each with its own properties and relationships. "AI assists with organization and linking rather than trying to be your writing partner."

**What's novel:** The ontology is the organization system. You don't organize notes *about* things -- the things themselves are the notes. Eliminates the "where do I put this?" problem.

### Mem 2.0: AI-Native

Complete rebuild (October 2025) with an "agentic AI layer that can act on your notes instead of only organising them." Voice capture, offline support, and AI that actively surfaces related information.

**What's novel:** Notes as a dataset for an AI agent rather than a file system for a human. The app's value proposition shifts from "organize your notes" to "your notes work for you."

### Raycast Notes: Speed as Feature

From the launcher makers. "Fast, light and frictionless note-taking" with navigation that lets you "quickly switch notes while keeping focus on a single note." Designed for capture speed above all else.

**What's novel:** Note-taking as a feature of a launcher, not a standalone app. Capture happens in the flow of other work without a context switch.

### Amplenote: Task + Note Unification

Notes and tasks live in the same system. A note can contain tasks; tasks link back to notes. Calendar integration shows tasks temporally. "Keyboard shortcuts cover all major features and navigation."

**What's novel:** Treats notes and tasks as the same medium rather than separate apps that sync.

### Lessons for Onyx

The most transferable ideas:
1. **Capacities' typed objects** -- Onyx already has this via object types + frontmatter. Push it further.
2. **Heptabase's spatial thinking** -- Canvas view (Phase 10) could be powerful if it connects to the existing note graph.
3. **Tana's supertags** -- Onyx's typed objects could grow into something similar with per-type views and queries.
4. **Raycast's speed-first philosophy** -- Every interaction in Onyx should feel instant. RAM efficiency is already a differentiator. Keep it.

---

## Sources

### Navigation & General UX
- [NoteApps.info: 41 note apps compared across 345 features](https://noteapps.info/)
- [7 Best Obsidian Alternatives in 2026](https://get-alfred.ai/blog/best-obsidian-alternatives)
- [Notion vs Obsidian: All Features Compared (2026)](https://productive.io/blog/notion-vs-obsidian/)
- [Compare note apps: Bear, Craft, Obsidian, Notion](https://noteapps.info/apps/compare?note_app=bear+craft+notion+obsidian)

### Editor UX & Block-Based Editing
- [Best Markdown Editors and Tools in 2025 (CSVMD)](https://csvmd.com/best-markdown-editors-2025/)
- [Obsidian vs Logseq 2026: Which Note-Taking App Wins?](https://thesoftwarescout.com/obsidian-vs-logseq-2026-which-note-taking-app-wins/)
- [Obsidian, Notion, Logseq: The Note-Taking Stack (DEV Community)](https://dev.to/dev_tips/obsidian-notion-logseq-the-note-taking-stack-that-doesnt-suck-for-devs-2cf7)
- [Obsidian Live Preview Update](https://help.obsidian.md/Live+preview+update)

### Sidebar Design
- [Best UX Practices for Designing a Sidebar (UX Planet)](https://uxplanet.org/best-ux-practices-for-designing-a-sidebar-9174ee0ecaa2)
- [Sidebar Design for Web Apps: UX Best Practices 2026](https://www.alfdesigngroup.com/post/improve-your-sidebar-design-for-web-apps)
- [Sidebar UI Design: Best Practices (Mobbin)](https://mobbin.com/glossary/sidebar)
- [Obsidian Sidebar Documentation](https://help.obsidian.md/sidebar)

### Command Palette & Keyboard Design
- [How to Build a Remarkable Command Palette (Superhuman)](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- [Command Palette UX Patterns (Alicja Suska)](https://medium.com/design-bootcamp/command-palette-ux-patterns-1-d6b6e68f30c1)
- [Designing Command Palettes (Sam Solomon)](https://solomon.io/designing-command-palettes/)
- [The UX of Keyboard Shortcuts (Medium)](https://medium.com/design-bootcamp/the-art-of-keyboard-shortcuts-designing-for-speed-and-efficiency-9afd717fc7ed)
- [Command Palette: Past, Present, and Future](https://www.command.ai/blog/command-palette-past-present-and-future/)

### Dark Mode & Theming
- [Dark Mode Design: Trends, Myths, and Common Mistakes](https://webwave.me/blog/dark-mode-design-trends)
- [Dark UI Design Best Practices 2025 (Night Eye)](https://nighteye.app/dark-ui-design/)
- [Complete Dark Mode Design Guide (UI Deploy)](https://ui-deploy.com/blog/complete-dark-mode-design-guide-ui-patterns-and-implementation-best-practices-2025)
- [Dark Mode UI: Best Practices and Common Mistakes (UXVerse)](https://medium.com/@UXVerse/dark-mode-ui-best-practices-and-common-mistakes-to-avoid-a96d7e5c9709)

### Search & Navigation
- [Alfred vs Raycast (Josh Collinsworth)](https://joshcollinsworth.com/blog/alfred-raycast)
- [Raycast Fuzzy Search Changelog](https://www.raycast.com/changelog/1-40-0)
- [Raycast Notes: Fast, Light, Frictionless](https://www.raycast.com/core-features/notes)

### Tab Management
- [Tabs UX: Best Practices (Eleken)](https://www.eleken.co/blog-posts/tabs-ux)
- [Arc Browser: Rethinking the Web (Bootcamp)](https://medium.com/design-bootcamp/arc-browser-rethinking-the-web-through-a-designers-lens-f3922ef2133e)
- [UX Analysis of Arc, Opera, and Edge (LogRocket)](https://blog.logrocket.com/ux-design/ux-analysis-arc-opera-edge/)

### Onboarding & Empty States
- [Empty State UX Examples (Eleken)](https://www.eleken.co/blog-posts/empty-state-ux)
- [Empty States, Error States & Onboarding (Raw.Studio)](https://raw.studio/blog/empty-states-error-states-onboarding-the-hidden-ux-moments-users-notice/)
- [Empty State UI Pattern (Mobbin)](https://mobbin.com/glossary/empty-state)

### Mobile vs Desktop
- [UI/UX Design in 2025: Mobile vs Desktop (Digipixel)](https://digipixel.sg/ui-ux-design-in-2025-mobile-vs-desktop-what-designers-absolutely-must-know/)
- [Obsidian for Android Review 2025](https://www.noteapps.ca/obsidian-for-android-review-2025/)

### Innovative Apps
- [Heptabase: Revolutionizing Knowledge Management](https://eryinote.com/post/1083)
- [The Second Brain Apps That Will Redefine Thinking in 2026](https://www.supernormal.com/blog/best-second-brain-apps)
- [Heptabase vs Tana: Best PKM App of 2025](https://paperlessmovement.com/videos/heptabase-vs-tana-which-is-the-best-note-taking-and-pkm-app-of-2025/)
- [Compare: Capacities, Tana, Heptabase](https://noteapps.info/apps/compare?note_app=capacities+heptabase+tana)

### Obsidian User Feedback
- [2025 Obsidian Report Card (Practical PKM)](https://practicalpkm.com/2025-obsidian-report-card/)
- [2026 Obsidian Report Card (Practical PKM)](https://practicalpkm.com/2026-obsidian-report-card/)
- [Bear: The Elegant Note-Taking App (Scalarly)](https://www.scalarly.com/startup-stack/bear-the-elegant-note-taking-app-for-apple-users/)
- [Bear is the Best Note-Taking App (XDA)](https://www.xda-developers.com/bear-is-the-best-note-taking-app-and-its-not-even-close/)

### Vim/Emacs Philosophy
- [Vim Editor Guide: Philosophy, Navigation, and Power Features](https://www.pudn.club/programming/vim-editor-guide-philosophy-navigation-and-power-features/)
- [Learning Emacs Key Bindings](https://yiufung.net/post/emacs-key-binding-conventions-and-why-you-should-try-it/)
