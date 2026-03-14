# Issue Tracking

Issues are tracked on GitHub: https://github.com/hikarinessa/onyx/issues

## Labels

### Priority (required — default: P3-Medium)
| Label | Color | Description |
|-------|-------|-------------|
| P1-Urgent | #b60205 | Priority 1: Urgent |
| P2-High | #d93f0b | Priority 2: High |
| P3-Medium | #fbca04 | Priority 3: Medium |
| P4-Low | #0e8a16 | Priority 4: Low |

### Type (required — default: Task)
| Label | Color | Description |
|-------|-------|-------------|
| Bug | #d73a4a | Something isn't working |
| Task | #1d76db | General tasks |

### Status (required — default: Backlog)
| Label | Color | Description |
|-------|-------|-------------|
| Backlog | #6b7280 | Status: Backlog |
| To-Do | #2563eb | Status: To-Do |
| In Progress | #f59e0b | Status: In progress |
| In Review | #0ea5e9 | Status: In Review |
| Done | #22c55e | Status: Done |
| Cancelled | #ef4444 | Status: Cancelled |

## Defaults

Every new issue gets these labels unless specified otherwise:
- **Priority:** P3-Medium
- **Type:** Task
- **Status:** Backlog

## Creating Issues

```bash
# Minimal (uses defaults)
gh issue create --title "Title" --body "" --label "P3-Medium,Task,Backlog"

# Bug with high priority
gh issue create --title "Title" --body "Description" --label "P2-High,Bug,Backlog"
```
