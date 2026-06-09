import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@faerrin/gothic/index.css";
import "./app.css";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("vellum: missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
