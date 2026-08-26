# Sample corpus

Annotated markdown exercising every CriticMarkup construct. `src/lib/criticMarkup.test.ts`
parses each `*.annotated.md` here and asserts that deciding every suggestion — accepting
all, then rejecting all — consumes every marker and leaves a document the parser reports
as clean. Drop real annotated documents in to widen the net.

**These are fixtures, not scratchpads.** Reviewing one in the app decides its suggestions
and writes the result back, so a hands-on session quietly consumes the very constructs the
file exists to demonstrate — and the tests will not notice, because they assert
parse-cleanliness rather than specific content.

To try Review mode by hand, work on a copy outside the repo:

```bash
cp samples/review-mode-demo.annotated.md /tmp/review-demo.md
```

Then open that file in Onyx. If a sample does get decided in place, `git checkout --
samples/` puts it back.
