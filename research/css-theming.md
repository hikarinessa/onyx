# CSS Theming Research for Onyx

Research on building a styleable, themeable desktop note-taking app with plain CSS, CSS custom properties, and CodeMirror 6. Compiled March 2026.

---

## 1. CSS Custom Property Architecture

### Token Hierarchy

The industry-standard approach uses three layers of abstraction:

1. **Primitive tokens** — raw values with no semantic meaning. The palette.
   ```css
   --color-violet-500: #8b7cf6;
   --color-neutral-900: #0e0e12;
   --spacing-4: 16px;
   ```

2. **Semantic tokens** — purpose-driven names that reference primitives. These are what themes swap.
   ```css
   --bg-base: var(--color-neutral-900);
   --text-primary: var(--color-neutral-100);
   --accent: var(--color-violet-500);
   ```

3. **Component tokens** — scoped to individual components. Optional for small apps, useful when components have complex states.
   ```css
   --tab-bg: var(--bg-surface);
   --tab-bg-active: var(--bg-elevated);
   --tab-border: var(--border-subtle);
   ```

**Onyx currently uses semantic tokens only** (layer 2), which is fine for ~63 variables. Adding a primitive layer becomes valuable when you want users to create themes — they swap primitives, and semantic tokens cascade automatically.

### Naming Conventions

**GitHub Primer** uses a functional naming pattern: `--color-fg-default`, `--color-bg-subtle`, `--color-border-muted`. The structure is `--{category}-{element}-{variant}`.

**VS Code** uses a dot-like namespace: `editor.background`, `editor.foreground`, `activityBar.background`. These map to flat CSS variables in web contexts.

**Obsidian** uses a hybrid approach with 400+ variables organized into foundation, semantic, component, and context-specific layers. Variables follow the pattern `--{component}-{property}-{variant}` (e.g., `--nav-item-background-hover`).

**Recommended pattern for Onyx** (current approach is already close):
```
--{category}-{variant}     for semantic tokens:  --bg-base, --text-secondary
--{component}-{property}   for component tokens: --tab-bg, --sidebar-width
```

This flat namespace avoids over-nesting while remaining scannable. No need for BEM-style double underscores in CSS variables.

### Theme Switching with Custom Properties

The mechanism Onyx already uses (iterating over a theme object and calling `root.style.setProperty()`) is the standard approach. The key optimization: instead of setting every property individually, toggle a class or data attribute on `:root` and let CSS selectors handle the rest:

```css
:root[data-theme="dark"] {
  --bg-base: #0e0e12;
  --text-primary: #e8e8ec;
}
:root[data-theme="light"] {
  --bg-base: #ffffff;
  --text-primary: #1d1d1f;
}
```

This approach:
- Is faster (single DOM operation to switch themes)
- Allows CSS-only theme definitions (no JS objects needed for built-in themes)
- Still supports runtime overrides via `style.setProperty()` for user themes

The JS `setProperty()` approach is needed for user-defined themes loaded from JSON. Both can coexist: built-in themes use `data-theme` attribute selectors, user themes apply overrides via JS.

---

## 2. Theme File Formats

### How Other Apps Do It

**VS Code**: JSON files with flat key-value color mappings. Separate `colors` (UI) and `tokenColors` (syntax) sections. Themes can inherit from a base via `"include": "./base-theme.json"`. Theme extensions are distributed as VSIX packages.

**Obsidian**: Single CSS file per theme + manifest.json for metadata. Themes override CSS variables. User snippets layer on top. The `obsidian-style-settings` plugin allows themes to expose configurable options via YAML comments in CSS:
```css
/* @settings
name: My Theme Settings
id: my-theme
settings:
  - id: accent-hue
    title: Accent Hue
    type: variable-number-slider
    default: 260
    min: 0
    max: 360
*/
```

**Zettlr**: Separates geometry (layout) from visual theme. User custom CSS applies on top. Targets elements via IDs and classes.

### Recommended Approach for Onyx

A JSON theme file that maps to CSS custom properties:

