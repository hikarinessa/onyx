---
title: Review Mode Demo
tags: [onyx, review]
---

# Review Mode Demo{>>@llm: the title repeats the folder name — consider dropping "Demo"<<}

Every CriticMarkup construct appears below, so the editor can be checked by eye against
one file. Decide a suggestion and the markup should disappear, leaving only the text.

## Inline edits

The simplest case is a deletion: this sentence is {--frankly --}too long already.

An addition inserts text that is not in the document yet.{++ It exists only inside the marker until accepted.++}

A substitution carries both halves, so the decision is atomic: build times have
{~~gotten really bad~>increased 40% since March~~}.{>>@llm: replaced vague phrasing with the dashboard figure — please verify<<}

## Comments

A comment can be anchored to a span of text: the {==biggest risk==}{>>@llm: name it in a heading — this is what reviewers scan for<<} is
deleting something referenced only once a year.

A point comment attaches to a position rather than a span.{>>@llm: this paragraph could open the section instead<<}

A bare highlight marks a span with nothing else to say: {==worth a second look==}.

## Attached rationale

A point comment flush against an edit belongs to that edit and travels with its decision:

1. Tag every shader with its last-referenced date.
2. {--Try to --}{>>@llm: "Try to" undermines the commitment<<}Move unreferenced shaders to quarantine.
3. After two sprints, delete anything still quarantined.

## Spans that cross lines

A single deletion can cover more than one line, which is why these cannot be built from a
line-based scan: {--This whole passage is a candidate for cutting.
It runs to a second line, and the marker only closes here.--}The text after it continues normally.

## Substituting inside a heading

### {~~An old heading~>A clearer heading~~}

Leave the `###` outside the markup and substitute only the words. Both halves are then
ordinary inline text, the line still opens with `###`, and it renders as a heading in every
mode — the proposal shows inline, exactly like one in a paragraph.

Putting the `###` inside the substitution instead, so that each half carries its own copy
of the marker, parses and decides correctly but reads badly. The line then opens with a
brace rather than a hash, so live preview will not treat it as a heading, and in Preview
the surviving half shows its marker as plain text in the middle of rendered prose.

The same holds for list bullets and blockquote markers: annotate the words, not the syntax
that introduces them.

## Interaction with existing syntax

Onyx already renders `==highlight==` and `~~strikethrough~~`. Both sequences also appear
inside the CriticMarkup delimiters, so a construct like {~~this one~>that one~~} has to be
claimed before the ordinary inline pass runs — otherwise its innards get styled as a
strikethrough and the markers vanish.

Both plain forms must still work everywhere: ==a real highlight== and ~~a real strikethrough~~
render as themselves, and they keep working {++inside ==an accepted addition==++} too.

Live preview matches inline syntax one line at a time, so a construct broken across a hard
line break is not rendered at all — keep these on a single line when checking them.

## Second pass

A returning document carries the user's decisions back to the next annotation
run.{>>@user: this is what a reply looks like on the way back<<}
