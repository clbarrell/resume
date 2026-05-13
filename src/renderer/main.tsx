import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installDevApi } from "./devApi";
import "./styles/app.css";

if (import.meta.env.DEV) {
  installDevApi();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
