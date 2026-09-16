import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { captureBcToken, routerBase } from "./lib/store";
import "./index.css";

// Capture a BetterCommunity SSO token from the URL (#bc=…) before anything renders.
captureBcToken();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* In demo mode the router is based at /demo, so every absolute <Link to="/live"> the
        pages already use resolves inside the tour without a single page changing. */}
    <BrowserRouter basename={routerBase()}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