```json
{
  "id": "rosepine",
  "name": "Rose Pine",
  "base": "dark",
  "colors": {
    "bg-base": "#191724",
    "bg-surface": "#1f1d2e",
    "bg-elevated": "#26233a",
    "text-primary": "#e0def4",
    "text-secondary": "#908caa",
    "accent": "#c4a7e7",
    "link-color": "#9ccfd8"
  },
  "syntax": {
    "heading": "#e0def4",
    "bold": "#e0def4",
    "italic": "#f6c177",
    "code": "#9ccfd8",
    "link": "#c4a7e7",
    "tag": "#31748f"
  }
}
```

Key design decisions:
- **`base` field**: Inherit from "dark" or "light" built-in theme. User theme only overrides what it specifies.
- **Separate `colors` and `syntax`**: UI colors and editor syntax colors are independent concerns.
- **No `--` prefix in JSON keys**: Add the prefix at load time. Cleaner for theme authors.
- **No layout/geometry tokens in themes**: Fonts, spacing, and dimensions are user preferences, not theme properties. Keep them separate.

### Loading at Runtime

```typescript
function applyUserTheme(theme: ThemeJSON) {
  // Start from base
  const base = builtInThemes.find(t => t.id === theme.base);
  if (base) applyTheme(base.id);

  // Layer overrides
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${key}`, value);
  }
  // Syntax colors map to --syntax-{name}
  for (const [key, value] of Object.entries(theme.syntax ?? {})) {
    root.style.setProperty(`--syntax-${key}`, value);
  }
}
```

### What to Expose vs. Lock Down

**Expose to theme authors:**
- All color tokens (backgrounds, text, borders, accents, status, syntax)
- Accent color (single source, derive variants)
- Syntax highlighting colors

**Lock down (not themeable):**
- Layout dimensions (sidebar width, titlebar height, statusbar height)
- Border radii (these affect hit targets and layout)
- Transition durations (these affect perceived responsiveness)
- Font families (separate user preference, not theme concern)
- Z-index values

---

## 3. Color System Design

### OKLCH Over HSL

**OKLCH is the recommended color space for modern theming.** Supported in Safari 15.4+, Chrome 111+, Firefox 113+ (>92% global support as of 2025). Since Onyx targets Tauri 2 with WKWebView (Safari 16+), OKLCH is safe to use.

Why OKLCH beats HSL:
- **Perceptually uniform**: A 10% lightness change looks the same across all hues. HSL's "50% lightness" produces wildly different perceived brightness for yellow vs. blue.
- **Predictable contrast**: Easier to meet WCAG requirements because lightness values are perceptually meaningful.
- **Better palette generation**: Adjusting lightness doesn't cause unexpected desaturation (a common HSL problem).
- **P3 gamut**: Can represent wider-gamut colors that modern displays support.

### Accent Color System

Use a single accent hue and derive all variants:

```css
:root {
  --accent-h: 265;  /* hue in oklch degrees */
  --accent-c: 0.18; /* chroma */
  --accent-l: 0.62; /* lightness */

  --accent: oklch(var(--accent-l) var(--accent-c) var(--accent-h));
  --accent-hover: oklch(calc(var(--accent-l) + 0.08) var(--accent-c) var(--accent-h));
  --accent-muted: oklch(var(--accent-l) calc(var(--accent-c) * 0.4) var(--accent-h) / 0.15);
  --accent-text: oklch(calc(var(--accent-l) + 0.15) calc(var(--accent-c) * 0.8) var(--accent-h));
}
```

Users change one value (`--accent-h`) and the entire accent system updates. This is how Obsidian handles its accent color — they expose `--accent-h`, `--accent-s`, `--accent-l` as HSL components.

For Onyx, the OKLCH approach is better because it produces more consistent results across different hues.

### Light vs. Dark Mode Color Strategy

**Not a simple inversion.** Key principles:
- Dark backgrounds should be off-black (e.g., `#0e0e12`), not pure black. Pure black causes halation on OLED.
- Dark mode text should be off-white (e.g., `#e8e8ec`), not pure white. Reduces eye strain.
- Dark mode needs ~20 points lower saturation than light mode for the same perceived vibrancy.
- Surface elevation in dark mode is communicated by lighter backgrounds (opposite of light mode shadows).
- Semantic colors (error, warning, success) need separate palettes per mode — a red that meets contrast on white won't on dark gray.

