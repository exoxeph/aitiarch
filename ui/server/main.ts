// CLI entry:  node server/main.ts [--root <.aitiarch folder>] [--port N] [--allow-origin URL] [--no-open]
// Default root is ./.aitiarch under the current working directory (run it inside your project).
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./http.ts";
import { Store } from "./store.ts";
import { NoteWatcher } from "./watch.ts";
import { createProvider } from "./providers/index.ts";

function parseArgs(argv: string[]) {
  const o = { root: undefined as string | undefined, port: undefined as number | undefined, open: true, origins: [] as string[], claude: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") o.root = argv[++i] ?? "";
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--allow-origin") o.origins.push(argv[++i] ?? "");
    else if (a === "--claude") o.claude = argv[++i] ?? "";
    else if (a === "--no-open") o.open = false;
    else if (a === "--help" || a === "-h") {
      console.log("usage: aitiarch [--root <folder>] [--port N] [--no-open] [--claude <absolute native executable>]\nDefault root: ./.aitiarch in the current directory. Claude is the only supported live provider; an explicit action is required per call.");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
let store: Store;
try {
  store = await Store.open(args.root);
} catch {
  console.error(`No notebook folder at ${args.root ?? "./.aitiarch"}\nRun this inside a project that has a .aitiarch folder, or pass --root <folder>.`);
  process.exit(2);
}

const watcher = new NoteWatcher(store!);
await watcher.start();
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const provider = args.claude ? createProvider({ provider: "claude", command: args.claude, contract: "claude-canary-2.1.205" }) : undefined;
const app = createApp({ store: store!, watcher, distDir, allowOrigins: args.origins, provider });

// Deterministic port per notebook folder, so the same project always opens at the same address.
const h = parseInt(createHash("sha1").update(store!.rootReal.toLowerCase()).digest("hex").slice(0, 6), 16);
const preferred = args.port ?? 43000 + (h % 1000);
let port = -1;
for (let i = 0; i < (args.port === undefined ? 20 : 1); i++) {
  try {
    port = await app.listen(preferred === 0 ? 0 : preferred + i);
    break;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
  }
}
if (port < 0) {
  console.error("Could not find a free port.");
  process.exit(1);
}
const url = `http://127.0.0.1:${port}/`;
console.log(`AITIARCH_READY ${JSON.stringify({ url, root: store!.rootReal, port })}`);
if (args.open) {
  const [cmd, a] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, a as string[], { detached: true, stdio: "ignore" }).unref();
}
const shutdown = async () => {
  watcher.stop();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
