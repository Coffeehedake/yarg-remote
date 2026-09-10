import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

const host = document.getElementById("root");
if (!host) throw new Error("index.html has no #root");

createRoot(host).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
