/**
 * Command registry — every action in the app is a command.
 * Used by the command palette, menu bar, and keyboard shortcuts.
 */

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: string;
  execute: () => void | Promise<void>;
}

const commands = new Map<string, Command>();

export function registerCommand(cmd: Command) {
  commands.set(cmd.id, cmd);
}

export function getAllCommands(): Command[] {
  return Array.from(commands.values());
}

/** Simple fuzzy match: all query chars must appear in order */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}