**Contrast requirements (WCAG 2.1):**
- Normal text: >= 4.5:1 against background
- Large text (18pt+ or 14pt bold): >= 3:1
- UI components and borders: >= 3:1 against adjacent colors

### Syntax Highlighting Across Themes

Define semantic syntax token names that each theme maps independently:

```
--syntax-heading
--syntax-bold
--syntax-italic
--syntax-code
--syntax-link
--syntax-tag
--syntax-comment
--syntax-string
--syntax-keyword
--syntax-property
```

Each theme provides its own values. This decouples syntax colors from the accent system — themes can have a purple accent but green strings.

---

## 4. Typography

### Font Stack Recommendations

Onyx already uses a strong font stack:
- **Editor**: Literata (serif, variable font) — excellent for long-form reading
- **UI**: DM Sans (geometric sans) — clean, good at small sizes
- **Code**: IBM Plex Mono — wide character set, good legibility

Variable fonts (like Literata) are ideal for theming because:
- Single file replaces entire font family (reducing HTTP requests, though not relevant for Tauri)
- Weight can be continuously adjusted (not locked to 400/700 steps)
- Optical sizing improves legibility at small and large sizes automatically
- Width axis can adapt to different content widths

### Readability Research

**Line height:**
- Body text: 1.5-1.6x font size is the sweet spot (research shows 20% improvement in reading accuracy over 1.0x)
- Headings: 1.1-1.3x (tighter for large text)
- Code blocks: 1.4-1.5x
- Longer lines need more line height — the eye struggles to find the next line start

**Line length (content width):**
- Optimal: 55-75 characters per line
- WCAG recommendation: max 80 characters
- Academic consensus: 66 characters is the sweet spot
- Enforce via `max-width` on the editor content area, typically 680-740px at 16px body size

**Letter spacing:**
- Body text: default (0) or very slight positive (+0.01em)
- UI labels at small sizes: +0.02-0.04em improves legibility
- Headings at large sizes: -0.01 to -0.02em (optical tightening)
- Monospace: default spacing, never tighten

**Font size:**
- Editor body: 16-18px is the range. Let users choose.
- UI chrome: 12-13px for labels, 11px for status bar
- Minimum accessible size: 12px (some guidelines say 14px)

### User Font Customization Without Breaking Layout

Expose these as user preferences (not theme properties):
```css
--user-font-editor: "Literata";
--user-font-size: 16px;
--user-line-height: 1.6;
--user-content-width: 720px;
```

Guard against layout breakage:
- Clamp font size: `clamp(12px, var(--user-font-size), 28px)`
- Clamp line height: `clamp(1.2, var(--user-line-height), 2.2)`
- Clamp content width: `clamp(480px, var(--user-content-width), 960px)`
- Never use fixed pixel heights on containers that hold text — use `min-height` or `padding`
- Test with extremes: 12px + 2.0 line height, 24px + 1.2 line height

---

## 5. CSS Architecture

### File Organization for ~1200 Lines

Onyx currently uses three files: reset.css, theme.css, layout.css (779 lines). At this scale, a single layout file is manageable, but as it grows, consider splitting by concern:

```
styles/
  reset.css          — CSS reset (stable, rarely touched)
  tokens.css         — All CSS custom properties and theme definitions
  base.css           — Element-level styles (body, headings, links, code)
  layout.css         — Structural layout (grid, sidebar, panels, editor area)
  components.css     — Component-specific styles (tabs, calendar, menus)
  editor.css         — CodeMirror overrides and editor content styles
  animations.css     — Transitions, keyframes, motion preferences
```

**When to split**: When you find yourself scrolling past unrelated blocks to reach what you're editing. The 400-500 line mark per file is a reasonable threshold.

### CSS Layers for Specificity Control

`@layer` is the modern solution for managing style priority without specificity hacks. Supported in all modern browsers since 2022. Ideal for Onyx's architecture where app chrome, editor content, and potential user themes need to coexist:

