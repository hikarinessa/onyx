# Shader Pipeline Cleanup — Proposal{>>@llm: "Proposal" is vague — name the actual pipeline in the title<<}

## Why now

Our material library has grown to {~~around 400~>412~~} shaders, and {--frankly --}nobody
remembers which ones are safe to delete. Build times have {~~gotten really bad~>increased 40% since March~~}.{>>@llm: replaced vague phrasing with the number from the build dashboard — please verify it<<}

## Plan

1. Tag every shader with its last-referenced date.
2. {--Try to --}{>>@llm: "Try to" undermines the commitment<<}Move unreferenced shaders to a quarantine folder.
3. After two sprints, delete anything still quarantined.
{++4. Write the tagging script as a build step so the list stays current.++}

## Risks

The {==biggest risk==}{>>@llm: name it explicitly in a heading or bold — this is the part reviewers will scan for<<} is deleting a shader
referenced only by a seasonal event scene. {++We will grep event configs before each deletion batch.++}

We should {--probably --}ship this before the content freeze.
