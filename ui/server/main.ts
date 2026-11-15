// CLI entry:  node server/main.ts [--root <project or .aitiarch folder>] [--port N] [--allow-origin URL] [--no-open]
// One server on port 4317 serves every registered project. The browser gets its session only through the launch link this prints and opens.
import http from "node:http";
import { spawn } from "node:child_process";
import { createSecurity } from "./security.ts";
import {councilAdapters} from './providers/council-adapters.ts';
import {councilLocalChecks} from './providers/council-availability.ts';
import {validateCodexCommand} from './providers/codex-command.ts';
import { createHost } from "./host.ts";
import { Registry, RegistryError, resolveConfigFolder, type ProjectEntry } from "./registry.ts";
import { DEFAULT_PORT, clearInstance, listenOrReuse, readInstance, writeInstance } from "./launch.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./http.ts";
import { Store } from "./store.ts";
import { NoteWatcher } from "./watch.ts";
import { createProvider } from "./providers/index.ts";
import { ChatGPTPlan } from "./providers/chatgpt-plan.ts";
import { sweepStaleProviderTemps } from "./providers/temp-cleanup.ts";

function parseArgs(argv: string[]) {
  const o = { root: undefined as string | undefined, port: undefined as number | undefined, open: true, origins: [] as string[], claude: undefined as string | undefined, codex:undefined as string|undefined, chatgptPlan:false, devSession:false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") o.root = argv[++i] ?? "";
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--allow-origin") o.origins.push(argv[++i] ?? "");
    else if (a === "--claude") o.claude = argv[++i] ?? "";
    else if (a === '--codex') o.codex=validateCodexCommand(argv[++i]??'');
    else if (a === "--chatgpt-plan") o.chatgptPlan = true;
    else if (a === "--no-open") o.open = false;
    else if (a === "--dev-session") o.devSession = true; // contributors only: Vite on another port never sees the launch link
    else if (a === "--help" || a === "-h") {
      console.log("usage: aitiarch [--root <folder>] [--port N] [--no-open] [--codex <absolute native executable>] [--claude <absolute native executable> | --chatgpt-plan]\nDefault root: ./.aitiarch in the current directory. ChatGPT plan is disabled unless --chatgpt-plan is supplied. Each provider requires an explicit action per call.");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if(o.claude&&o.chatgptPlan){console.error('Choose one provider per server: --claude or --chatgpt-plan.');process.exit(2);}
  return o;
}

const args = parseArgs(process.argv.slice(2));
await sweepStaleProviderTemps();
// The registry and the running-instance file live in the user's config folder. AITIARCH_CONFIG_DIR points checks at a temp folder.
const configFolder = resolveConfigFolder(); // throws under tests unless AITIARCH_CONFIG_DIR is set
let registry: Registry;
try {
  registry = await Registry.open(configFolder);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}
// --root may name the project folder or its .aitiarch folder. Without it, the current folder is used when it has a notebook.
const rootArg = path.resolve(args.root ?? path.join(process.cwd(), ".aitiarch"));
const projectFolder = path.basename(rootArg).toLowerCase() === ".aitiarch" ? path.dirname(rootArg) : rootArg;
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { UsageLogs } = await import("./providers/usage.ts");
if (args.claude) {
  const probe = createProvider({ provider: "claude", command: args.claude, contract: "claude-canary-2.1.205" });
  for (const warning of (await probe.checkAvailability()).warnings ?? []) console.warn(warning);
}

let boundPort = 0;
let defaultId: string | undefined;
const security = createSecurity({ port: () => boundPort, extraOrigins: args.origins, requireLaunch: !args.devSession });
const plans = new Set<ChatGPTPlan>();
// Each project gets its own app: its own Store (path confinement), watcher, ink, chat, usage log and provider wiring.
const openProject = async (entry: ProjectEntry) => {
  const store = await Store.open(entry.notes);
  const watcher = new NoteWatcher(store);
  await watcher.start();
  const plan = args.chatgptPlan ? new ChatGPTPlan({ enabled: true, notebookRoot: store.rootReal }) : undefined;
  if (plan) plans.add(plan);
  const usage = new UsageLogs({ notebookRoot: store.rootReal });
  const provider = plan ?? (args.claude ? createProvider({ provider: "claude", command: args.claude, contract: "claude-canary-2.1.205", usageLog: usage }) : undefined);
  const app = createApp({ store, watcher, distDir, allowOrigins: args.origins, provider, plan, usage, security, council:{adapters:councilAdapters(args.claude,args.codex),availabilityChecks:councilLocalChecks(args.claude,args.codex)}, harness: args.claude ? { command: args.claude } : undefined });
  return { handle: app.handle, close: async () => { watcher.stop(); await plan?.close(); await app.close(); } };
};
const host = createHost({ registry: registry!, security, distDir, openProject, defaultProject: () => defaultId });

const openBrowser = (target: string) => {
  const [cmd, a] = process.platform === "win32" ? ["cmd", ["/c", "start", "", target.replace(/&/g, "^&")]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  spawn(cmd, a as string[], { detached: true, stdio: "ignore" }).unref();
};
const notebookMissing = () => {
  console.error(`No notebook folder at ${path.join(projectFolder, ".aitiarch")}\nRun this inside a project that has a .aitiarch folder, or pass --root <folder>.`);
  process.exit(2);
};

let choice: Awaited<ReturnType<typeof listenOrReuse>>;
try {
  choice = await listenOrReuse((p) => host.listen(p), args.port ?? DEFAULT_PORT);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

if (choice!.kind === "reuse") {
  // Aitiarch already runs on this port: hand it this project through its own API, then open it there. Our copy of the registry is
  // never written, so the running server's list stays the one truth.
  const port = choice!.port, inst = await readInstance(configFolder);
  if (!inst || inst.port !== port) {
    console.error(`Aitiarch is already running on port ${port}, but its launch details are missing. Close it and start again.`);
    process.exit(1);
  }
  const added = await new Promise<{ status: number; body: string }>((resolve) => {
    const body = JSON.stringify({ path: projectFolder });
    const req = http.request({ host: "127.0.0.1", port, path: "/api/projects/add", method: "PUT", headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, cookie: `aitiarch=${inst.token}`, "x-aitiarch": "1", "content-type": "application/json" } }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on("error", () => resolve({ status: 0, body: "" })); req.end(body);
  });
  let id: string | undefined;
  try { if (added.status === 200) id = JSON.parse(added.body).id; } catch { /* opened without a project */ }
  if (!id && args.root) notebookMissing();
  const launch = `http://127.0.0.1:${port}/?launch=${inst.token}${id ? `&project=${id}` : ""}`;
  console.log(`AITIARCH_READY ${JSON.stringify({ url: `http://127.0.0.1:${port}/`, launch, port, project: id ?? null, reused: true })}`);
  if (args.open) openBrowser(launch);
  process.exit(0);
}

boundPort = choice!.port;
try {
  const entry = await registry!.add(projectFolder);
  await registry!.touch(entry.id);
  defaultId = entry.id;
} catch (e) {
  if (!(e instanceof RegistryError)) throw e;
  if (args.root) notebookMissing(); // without --root, a folder with no notebook simply opens the projects home
}
await writeInstance(configFolder, { v: 1, port: boundPort, pid: process.pid, token: security.token });
const url = `http://127.0.0.1:${boundPort}/`;
const launch = `${url}?launch=${security.token}${defaultId ? `&project=${defaultId}` : ""}`;
console.log(`AITIARCH_READY ${JSON.stringify({ url, launch, root: defaultId ? registry!.get(defaultId)?.notes : null, port: boundPort, project: defaultId ?? null })}`);
if (args.open) openBrowser(launch);
const shutdown = async () => {
  await clearInstance(configFolder, process.pid);
  await host.close();
  for (const plan of plans) await plan.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
