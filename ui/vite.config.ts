import {writeFileSync,mkdirSync} from 'node:fs';
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev: Vite on 5173 proxies /api to the Aitiarch server (see scripts/dev.mjs).
const apiTarget = process.env.AITIARCH_API ?? "http://127.0.0.1:43117";

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
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"], environment: "node" },
});
