import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { invoke } from "@tauri-apps/api/core";
import { slashCommandCompletion } from "./slashCommands";

/**
 * Wikilink autocomplete: triggered by [[
 * Tag autocomplete: triggered by #
 */

interface SearchResult {
  path: string;
  title: string | null;
}

interface TagInfo {
  tag: string;
  count: number;
}

async function wikilinkCompletion(
  context: CompletionContext
): Promise<CompletionResult | null> {
  // Match [[ or ![[ followed by any characters
  const match = context.matchBefore(/!?\[\[([^\]]*)/);
  if (!match) return null;

  // The prefix is everything after [[ (or ![[)
  const bracketIdx = match.text.indexOf("[[");
  const prefix = match.text.slice(bracketIdx + 2);
  const from = match.from + bracketIdx + 2; // position after [[

  try {
    let results: SearchResult[];
    if (prefix.trim() === "") {
      results = await invoke<SearchResult[]>("get_all_titles");
    } else {
      results = await invoke<SearchResult[]>("search_files", {
        query: prefix,
      });
    }

    return {
      from,
      options: results.slice(0, 20).map((r) => {
        const title =
          r.title || r.path.split("/").pop()?.replace(/\.md$/, "") || r.path;
        return {
          label: title,
          type: "text",
          apply: title + "]]",
        };
      }),
      filter: true,
    };
  } catch {
    return null;
  }
}

async function tagCompletion(
  context: CompletionContext
): Promise<CompletionResult | null> {
  // Match # followed by word characters (at word boundary or start of line)
  const match = context.matchBefore(/(?:^|[\s])#([a-zA-Z][a-zA-Z0-9_/-]*)/);
  if (!match) return null;

  // Find the # position
  const hashIdx = match.text.lastIndexOf("#");
  const from = match.from + hashIdx + 1; // position after #

  try {
    const tags = await invoke<TagInfo[]>("get_all_tags");

    return {
      from,
      options: tags.map((t) => ({
        label: t.tag,
        detail: `${t.count}`,
        type: "keyword",
      })),
      filter: true,
    };
  } catch {
    return null;
  }
}

export function autocompleteExtension() {
  return autocompletion({
    override: [wikilinkCompletion, tagCompletion, slashCommandCompletion],
    activateOnTyping: true,
    icons: false,
  });
}
