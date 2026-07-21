import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./index.css";
import { installWebkitFileInputFix } from "./editor/webkitFileInputFix";

// Linux/WebKitGTK: unbreak BlockNote's file-block picker (empty on `accept="*/*"`).
installWebkitFileInputFix();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