```css
@layer reset, tokens, base, layout, components, editor, overrides;

@layer reset {
  /* reset.css content */
}

@layer tokens {
  :root { --bg-base: #0e0e12; /* ... */ }
  :root[data-theme="light"] { --bg-base: #ffffff; /* ... */ }
}

@layer components {
  .sidebar { /* ... */ }
  .tab-bar { /* ... */ }
}

@layer editor {
  .cm-editor { /* ... */ }
  .cm-content { /* ... */ }
}

@layer overrides {
  /* User theme overrides applied via JS land on this layer */
}
```

Styles in later layers always beat earlier layers, regardless of selector specificity. This means:
- Editor styles can use simple selectors and still beat component styles
- User theme overrides always win without needing `!important`
- Third-party styles (CodeMirror defaults) can be contained in their own layer

### Scoping: Data Attributes Over BEM

For a React app without CSS Modules, data attributes are a lightweight scoping strategy:

```css
[data-component="sidebar"] { /* ... */ }
[data-component="sidebar"] .tree-item { /* ... */ }
```

Advantages over BEM:
- No naming ceremony (`.sidebar__tree-item--active` vs `.tree-item.active`)
- Works naturally with React's JSX (`data-component="sidebar"`)
- CSS nesting (now supported in all browsers) makes it clean:

```css
[data-component="sidebar"] {
  background: var(--bg-surface);

  .tree-item {
    padding: 4px 8px;
    &:hover { background: var(--bg-hover); }
    &.active { background: var(--bg-active); }
  }
}
```

### Avoiding Conflicts Between App Chrome and Editor Content

This is a real concern when the editor renders HTML-like content (headings, links, lists). Strategies:

1. **Scope editor content styles under `.cm-content`** — never use bare element selectors (`h1 { }`) globally
2. **Use `.cm-` prefix for all CodeMirror override classes**
3. **`@layer` separation** — editor layer styles cannot bleed into component layer and vice versa
4. **Reset inherited styles on `.cm-content`** — prevent app chrome typography from leaking into the editor

---

## 6. Animation and Transitions

### Theme Switching

**View Transitions API** enables smooth cross-fade between themes:

```typescript
function switchTheme(themeId: string) {
  if (!document.startViewTransition
      || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyTheme(themeId); // instant fallback
    return;
  }
  document.startViewTransition(() => {
    flushSync(() => applyTheme(themeId));
  });
}
```

**WebKit caveat**: View Transitions API support in Safari requires Safari 18+. Tauri 2 on macOS uses the system WKWebView, so support depends on the user's macOS version. Provide a graceful fallback: if `startViewTransition` is unavailable, apply immediately.

**Simpler alternative** (works everywhere): Transition custom properties directly:

```css
:root {
  transition: background-color 200ms ease,
              color 200ms ease;
}
```

This won't transition every property (CSS custom properties themselves can't be transitioned as of 2026), but the computed properties that use them will transition if those properties are transitionable. For a reliable cross-fade:

```css
body::after {
  content: '';
  position: fixed;
  inset: 0;
  background: var(--bg-base);
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
  z-index: 9999;
}
body.theme-switching::after {
  opacity: 1;
}
```

Add `theme-switching` class, wait 150ms, apply theme, remove class. Simple, reliable, no FOUC.

### Panel Animations

For sidebar and context panel show/hide:

```css
.sidebar {
  transform: translateX(0);
  transition: transform 200ms ease, opacity 200ms ease;
}
.sidebar[data-collapsed] {
  transform: translateX(-100%);
  opacity: 0;
}
```

Use `transform` and `opacity` exclusively — they're GPU-composited and don't trigger layout recalculation. Avoid animating `width` or `margin`.

### Micro-interactions

Native-feeling interactions:

```css
/* Button press */
button:active {
  transform: scale(0.97);
  transition: transform 80ms ease;
}

/* Focus ring */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Hover state fade */
.tree-item {
  transition: background-color 80ms ease;
}
```

Key durations:
- Hover feedback: 60-100ms (instant feel)
- Panel transitions: 150-250ms (smooth but not sluggish)
- Theme switch: 150-200ms (cross-fade)
- Tooltip delay: 400-600ms before show, 0ms hide

### Respecting prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Place this in the `reset` or `base` layer. Using `0.01ms` instead of `0ms` avoids breaking JS that listens for `transitionend` events. This is a blanket disable — individual elements can opt back in for essential motion (e.g., loading spinners) via more specific selectors.

