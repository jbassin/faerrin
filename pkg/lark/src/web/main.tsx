import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DialogProvider } from "./ui/Dialog";
import { ToastProvider } from "./ui/Toast";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ToastProvider>
  </StrictMode>,
);
