import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@faerrin/gothic/index.css";
import "@fontsource/ibm-plex-mono";
import { Overlay } from "./Overlay";
import "./overlay.css";

const root = document.getElementById("root");
if (!root) throw new Error("eerie: missing #root element");

createRoot(root).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
