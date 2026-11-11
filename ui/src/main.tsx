/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";
import Root from "./Root.tsx";
import "./styles.css";
import { watchScrolling } from "./scrolling.ts";

watchScrolling(document);
createRoot(document.getElementById("root")!).render(<Root />);