---

## 7. CodeMirror 6 Theming

### How CM6 Themes Work

CM6 uses a CSS-in-JS system. Themes are extensions that:
1. Generate a unique CSS class name
2. Mount a `<style>` element with rules scoped to that class
3. Add the class to the editor's outer DOM element

Two APIs:
- **`EditorView.theme()`** — Creates a theme extension. Rules use `&` as a placeholder for the generated class.
- **`EditorView.baseTheme()`** — Lower-priority defaults. Uses `&light` and `&dark` placeholders for mode-specific rules.

```typescript
const myTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' },
  '.cm-content': { fontFamily: 'var(--font-editor)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-surface)', borderRight: 'none' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-muted)' },
});
```

### Integrating CM6 with App-Level CSS Variables

The key insight: **CM6's theme objects accept `var()` references.** This means you can define one CM6 theme extension that reads from CSS custom properties, and theme switching just works — change the CSS variables, and CM6 picks up the new values automatically. No need to reconfigure the editor or swap extensions.

```typescript
// Define ONCE, reads from CSS variables
const onyxEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-base)',
    color: 'var(--text-primary)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--accent-muted)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-tertiary)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)' },
  '.cm-foldGutter': { color: 'var(--text-tertiary)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-muted)' },
});
```

### Syntax Highlighting with CSS Variables

`HighlightStyle.define()` does **not** support `var()` references (it generates static CSS at definition time). Two workarounds:

**Option A: Generate HighlightStyle per theme switch** — Reconfigure the editor's syntax highlighting extension when the theme changes. Clean but requires a compartment and dispatch.

**Option B: Use `.cm-` class overrides in regular CSS** — CM6 assigns class names to syntax tokens. Override them in your stylesheet:

```css
/* In your app CSS, using custom properties */
.cm-content .tok-heading { color: var(--syntax-heading); font-weight: 700; }
.cm-content .tok-emphasis { color: var(--syntax-italic); font-style: italic; }
.cm-content .tok-strong { color: var(--syntax-bold); font-weight: 700; }
.cm-content .tok-link { color: var(--syntax-link); }
.cm-content .tok-comment { color: var(--syntax-comment); }
.cm-content .tok-string { color: var(--syntax-string); }
.cm-content .tok-keyword { color: var(--syntax-keyword); }
```

Option B is simpler and lets themes control syntax colors via CSS variables. The tradeoff: you bypass CM6's highlight style priority system, so you need your CSS to have sufficient specificity (an `@layer editor` solves this).

**The `codemirror-theme-vars` package** (by Anthony Fu) implements exactly this pattern — a CM6 theme that reads all colors from CSS variables like `--cm-foreground`, `--cm-background`, `--cm-comment`, etc. Worth examining as a reference implementation.

### How Other CM6 Apps Handle Theming

**Obsidian**: Uses 400+ CSS variables. Editor styles are overridden via regular CSS. Themes cascade on top. The `app.css` file defines all default variables.

**Zettlr**: Separates geometry (layout) from theme (colors). User custom CSS can override visual properties but is warned not to touch geometry. Uses IDs and classes for targeting.

**SilverBullet**: Uses CM6 with a simpler approach — fewer theme variables, tighter coupling between app and editor styles.

---

## 8. WebKit/Safari-Specific CSS

Since Tauri 2 on macOS uses WKWebView (the same engine as Safari), these constraints apply directly to Onyx.

### Features with Good Support

- **`oklch()` and `color-mix()`** — Supported since Safari 15.4 and 16.2 respectively. Safe to use.
- **CSS Nesting** — Supported since Safari 17.2. Safe for Tauri 2.
- **`@layer`** — Supported since Safari 15.4. Safe to use.
- **`backdrop-filter`** — Supported but **requires `-webkit-` prefix**. CSS variables do NOT work inside `-webkit-backdrop-filter` values in Safari. Use fixed values only.
- **CSS `color-scheme`** — Supported. Set `color-scheme: dark` to get native dark scrollbars and form controls.

### Features with Caveats

