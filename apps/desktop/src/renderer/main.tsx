import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles/app.css";
import { markDesktopRendererLoaded, markDesktopRendererReady, showDesktopStartupFailure } from "./startup/desktopStartup";

markDesktopRendererLoaded();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Renderer root element '#root' was not found.");
}

function DesktopRendererReady() {
  useEffect(() => { markDesktopRendererReady(); }, []);
  return null;
}

createRoot(rootElement, {
  onUncaughtError: () => { showDesktopStartupFailure(); },
}).render(
  <StrictMode>
    <App />
    <DesktopRendererReady />
  </StrictMode>,
);
