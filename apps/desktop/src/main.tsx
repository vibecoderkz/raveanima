import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { editor, getUi, setUi } from "./store";

// Dev builds expose the editor for automated UI tests in a browser.
if (import.meta.env.DEV) (window as unknown as { __anima: unknown }).__anima = { editor, getUi, setUi };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