- **`scrollbar-color` and `scrollbar-width`** — The standard properties have limited/no support in WebKit as of early 2026. Use `::-webkit-scrollbar` pseudo-elements instead for WKWebView/Tauri:
  ```css
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--text-tertiary);
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--text-secondary);
  }
  ```
  Note: Some Tauri versions have reported issues with scrollbar styling not applying. Test with the actual Tauri webview.

- **`backdrop-filter`** with CSS variables — Does not work. If you want glassmorphism effects, hardcode the blur value:
  ```css
  .panel {
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
  }
  ```

- **View Transitions API** — Requires Safari 18+. The macOS version determines the WKWebView version in Tauri, so users on older macOS won't have this. Always provide a fallback.

### Font Rendering

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

This switches from sub-pixel antialiasing to grayscale antialiasing, making text appear thinner and crisper on macOS. This is the standard for dark-background apps — sub-pixel antialiasing on dark backgrounds causes color fringing. Apple deprecated sub-pixel antialiasing in macOS Mojave anyway, but the property is still respected by WKWebView.

### Other WebKit Considerations

- **`-webkit-user-select: none`** on app chrome elements (titlebar, sidebar labels) prevents text selection where it's not useful
- **`-webkit-app-region: drag`** on the titlebar for native window dragging in Tauri
- **`overflow: overlay`** is deprecated but was commonly used for overlay scrollbars. Use `overflow: auto` with styled `::-webkit-scrollbar` instead.
- **CSS `env(safe-area-inset-*)`** — Relevant if Onyx ever targets iPadOS via Tauri mobile.

---

## 9. Recommendations for Onyx

### Immediate (Low Effort, High Impact)

R1. **Add `data-theme` attribute switching** — Move built-in theme definitions into CSS (`:root[data-theme="dark"]`, etc.) instead of JS objects. Keep JS `setProperty()` for user themes only. Reduces theme-switch overhead and keeps CSS as the source of truth.

R2. **Add `@layer` declarations** — Wrap existing CSS in layers (`reset`, `tokens`, `base`, `layout`, `components`, `editor`). Zero visual change, but establishes the foundation for user themes and prevents future specificity conflicts.

R3. **Bridge CM6 theme to CSS variables** — Define one `EditorView.theme()` that uses `var()` references. Theme switching then requires zero editor reconfiguration.

R4. **Add `prefers-reduced-motion` blanket disable** — A few lines in reset.css. Covers accessibility with minimal effort.

### Medium Term (Phase 8-9 Timeframe)

R5. **Introduce primitive color tokens with OKLCH** — Define the palette in OKLCH, derive semantic tokens from primitives. Enables the accent color picker feature.

R6. **Define a JSON theme format** — Specify which variables themes can set, document them, support `base` inheritance. Ship with a `/themes` directory.

R7. **Syntax highlighting via CSS variables** — Define `--syntax-*` tokens, override `.tok-*` classes in CSS. Decouple syntax colors from the CM6 JS theme system.

R8. **User typography preferences** — Expose font family, size, line height, and content width as separate settings (not part of themes). Persist in `~/.onyx/preferences.json`.

### Long Term (Phase 10+)

R9. **Theme editor/preview** — Live preview as users adjust colors. Show contrast ratios. Warn if accessibility thresholds are violated.

R10. **Community theme format** — JSON file + metadata, loadable from `~/.onyx/themes/`. Validate on load, reject themes with missing required tokens.

---

## Sources

