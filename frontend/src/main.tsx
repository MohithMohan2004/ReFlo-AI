import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installNativeGeolocation } from "./lib/nativeGeolocation";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/mobile.css";

installNativeGeolocation();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
