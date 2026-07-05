import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { captureBcToken } from "./lib/store";
import "./index.css";

// Capture a BetterCommunity SSO token from the URL (#bc=…) before anything renders.
captureBcToken();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
