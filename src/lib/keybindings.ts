/**
 * Keybinding registry — maps key combos to command IDs.
 *
 * Global-scope bindings are dispatched by the window keydown handler in App.tsx.
 * Editor-scope bindings are dispatched by CM6 keymaps (registered here for
 * display in a future settings UI, but not dispatched from here).
 */

export interface KeyBinding {
  id: string;           // command ID, e.g. "file.quickOpen"
  defaultKey: string;   // e.g. "Cmd+O"
  key: string;          // current binding (may differ from default if user overrode)
  scope: "global" | "editor";
}

const registry = new Map<string, KeyBinding>();

/** Register a keybinding. If already registered, overwrites. */
export function registerKeybinding(
  id: string,
  defaultKey: string,
  scope: "global" | "editor"
) {
  const existing = registry.get(id);
  registry.set(id, {
    id,
    defaultKey,
    key: existing?.key !== existing?.defaultKey && existing ? existing.key : defaultKey,
    scope,
  });
}

/** Get the current key combo string for a command, or undefined. */
export function getBinding(id: string): string | undefined {
  return registry.get(id)?.key;
}

/** Return all registered keybindings (snapshot). */
export function getAllBindings(): KeyBinding[] {
  return Array.from(registry.values());
}

/** Override the key for a command. */
export function setUserOverride(id: string, newKey: string) {
  const binding = registry.get(id);
  if (binding) {
    binding.key = newKey;
  }
}

/** Reset a single binding to its default. */
export function resetBinding(id: string) {
  const binding = registry.get(id);
  if (binding) {
    binding.key = binding.defaultKey;
  }
}

/** Reset all bindings to defaults. */
export function resetAll() {
  for (const binding of registry.values()) {
    binding.key = binding.defaultKey;
  }
}

/** Apply saved user overrides (e.g. loaded from Rust/disk). */
export function loadUserOverrides(overrides: { command: string; key: string }[]) {
  for (const o of overrides) {
    const binding = registry.get(o.command);
    if (binding) {
      binding.key = o.key;
    }
  }
}

/** Return command IDs that are currently bound to the given key combo. */
export function getConflicts(key: string): string[] {
  const ids: string[] = [];
  for (const binding of registry.values()) {
    if (binding.key === key) ids.push(binding.id);
  }
  return ids;
}

/**
 * Convert a KeyboardEvent into a canonical combo string.
 * Modifier order: Ctrl+Cmd+Alt+Shift+<key>
 * Uses "Cmd" for metaKey, "Alt" for altKey.
 */
export function parseKeyCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Cmd");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // Ignore standalone modifier presses
  const ignore = new Set([
    "Control",
    "Meta",
    "Alt",
    "Shift",
  ]);
  if (ignore.has(e.key)) return "";

  // Normalise the key portion to a consistent casing / name
  let key = e.key;
  if (key.length === 1) {
    key = key.toUpperCase();
  } else if (key === "ArrowLeft") {
    key = "Left";
  } else if (key === "ArrowRight") {
    key = "Right";
  } else if (key === "ArrowUp") {
    key = "Up";
  } else if (key === "ArrowDown") {
    key = "Down";
  } else if (key === " ") {
    key = "Space";
  }

  parts.push(key);
  return parts.join("+");
}

// ---------------------------------------------------------------------------
// Lookup helpers for the global keydown dispatcher
// ---------------------------------------------------------------------------

/** Build a Map from key combo → command ID for all global-scope bindings. */
export function getGlobalKeyMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const binding of registry.values()) {
    if (binding.scope === "global") {
      map.set(binding.key, binding.id);
    }
  }
  return map;
}

/**
 * Normalise a human-readable combo into the same format parseKeyCombo produces.
 *
 * Accepts shortcuts written for display (e.g. "Cmd+Opt+[", "Ctrl+Shift+Tab")
 * and returns the canonical form that parseKeyCombo would emit for the
 * corresponding KeyboardEvent.
 *
 * Modifier order out: Ctrl+Cmd+Alt+Shift+<key>
 */
export function normaliseCombo(combo: string): string {
  const tokens = combo.split("+");
  let ctrl = false;
  let cmd = false;
  let alt = false;
  let shift = false;
  let key = "";

  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower === "ctrl") ctrl = true;
    else if (lower === "cmd" || lower === "meta") cmd = true;
    else if (lower === "alt" || lower === "opt") alt = true;
    else if (lower === "shift") shift = true;
    else key = t.length === 1 ? t.toUpperCase() : t;
  }

  const parts: string[] = [];
  if (ctrl) parts.push("Ctrl");
  if (cmd) parts.push("Cmd");
  if (alt) parts.push("Alt");
  if (shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}
