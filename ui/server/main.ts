import {DEFAULT_PIPELINE_CONFIG as defaults,activePipelineConfig} from '../shared/pipeline-config.ts';
// CLI entry:  node server/main.ts [--root <project or .aitiarch folder>] [--port N] [--allow-origin URL] [--no-open]
// One server on port 4317 serves every registered project. The browser gets its session only through the launch link this prints and opens.
import http from "node:http";
import { spawn } from "node:child_process";
import { createSecurity } from "./security.ts";
import {selectRuntimeProviders} from './platform/runtime-providers.ts';
import {selectedCouncilAdapters} from './providers/council-adapters.ts';
export {selectRuntimeProviders} from './platform/runtime-providers.ts';
import {roleRouting} from './providers/routing.ts';
import {createSetupHttp} from './setup-http.ts';
import {checkPrerequisites} from './platform/doctor.ts';
import {createInvokedCodexBridge} from './providers/invoked-bridge.ts';
import {validateCodexCommand} from './providers/codex-command.ts';
import { createHost } from "./host.ts";
import { PipelineConfigStore } from "./pipeline-config-store.ts";
import { Registry, RegistryError, resolveConfigFolder, type ProjectEntry } from "./registry.ts";
import { DEFAULT_PORT, clearInstance, listenOrReuse, readInstance, writeInstance } from "./launch.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {readFile} from 'node:fs/promises';
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

/** Startup is explicit so the app command can preflight without starting a server. */
export async function startServer(argv: string[] = process.argv.slice(2)) {
const args = parseArgs(argv);
await sweepStaleProviderTemps();
// The registry and the running-instance file live in the user's config folder. AITIARCH_CONFIG_DIR points checks at a temp folder.
const configFolder = resolveConfigFolder(); // throws under tests unless AITIARCH_CONFIG_DIR is set
// The user's pipeline overrides (pipeline-config.json, next to the project list) are loaded once here and again after each change. A missing or unreadable file means the defaults.
await new PipelineConfigStore(configFolder).activate(); // never throws: the defaults stand when the file is missing or unreadable
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
const appFolder=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {version}=JSON.parse(await readFile(path.join(appFolder,'ui','package.json'),'utf8'));
const identity={version,appFolder,notebookRoot:path.join(projectFolder,'.aitiarch')};
const { UsageLogs } = await import("./providers/usage.ts");
const runtime=await selectRuntimeProviders({configDir:configFolder,overrides:{...(args.claude!==undefined?{claude:args.claude}:{}),...(args.codex!==undefined?{codex:args.codex}:{})}});
const serverIdentity={...identity,providers:runtime.providers};
const claudeCommand=runtime.commands.claude;
// Plugin run/start and the normal command both reach here. Save compatible defaults once, before any project opens.
const initialRouting=roleRouting({dir:configFolder,adapters:runtime.adapters,checks:runtime.availabilityChecks,legacyAnswerer:()=>activePipelineConfig().normalAnswerer,claudeBridge:!!claudeCommand,codexInvokedBridge:createInvokedCodexBridge,codexThreadReplies:true});
try {
 await initialRouting.initializeDefaults([...(args.claude!==undefined?['claude' as const]:[]),...(args.codex!==undefined?['codex' as const]:[])]);
} catch {
 // Saved settings remain authoritative; routing reports unreadable/unassigned roles.
 // Optional AI setup must not prevent AI-off editing or replace damaged settings.
 console.warn('AI role defaults could not be saved. Existing settings were left unchanged; check machine setup. AI-off editing remains available.');
}
if (claudeCommand&&!args.chatgptPlan) {
  const probe = createProvider({ provider: "claude", command: claudeCommand, contract: "claude-canary-2.1.205" });
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
  const provider = plan ?? (claudeCommand ? createProvider({ provider: defaults.roles.chat, command: claudeCommand, contract: "claude-canary-2.1.205", usageLog: usage }) : undefined);
  const adapters=selectedCouncilAdapters(runtime.providers),availabilityChecks=runtime.availabilityChecks;
  const routing=roleRouting({dir:configFolder,adapters,checks:availabilityChecks,legacyAnswerer:()=>activePipelineConfig().normalAnswerer,claudeBridge:!!claudeCommand,codexInvokedBridge:createInvokedCodexBridge,codexThreadReplies:true});
  const setup = createSetupHttp({dir:configFolder, project:entry.root, providers:runtime.providers,
    overrides:{claude:args.claude,codex:args.codex},
    ready:async()=>(await checkPrerequisites({configDir:configFolder,distDir})).every(check=>check.ok)});
  const app = createApp({ pipelineConfigDir: configFolder, store, watcher, distDir, allowOrigins: args.origins, provider, plan, usage, security, setup, council:{adapters,availabilityChecks,routing}, harness: claudeCommand ? { command: claudeCommand } : undefined });
  return { handle: app.handle, close: async () => { watcher.stop(); await plan?.close(); await app.close(); } };
};
const host = createHost({ registry: registry!, security, distDir, openProject, identity:serverIdentity, providers:runtime.providers, defaultProject: () => defaultId });

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
  choice = await listenOrReuse((p) => host.listen(p), args.port ?? DEFAULT_PORT, undefined, {expected:serverIdentity});
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startServer();
