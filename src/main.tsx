import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./styles/theme.css";
import "./styles/reset.css";
import "./styles/layout.css";
import App from "./App";

// Global error trap: webview exceptions are invisible in release builds
// (no devtools), so forward them to the Rust log (~/Library/Logs/app.onyx.notes).
// Capped per session so an exception storm can't flood the log or IPC.
let errorReports = 0;
function reportError(kind: string, detail: string) {
  if (errorReports >= 50) return;
  errorReports++;
  invoke("log_js_error", { message: `${kind}: ${detail}` }).catch(() => {});
}
window.addEventListener("error", (e) => {
  const stack = e.error instanceof Error ? `\n${e.error.stack}` : "";
  reportError("uncaught", `${e.message} (${e.filename}:${e.lineno}:${e.colno})${stack}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  const detail = r instanceof Error ? `${r.message}\n${r.stack}` : String(r);
  reportError("unhandledrejection", detail);
});
// CodeMirror catches extension crashes internally and only console.error()s
// them, so tee console.error into the trap as well.
const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  origConsoleError(...args);
  const detail = args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a)))
    .join(" ");
  reportError("console.error", detail);
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
