import { getCurrentWindow } from "@tauri-apps/api/window";

export function Titlebar() {
  const appWindow = getCurrentWindow();

  return (
    <div className="titlebar">
      <div className="titlebar-traffic-lights" />
      <div className="titlebar-title">Onyx</div>
      <div className="titlebar-actions">
        <button
          onClick={() => appWindow.minimize()}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          −
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          □
        </button>
        <button
          onClick={() => appWindow.close()}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
