/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";
import { watchScrolling } from "./scrolling.ts";

watchScrolling(document);
createRoot(document.getElementById("root")!).render(<App />);