### Design Tokens & Architecture
- [The developer's guide to design tokens and CSS variables](https://penpot.app/blog/the-developers-guide-to-design-tokens-and-css-variables/)
- [CSS Variables Guide: Design Tokens & Theming](https://www.frontendtools.tech/blog/css-variables-guide-design-tokens-theming-2025)
- [Best Practices For Naming Design Tokens, Components And Variables (Smashing Magazine)](https://www.smashingmagazine.com/2024/05/naming-best-practices/)
- [Naming Tokens in Design Systems (EightShapes)](https://medium.com/eightshapes-llc/naming-tokens-in-design-systems-9e86c7444676)
- [Color usage (GitHub Primer)](https://primer.style/product/getting-started/foundations/color-usage/)
- [GitHub Primer Primitives](https://github.com/primer/primitives)
- [Building a VS Code Theme with Style Dictionary](https://dbanks.design/blog/vs-code-theme-with-style-dictionary/)

### Theme Formats & Obsidian
- [Build a theme (Obsidian Developer Documentation)](https://docs.obsidian.md/Themes/App+themes/Build+a+theme)
- [CSS Variables Reference (Obsidian)](https://deepwiki.com/obsidianmd/obsidian-developer-docs/3.3-css-variables-reference)
- [About styling (Obsidian)](https://docs.obsidian.md/Reference/CSS+variables/About+styling)
- [Obsidian Style Settings Plugin](https://github.com/mgmeyers/obsidian-style-settings)
- [1.0 Theme migration guide (Obsidian)](https://obsidian.md/blog/1-0-theme-migration-guide/)

### Color Systems
- [OKLCH in CSS: why we moved from RGB and HSL (Evil Martians)](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
- [The Ultimate OKLCH Guide](https://oklch.org/posts/ultimate-oklch-guide)
- [Light & Dark Color Modes in Design Systems (EightShapes)](https://medium.com/eightshapes-llc/light-dark-9f8ea42c9081)
- [Designing a Scalable and Accessible Dark Theme](https://www.fourzerothree.in/p/scalable-accessible-dark-mode)
- [Dark Mode UI Design: 7 Best Practices](https://atmos.style/blog/dark-mode-ui-best-practices)
- [Adaptive, simplified design system colors](https://www.gfor.rest/blog/advanced-design-utils-colors)
- [Automatic Color Theming](https://ryanfeigenbaum.com/generate-a-color-palette/)

### Typography
- [Typography Best Practices: The Ultimate 2026 Guide](https://www.adoc-studio.app/blog/typography-guide)
- [Optimal Line Length for Readability (UXPin)](https://www.uxpin.com/studio/blog/optimal-line-length-for-readability/)
- [How do I adjust letter spacing and line length for readability?](https://cieden.com/book/sub-atomic/typography/letter-spacing-and-line-length)
- [Improving Readability with line-height and letter-spacing](https://handoff.design/web-typography/readability-spacing.html)
- [Variable Fonts: Reduce Bloat And Fix Layout Shifts](https://inkbotdesign.com/variable-fonts/)

### CSS Architecture
- [CSS Cascade Layers vs. BEM vs. Utility Classes (Smashing Magazine)](https://www.smashingmagazine.com/2025/06/css-cascade-layers-bem-utility-classes-specificity-control/)
- [@layer (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer)
- [Cascade Layers Guide (CSS-Tricks)](https://css-tricks.com/css-cascade-layers/)
- [Custom CSS (Zettlr)](https://docs.zettlr.com/en/guides/custom-css/)

### Animations & Transitions
- [Full-page theme toggle with View Transitions API](https://akashhamirwasia.com/blog/full-page-theme-toggle-animation-with-view-transitions-api/)
- [Animated Dark Mode Toggle with View Transitions API in React](https://notanumber.in/blog/animated-dark-mode-toggle-with-view-transitions-api-in-react)
- [prefers-reduced-motion (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- [Respecting Users' Motion Preferences (Smashing Magazine)](https://www.smashingmagazine.com/2021/10/respecting-users-motion-preferences/)
- [Ten tips for better CSS transitions and animations](https://joshcollinsworth.com/blog/great-transitions)

### CodeMirror 6 Theming
- [CodeMirror Styling Example (official)](https://codemirror.net/examples/styling/)
- [codemirror-theme-vars (Anthony Fu)](https://github.com/antfu/codemirror-theme-vars)
- [Dynamic Themes with CodeMirror](https://rodydavis.com/posts/codemirror-dynamic-theme)
- [Assigning CSS variables through EditorView.theme()](https://discuss.codemirror.net/t/assigning-css-variables-through-editorview-theme/9681)

### WebKit/Safari
- [Safari WebKit CSS Bugs and Workarounds](https://docs.bswen.com/blog/2026-03-12-safari-css-issues-workarounds/)
- [WebKit Features in Safari 18.0](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/)
- [::-webkit-scrollbar (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::-webkit-scrollbar)
- [scrollbar-color (WebKit standards position)](https://github.com/WebKit/standards-positions/issues/134)
- [Tauri Webview Versions](https://v2.tauri.app/reference/webview-versions/)
