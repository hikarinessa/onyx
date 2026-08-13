{~~# Q3 Retro — raw notes~># Q3 Retrospective — Notes~~}

{==Attendees: full team==}{>>@llm: list names explicitly for the record<<}

## What went {--pretty --}well

- Shipped the localization pass {++on schedule ++}with zero rollbacks.
- {--We sort of managed to keep --}{++Kept ++}the crash rate under 0.1%.
- Onboarding doc rewrite got {~~good~>strong~~} feedback.

## What didn't

The release branch sat unmerged for {~~a long time~>eleven days~~} because
{--, frankly,--} nobody owned the merge.{>>this comment is deliberately untagged — it defaults to the llm layer<<}

{--### Stale section we agreed to drop

This whole block, including its heading and this second line,
goes away in one multi-line deletion.

--}## Actions

1. Assign a merge owner each release.{>>@llm: name a default owner — "each release" hides the gap<<}
2. {~~Try and~>Write~~} a rollback runbook.
{++3. Schedule the retro within one week of ship, not three.++}

Closing note: momentum is {==real==}{>>@llm: quantify or cut<<}.
