import {writeFileSync,mkdirSync} from 'node:fs';
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev: Vite on 5173 proxies /api to the Aitiarch server (see scripts/dev.mjs).
const apiTarget = process.env.AITIARCH_API ?? "http://127.0.0.1:43117";
/** Test files that spawn processes, servers or git, or churn temp folders. Run in their own group (see `test` below). */
const HEAVY_TESTS = ["chatgpt-plan", "thread-store", "thread-runtime", "chat-backend", "harness-chat", "harness-editor-context", "harness-diagrams", "harness-investigate", "providers", "chat-claims-http", "harness-snapshot", "thread-resolve", "watch-start", "thread-http", "usage", "conversation-open-note", "conversation-chips", "conversation-followups"].map((name) => `test/${name}.test.{ts,tsx}`);

export default defineConfig({
  plugins: [react(),{name:'diagram-build-graph',generateBundle(_options,bundle){
    mkdirSync('check/out',{recursive:true});
    writeFileSync('check/out/diagram-build-graph.json',JSON.stringify(Object.values(bundle).filter(v=>v.type==='chunk').map(v=>({file:v.fileName,isEntry:v.isEntry,imports:v.imports,dynamicImports:v.dynamicImports,modules:v.moduleIds})),null,2));
  }}],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  test: {
    environment: "node",
    setupFiles: ["test/setup/temp-cleanup.ts", "test/setup/isolated-config.ts"],
    // Two groups. Most files are light and run in parallel. The files below start processes, servers or git, or make many temp folders: on a loaded machine they
    // ran out of time (five-second tests, ten-second hooks, a dozen of them at once). They run after the light group, two at a time, with a minute per test.
    // This is configuration only: no assertion differs between the groups.
    projects: [
      { extends: true, test: { name: "light", include: ["test/**/*.test.ts", "test/**/*.test.tsx"], exclude: [...configDefaults.exclude, ...HEAVY_TESTS], sequence: { groupOrder: 1 } } },
      { extends: true, test: { name: "heavy", include: HEAVY_TESTS, maxWorkers: 2, testTimeout: 60000, hookTimeout: 60000, sequence: { groupOrder: 2 } } },
    ],
  },
});
