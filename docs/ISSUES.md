# Issue Tracking

Issues are tracked on GitHub: https://github.com/hikarinessa/onyx/issues
Project board: https://github.com/users/hikarinessa/projects/2

Status is managed by GitHub's open/closed state and the project board's Status field.

## Priority

Priority is managed via the **GitHub Project** Priority field (not labels):

| Priority | Meaning |
|----------|---------|
| P0 | Critical / urgent — blocks daily use |
| P1 | Standard priority — planned work |
| P2 | Nice-to-have — backlog |
| *(none)* | Unprioritized |

## Labels

### Type (required — default: Task)
| Label | Color | Description |
|-------|-------|-------------|
| Bug | #d73a4a | Something isn't working |
| Task | #1d76db | General tasks |

### Other
| Label | Color | Description |
|-------|-------|-------------|
| Triaged | #a2eeef | Issue has been investigated and triaged |

## Defaults

Every new issue gets a **Type** label (default: Task). Priority is set in the project board.

## Creating Issues

```bash
# Task (default)
gh issue create --title "Title" --body "" --label "Task"

# Bug
gh issue create --title "Title" --body "Description" --label "Bug"
```
