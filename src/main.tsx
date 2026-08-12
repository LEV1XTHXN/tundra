import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./index.css";
import { installWebkitFileInputFix } from "./editor/webkitFileInputFix";
import { installContextMenuSuppressor } from "./app/contextMenuSuppressor";
import "./i18n";

// Linux/WebKitGTK: unbreak BlockNote's file-block picker (empty on `accept="*/*"`).
installWebkitFileInputFix();
// Replace the webview's browser context menu (Reload, Back/…) with nothing —
// the app's own right-click menus are unaffected. In dev, Shift+right-click
// still opens the native menu so "Inspect Element" stays reachable.
installContextMenuSuppressor();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
