import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/orbitron/600.css";
import "@fontsource/orbitron/800.css";
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/share-tech-mono/400.css";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/800.css";
import "@fontsource/alegreya/400.css";
import "@fontsource/alegreya/600.css";
import "@fontsource/alegreya-sc/500.css";
import "./styles.css";
import { App } from "./App";
import { applySkin, loadSkin } from "./skin";

applySkin(loadSkin()); // before first paint, so there is no flash of the other look

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
