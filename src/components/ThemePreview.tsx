import { useRef, useEffect } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { onyxHighlightStyle, onyxTheme } from "./Editor";
import { livePreviewExtension, togglePreviewEffect } from "../extensions/livePreview";
import { frontmatterExtension } from "../extensions/frontmatter";
import { wikilinkExtension } from "../extensions/wikilinks";
import { tagExtension } from "../extensions/tags";

const PREVIEW_SAMPLE = `# Heading One

## Heading Two

### Heading Three

This is **bold**, *italic*, and ~~strikethrough~~ text with ==highlights==.

> Blockquotes look like this.
> They can span multiple lines.

- Bullet list item
  - Nested item
  - Another nested item

- [ ] Unchecked task
- [x] Completed task

Link to [[Another Note]] and \`inline code\` here.

\`\`\`js
const greeting = "hello";
console.log(greeting);
\`\`\`

| Column A | Column B |
| -------- | -------- |
| Alpha    | Beta     |
| Gamma    | Delta    |

#tag #another-tag
`;

function buildPreviewExtensions(): Extension[] {
  return [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(onyxHighlightStyle),
    onyxTheme,
    EditorView.lineWrapping,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    livePreviewExtension(),
    frontmatterExtension(),
    wikilinkExtension(),
    tagExtension(),
  ];
}

export function ThemePreview({ configVersion }: { configVersion: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: PREVIEW_SAMPLE,
      extensions: buildPreviewExtensions(),
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    // Activate live preview mode
    requestAnimationFrame(() => {
      view.dispatch({ effects: togglePreviewEffect.of(true) });
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Re-measure when config changes (font size, line height, etc.)
  useEffect(() => {
    viewRef.current?.requestMeasure();
  }, [configVersion]);

  return <div ref={containerRef} className="theme-preview" />;
}
