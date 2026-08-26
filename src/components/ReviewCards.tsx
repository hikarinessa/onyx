import { useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  absorbedIds,
  attachedRationales,
  isEdit,
  type Suggestion,
} from "../lib/criticMarkup";
import {
  acceptById,
  currentSuggestion,
  getSuggestions,
  rejectById,
  replyById,
  selectById,
} from "../extensions/criticMarkup";
import { Icon } from "./Icon";

/**
 * The card column beside the prose in Review mode.
 *
 * Cards read straight from editor state on each render rather than keeping a copy of the
 * suggestion list. A copy would be a second source of truth for something the document
 * already knows, and every decision rewrites the markup — so a cached list would be stale
 * the moment anything was accepted. A counter in the store says when to look again.
 */

const KIND_LABEL: Record<Suggestion["type"], string> = {
  deletion: "delete",
  addition: "insert",
  substitution: "replace",
  comment: "comment",
};

interface CardProps {
  view: EditorView;
  s: Suggestion;
  doc: string;
  rationales: Suggestion[];
  selected: boolean;
}

const textIn = (doc: string, span: { from: number; to: number } | null) =>
  span ? doc.slice(span.from, span.to) : "";

function Card({ view, s, doc, rationales, selected }: CardProps) {
  const [composing, setComposing] = useState<"note" | "reply" | null>(null);
  const [draft, setDraft] = useState("");

  const original = textIn(doc, s.original);
  const replacement = textIn(doc, s.replacement);
  const body = textIn(doc, s.comment);
  const edit = isEdit(s);

  const close = () => {
    setComposing(null);
    setDraft("");
  };

  const submit = () => {
    if (!draft.trim()) return;
    if (composing === "note") rejectById(view, s.id, draft);
    if (composing === "reply") replyById(view, s.id, draft);
    close();
  };

  return (
    <div
      className={`review-card type-${s.type} ${selected ? "selected" : ""}`}
      onClick={() => selectById(view, s.id)}
      data-suggestion={s.id}
    >
      <div className="review-card-head">
        <span className="review-card-kind">{KIND_LABEL[s.type]}</span>
        <span className="review-card-author">@{s.author ?? "llm"}</span>
      </div>

      <div className="review-card-body">
        {s.type === "deletion" && <del>{original}</del>}
        {s.type === "addition" && <ins>{replacement}</ins>}
        {s.type === "substitution" && (
          <>
            <del>{original}</del> <ins>{replacement}</ins>
          </>
        )}
        {s.type === "comment" &&
          (body ? <span className="review-card-comment">{body}</span> : <em>highlight</em>)}
      </div>

      {rationales.length > 0 && (
        <div className="review-card-rationale">
          {rationales.map((c) => (
            <div key={c.id}>
              @{c.author ?? "llm"}: {textIn(doc, c.comment)}
            </div>
          ))}
        </div>
      )}

      {composing ? (
        <div className="review-card-compose" onClick={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            rows={2}
            value={draft}
            placeholder={
              composing === "note"
                ? "Why? (travels back to the next pass)"
                : "Reply (travels back to the next pass)"
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              if (e.key === "Escape") close();
            }}
          />
          <div className="review-card-actions">
            <button className="primary" onClick={submit} disabled={!draft.trim()}>
              {composing === "note" ? "Reject" : "Reply"}
            </button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="review-card-actions" onClick={(e) => e.stopPropagation()}>
          {edit ? (
            <>
              <button className="accept" onClick={() => acceptById(view, s.id)}>
                Accept
              </button>
              <button className="reject" onClick={() => rejectById(view, s.id)}>
                Reject
              </button>
              <button title="Reject with a reason" onClick={() => setComposing("note")}>
                Reject…
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setComposing("reply")}>Reply</button>
              <button className="reject" onClick={() => acceptById(view, s.id)}>
                Dismiss
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewCards({ view }: { view: EditorView | null }) {
  if (!view) return null;

  const doc = view.state.doc.toString();
  const all = getSuggestions(view.state);
  const rationales = attachedRationales(all);
  const absorbed = absorbedIds(rationales);
  const cards = all.filter((s) => !absorbed.has(s.id));
  const current = currentSuggestion(view.state);

  return (
    <div className="review-cards">
      <div className="review-cards-head">
        <span className="review-cards-count">
          {cards.length} {cards.length === 1 ? "suggestion" : "suggestions"}
        </span>
        <span className="review-cards-hint" title="j/k move · a accept · x reject · Esc deselect">
          <Icon name="keyboard" size={13} />
        </span>
      </div>

      <div className="review-cards-list">
        {cards.length === 0 ? (
          <div className="review-cards-empty">Nothing left to decide.</div>
        ) : (
          cards.map((s) => (
            <Card
              key={s.id}
              view={view}
              s={s}
              doc={doc}
              rationales={rationales.get(s.id) ?? []}
              selected={current?.id === s.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
