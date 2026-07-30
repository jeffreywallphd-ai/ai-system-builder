import { createRoot } from "react-dom/client";

import { SystemRuntimeApp } from "./SystemRuntimeApp";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("System runtime root is unavailable.");
createRoot(rootElement).render(<SystemRuntimeApp />);
