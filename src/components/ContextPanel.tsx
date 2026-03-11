import { useAppStore } from "../stores/app";

export function ContextPanel() {
  const visible = useAppStore((s) => s.contextPanelVisible);

  return (
    <div className={`context-panel ${visible ? "" : "collapsed"}`}>
      <div className="context-panel-section">
        <div className="context-panel-section-title">Context Panel</div>
        <p style={{ color: "var(--text-tertiary)", fontSize: "12px" }}>
          Backlinks, properties, and calendar will appear here in later phases.
        </p>
      </div>
    </div>
  );
}
