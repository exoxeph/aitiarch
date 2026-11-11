// Dev mode: the Aitiarch server (API on 43117) + Vite (UI with hot reload on 5173, proxying /api).
//   npm run dev                       -> notebook = ./.aitiarch in the current directory
//   npm run dev -- --root <folder>    -> any other folder
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRoot } from "../server/root.ts";

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ri = args.indexOf("--root");
const root = await resolveRoot({ root: ri >= 0 ? args[ri + 1] ?? "" : undefined });

const server = spawn(
  process.execPath,
  [path.join(uiDir, "server", "main.ts"), "--root", root, "--port", "43117", "--no-open", "--dev-session", "--allow-origin", "http://localhost:5173", "--allow-origin", "http://127.0.0.1:5173"],
  { cwd: uiDir, stdio: "inherit" },
);
const vite = spawn(process.execPath, [path.join(uiDir, "node_modules", "vite", "bin", "vite.js"), ...(args.includes("--no-open") ? [] : ["--open"])], {
  cwd: uiDir,
  stdio: "inherit",
  env: { ...process.env, AITIARCH_API: "http://127.0.0.1:43117" },
});
const stop = () => {
  server.kill();
  vite.kill();
};
server.on("exit", (c) => {
  vite.kill();
  process.exit(c ?? 0);
});
vite.on("exit", () => server.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
