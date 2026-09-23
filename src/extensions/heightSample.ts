/**
 * Keeps CM6's height estimates stable while scrolling long notes.
 *
 * CM6 estimates the height of every line it hasn't rendered from one sample: the first
 * rendered line of at most 20 characters whose content is plain text (no styled spans),
 * measured for its line height and average character width. In a note, which line that
 * is depends on what happens to be on screen: a monospace frontmatter line, a line of
 * two spaces (whose "average character" is a space, a third of a letter's width), or
 * a short body line. Each time the sample changes, every unrendered line is re-estimated
 * at once, and on long wrapped paragraphs the total height moves by thousands of pixels
 * in a frame, which throws the scroll position back up the note.
 *
 * Wrapping every short line's text in a plain span removes all candidates, so CM6 always
 * measures its own sample line (`abc def ghi …` in body text): one sample, every time.
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";

const SAMPLE_MAX_LENGTH = 20; // CM6's own limit for a sampleable line

const unsampleable = Decoration.mark({ class: "cm-unsampled" });

function build(view: EditorView): DecorationSet {
  // The whole rendered range, not just what is on screen: CM6 samples from every
  // rendered line, including the margin it keeps above and below the view.
  const builder = new RangeSetBuilder<Decoration>();
  const { from, to } = view.viewport;
  for (let pos = from; pos <= to; ) {
    const line = view.state.doc.lineAt(pos);
    if (line.length > 0 && line.length <= SAMPLE_MAX_LENGTH) {
      builder.add(line.from, line.to, unsampleable);
    }
    pos = line.to + 1;
  }
  return builder.finish();
}

const heightSamplePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export function heightSampleExtension(): Extension {
  return heightSamplePlugin;
}
