import { getCurrentWindow } from "@tauri-apps/api/window";

export function Titlebar() {
  const minimize = () => getCurrentWindow().minimize();
  const toggleMaximize = () => getCurrentWindow().toggleMaximize();
  const close = () => getCurrentWindow().close();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-traffic-lights" />
      <div className="titlebar-title" data-tauri-drag-region>Onyx</div>
      <div className="titlebar-actions">
        <button className="titlebar-btn" onClick={minimize}>
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button className="titlebar-btn" onClick={toggleMaximize}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
        </button>
        <button className="titlebar-btn titlebar-btn-close" onClick={close}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2"/></svg>
        </button>
      </div>
    </div>
  );
}
