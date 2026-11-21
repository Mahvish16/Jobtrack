import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { applyTheme, getInitialTheme } from "./theme";

// Set the theme before React draws anything, so the page never flashes
// in the wrong colours.
applyTheme(getInitialTheme());

// BrowserRouter keeps the UI in sync with the browser URL (/dashboard,
// /applications, ...) using the History API, without full page reloads.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
