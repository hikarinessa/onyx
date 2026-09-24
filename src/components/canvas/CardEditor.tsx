/**
 * Markdown on a canvas card, rendered by the note editor's own extensions so a card
 * looks exactly like the note it shows. Read-only until the card is being edited.
 */
import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { onyxHighlightStyle, onyxTheme } from "../Editor";
import { livePreviewExtension, togglePreviewEffect } from "../../extensions/livePreview";
import { frontmatterExtension } from "../../extensions/frontmatter";
import { wikilinkExtension } from "../../extensions/wikilinks";
import { tagExtension } from "../../extensions/tags";
import { embedExtension } from "../../extensions/embeds";
import { imageExtension } from "../../extensions/images";
import { htmlInlineExtension } from "../../extensions/htmlInline";
import { footnotesExtension } from "../../extensions/footnotes";
import { heightSampleExtension } from "../../extensions/heightSample";
import { formattingKeymap } from "../../extensions/formatting";
import { outlinerKeymap } from "../../extensions/outliner";
import { autocompleteExtension } from "../../extensions/autocomplete";
import { contextPathFacet } from "../../extensions/contextPath";

const editable = new Compartment();
const context = new Compartment();
const READ_ONLY = [EditorState.readOnly.of(true), EditorView.editable.of(false)];

let shared: Extension[] | null = null;
function cardExtensions(): Extension[] {
  shared ??= [
    keymap.of(formattingKeymap),
    keymap.of(outlinerKeymap),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    history(),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(onyxHighlightStyle),
    onyxTheme,
    drawSelection(),
    EditorView.lineWrapping,
    heightSampleExtension(),
    frontmatterExtension(),
    wikilinkExtension(),
    tagExtension(),
    autocompleteExtension(),
    livePreviewExtension(),
    ...footnotesExtension(),
    ...embedExtension(),
    imageExtension(),
    htmlInlineExtension(),
  ];
  return shared;
}

export interface CardEditorProps {
  text: string;
  /** File the card's links resolve from */
  contextPath: string;
  editing: boolean;
  onChange?: (text: string) => void;
  onExit?: () => void;
}

export function CardEditor({ text, contextPath, editing, onChange, onExit }: CardEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExitRef = useRef(onExit);
  onChangeRef.current = onChange;
  onExitRef.current = onExit;

  useEffect(() => {
    if (!ref.current) return;
    const view = new EditorView({
      parent: ref.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          cardExtensions(),
          editable.of(READ_ONLY),
          context.of(contextPathFacet.of(contextPath)),
          keymap.of([{ key: "Escape", run: () => { onExitRef.current?.(); return true; } }]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.state.readOnly) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    requestAnimationFrame(() => view.dispatch({ effects: togglePreviewEffect.of(true) }));
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The view is built once per card; later prop changes are dispatched below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text changed from outside (undo on the board, the note changing on disk)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === text) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, [text]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: context.reconfigure(contextPathFacet.of(contextPath)) });
  }, [contextPath]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: editable.reconfigure(editing ? [] : READ_ONLY) });
    if (editing) {
      view.focus();
      // Start at the end of the text, where a new thought usually goes
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    }
  }, [editing]);

  return <div ref={ref} className="canvas-md" />;
}
