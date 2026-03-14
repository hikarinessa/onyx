import { useAppStore, type LintIssue } from "../stores/app";
import { scrollToPosition, applyLintFixAll } from "./Editor";
import { Icon } from "./Icon";

export function LintPanel() {
  const diagnostics = useAppStore((s) => s.lintDiagnostics);
  const visible = useAppStore((s) => s.lintPanelVisible);
  const togglePanel = useAppStore((s) => s.toggleLintPanel);

  if (!visible) return null;

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const hasFixable = diagnostics.some((d) => d.fixable);

  const handleClick = (issue: LintIssue) => {
    scrollToPosition(issue.from);
  };

  return (
    <div className="lint-panel">
      <div className="lint-panel-header">
        <span className="lint-panel-title">Problems</span>
        <span className="lint-panel-counts">
          {errors.length > 0 && (
            <span className="lint-count-error">{errors.length} errors</span>
          )}
          {warnings.length > 0 && (
            <span className="lint-count-warning">{warnings.length} warnings</span>
          )}
        </span>
        <div className="lint-panel-actions">
          {hasFixable && (
            <button
              className="lint-fix-all-btn"
              title="Fix all auto-fixable issues"
              onClick={applyLintFixAll}
            >
              Fix All
            </button>
          )}
          <button
            className="lint-panel-close"
            title="Close"
            onClick={togglePanel}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
      <div className="lint-panel-body">
        {diagnostics.length === 0 ? (
          <div className="lint-panel-empty">No issues</div>
        ) : (
          <ul className="lint-issue-list">
            {diagnostics.map((issue) => (
              <li
                key={issue.id}
                className="lint-issue"
                onClick={() => handleClick(issue)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleClick(issue);
                  }
                }}
              >
                <span
                  className={`lint-issue-icon ${
                    issue.severity === "error" ? "lint-icon-error" : "lint-icon-warning"
                  }`}
                >
                  <Icon
                    name={issue.severity === "error" ? "circle-x" : "triangle-alert"}
                    size={13}
                  />
                </span>
                <span className="lint-issue-message">{issue.message}</span>
                <span className="lint-issue-location">
                  Ln {issue.line}, Col {issue.col}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
