import {activePipelineConfig} from '../shared/pipeline-config.ts';
import {validNeverCorrect} from '../shared/typing-preferences.ts';
import {harnessDirectory,SessionIndex,SessionIndexError} from './harness/session-index.ts';import {ClaudeSessionRunner} from './harness/claude-session.ts';import {InvestigateError,InvestigateService} from './harness/investigate.ts';import {randomUUID} from 'node:crypto';import {ConversationGate,GateRefusal,carriedPairs,projectRepo} from './harness/conversation.ts';import {cleanAttachments} from '../shared/profile.ts';import {removeTranscript} from './harness/transcripts.ts';import {sweepStaleTurnFolders} from './harness/sweep.ts';import {QuestionStore} from './harness/questions.ts';
import {ChatRuntime,ChatError} from './chat/runtime.ts';
import {NormalChat} from './chat/normal-answerer.ts';
import {whyOfError} from './chat/why.ts';
import {CHAT_MESSAGES,budgetText} from '../shared/chat.ts';
import {validSessionId} from '../shared/harness.ts';
import {ChatStore} from './chat/store.ts';import {ChatInsertion} from './chat/insertion.ts';import {CouncilInsertion} from './council-insertion.ts';import {InvestigateInsertion} from './investigate-insertion.ts';
import {TESTED_CLI_VERSION} from '../shared/diagram-fence.ts';import {DiagramImageError,DiagramImageStore} from './diagram-image-store.ts';import {DIAGRAM_PNG_MAX_BYTES,DIAGRAM_PNG_NAME} from '../shared/diagram-refs.ts';
import {InsertionStore} from './insertion-store.ts';
import {SKILL_DIAGRAM_CSP_HEADER,SKILL_DIAGRAM_SVG_CSP_HEADER} from '../shared/skill-diagram.ts';
import { UiStateStore } from './ui-state-store.ts';
import {isGitRepository} from './git-repository.ts';
import {ThreadStore} from './thread-store.ts';
import {ThreadRuntime,type ThreadRequest} from './thread-runtime.ts';
import {validId} from '../shared/threads.ts';
// Local HTTP server: JSON API + SSE + static UI. Loopback only, with Host/Origin checks, a per-launch
// cookie token, and a strict Content-Security-Policy, because this process can write to your notes.
import { createSecurity } from "./security.ts";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { normalizeRel, isNotePath, PathError } from "./paths.ts";
import { Explorer } from "./explorer.ts";
import { backlinks, noteIndex } from "./citations.ts";
import { buildGraph, handoffDocument, HandoffError, writeHandoff } from "./graph.ts";
import type { Store } from "./store.ts";
import { InkStore } from "./ink-store.ts";
import type { NoteWatcher, WatchEvent } from "./watch.ts";
import { Assistance } from "./assistance.ts";
import { ProviderError, type Provider } from "./providers/index.ts";
import type { Invocation } from "../shared/invocation.ts";
import type { ChatGPTPlan } from "./providers/chatgpt-plan.ts";
import { defaultRoots, discoverSkills, type SkillInfo, type SkillRoot } from "./skills.ts";
import { skillLibrary } from "./skill-library.ts";
import { NodeSettingsService } from "./node-settings.ts";
import { validSavedNodes } from "../shared/node-settings.ts";
import { homedir } from "node:os";
import {CouncilService} from './council.ts';
import {PipelineConfigStore,PipelineConfigError,pipelineView,PIPELINE_CONFIG_MAX_BYTES} from './pipeline-config-store.ts';
import {pipelinePreview,PreviewUnavailable} from './pipeline-preview.ts';
import {excludedSnapshotPaths} from './harness/snapshot.ts';
import {resolveConfigFolder} from './registry.ts';
import {CouncilHistory} from './council-history.ts';
import type {AvailabilityCheck} from './providers/council-availability.ts';
import type {TurnAdapter} from './providers/turn.ts';

export interface AppOptions {
  /** The per-user folder for pipeline-config.json (the folder that holds the project list). Tests pass a temp folder; otherwise AITIARCH_CONFIG_DIR or the real config folder, which is refused under tests. */
  pipelineConfigDir?:string;
  council?:{adapters:TurnAdapter[];index?:SessionIndex;availabilityChecks?:AvailabilityCheck[]};
  sessionModules?:import('../shared/chat.ts').ContextModule[];
  store: Store;
  watcher: NoteWatcher;
  distDir: string;
  allowOrigins?: string[];
  /** Hand out a session only through the launcher's one-time link (the real app); tests keep the same-origin handshake. */
  requireLaunch?: boolean;
  /** Front-door rules shared with a multi-project host; when absent this app makes its own. */
  security?: import("./security.ts").Security;
  provider?: Provider;
  plan?: ChatGPTPlan;
  usage?: {summary():Promise<import('../shared/usage.ts').UsageSummary>};
  /** Where the Skill library looks. Tests pass temp folders; the real app uses the usual places under your home folder and this project. */
  skillRoots?: SkillRoot[];
  /** Harness chat sessions through the Claude Code CLI. `dir` (tests) overrides the per-project folder under local app data. */
  harness?: {command:string;prefixArgs?:string[];model?:string;dir?:string;/** The folder whose .claude holds the CLI's transcripts (default: the user's home). Tests pass a fake one. */home?:string};
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // CodeMirror and Mermaid inject <style>; scripts stay strict
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const MAX_BODY = 6 * 1024 * 1024;

/** The built UI. Unknown paths without an extension fall back to index.html; nothing outside distDir is ever served. */
export async function serveDist(distDir: string, res: http.ServerResponse, url: URL) {
  const dist = path.resolve(distDir);
  if (!existsSync(path.join(dist, "index.html"))) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Aitiarch UI is not built yet. Run `npm run build` in the ui folder, then start again.\n");
  }
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  let file = path.join(dist, rel === "/" ? "index.html" : rel);
  if (path.relative(dist, file).startsWith("..") || !existsSync(file)) {
    if (path.extname(rel)) {
      res.writeHead(404);
      return res.end();
    }
    file = path.join(dist, "index.html");
  }
  const data = await readFile(file);
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  res.end(data);
}

interface UiState {
  v: 1;
  tabs: string[];
  active: string | null;
  treeCollapsed?: boolean;
  theme?: 'ember' | 'moss';
  confirmAdd?: boolean;
  typingHelp?:boolean;
  doubleSpacePeriod?:boolean;smartCorrections?:boolean;neverCorrect?:string[];
}

export function createApp(opts: AppOptions) {
  const { store, watcher } = opts;
  const inkReady = InkStore.open(store.rootReal);
  const clients = new Set<http.ServerResponse>();
  const assistance = inkReady.then(ink => new Assistance(store, ink, opts.provider ?? {
    checkAvailability: async () => ({ available: false, code: "unsupported_cli", message: "Claude is not configured. Start with --claude and an absolute executable path. Codex is disabled." }),
    invoke: async () => { throw new ProviderError("unsupported_cli"); },
  }, path => { for (const c of clients) c.write(`event: ink\ndata: ${JSON.stringify({ type: "ink", path })}\n\n`); }, undefined, (node, one) => nodeSettings.extras(node, one)));
  let port = 0;
  // Shared with the multi-project host when it embeds this app; otherwise this app is its own front door.
  const security = opts.security ?? createSecurity({ port: () => port, extraOrigins: opts.allowOrigins, requireLaunch: opts.requireLaunch });
  const token = security.token;

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(data);
  };

  const readBody = (req: http.IncomingMessage, max = MAX_BODY): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let n = 0;
      req.on("data", (c: Buffer) => {
        n += c.length;
        if (n > max) {
          reject(new PathError(413, "too_large", "Request body too large."));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new PathError(400, "bad_json", "Body is not valid JSON."));
        }
      });
      req.on("error", reject);
    });

  const tokenOk = (req: http.IncomingMessage): boolean => security.tokenOk(req.headers.cookie);

  const explorerReady = Explorer.open(store.rootReal);
  const uiStateStore = new UiStateStore(store.rootReal);
  // Walking every plugin cache is slow, so the answer is kept for half a minute; "refresh=1" asks again (after an install).
  let skillsCache: { at: number; list: Promise<SkillInfo[]> } | null = null;
  const discoveredSkills = (refresh: boolean) => {
    if (refresh || !skillsCache || Date.now() - skillsCache.at > 30_000) skillsCache = { at: Date.now(), list: discoverSkills(opts.skillRoots ?? defaultRoots(homedir(), path.dirname(store.rootReal))) };
    return skillsCache.list;
  };
  const nodeSettings = new NodeSettingsService(uiStateStore, () => discoveredSkills(false));
  const insertionsReady=Promise.all([inkReady,assistance]).then(([ink,service])=>new InsertionStore(ink,store,service.ledger));
  const chatStore=new ChatStore(store.rootReal),diagramImages=new DiagramImageStore(store.rootReal);
  const investigateRef=(()=>{let resolve!:(i:InvestigateService)=>void;const promise=new Promise<InvestigateService>(r=>{resolve=r;});return {promise,resolve};})();
  const chatRef=(()=>{let resolve!:(r:ChatRuntime)=>void;const promise=new Promise<ChatRuntime>(r=>{resolve=r;});return {promise,resolve};})();
  const harnessReady=opts.harness?SessionIndex.open(opts.harness.dir??harnessDirectory(store.rootReal)).then(async index=>{const h=opts.harness!;await sweepStaleTurnFolders(index.dir).catch(()=>{}); /* a turn that was cut off leaves its notes in a turn-* folder: clear the old ones when the project opens */const runner=new ClaudeSessionRunner({command:h.command,prefixArgs:h.prefixArgs,model:h.model,dir:index.dir});
    // The one decision point for what a conversation may do, and the app's own earlier questions and final answers (for a fresh CLI session after its profile changed).
    const questions=new QuestionStore(index.dir),gate=new ConversationGate({index,notebook:store.rootReal,repo:()=>projectRepo(index.dir),notes:async()=>{const out:string[]=[],walk=(n:{path:string;type:string;children?:any[]})=>{if(n.type==='file'&&/\.md$/i.test(n.path))out.push(n.path);for(const c of n.children??[])walk(c);};walk(await store.tree());return out;}});
    const carried=async(s:import('../shared/harness.ts').HarnessSession):Promise<{question:string;answer:string}[]>=>carriedPairs(s,questions,await chatRef.promise,await investigateRef.promise);
    const investigate=new InvestigateService({index,dir:index.dir,notebook:store.rootReal,command:h.command,prefixArgs:h.prefixArgs,model:h.model,gate,carried});investigateRef.resolve(investigate);
    return {index,runner,questions,version:()=>runner.version(), // the CLI's version, for the ledger at a conversation's first turn and for Settings
    investigate,gate,carried};}):Promise.resolve(null);
  // Council's app-owned conversation index needs no CLI or transcript access.
  const councilIndexReady=opts.council?harnessReady.then(async h=>opts.council!.index??h?.index??await SessionIndex.open(harnessDirectory(store.rootReal))):Promise.resolve(null);
  const councilReady=opts.council?Promise.all([inkReady,councilIndexReady]).then(async([ink,index])=>new CouncilService({store,ink,index:index!,history:new CouncilHistory(index!,1024*1024,store.rootReal),availabilityChecks:opts.council!.availabilityChecks,ledger:new (await import('./ledger-store.ts')).LedgerStore(store.rootReal),adapters:opts.council!.adapters})):Promise.resolve(null);
  const normalReady=Promise.all([councilIndexReady,councilReady]).then(([index,council])=>index&&council?new NormalChat({index,questions:new QuestionStore(index.dir),council,adapters:opts.council!.adapters}):undefined);
  const chatReady:Promise<ChatRuntime>=Promise.all([inkReady,harnessReady,normalReady]).then(([ink,harness,normal])=>{const runtime=new ChatRuntime(store,ink,chatStore,opts.provider,opts.sessionModules,node=>nodeSettings.extras(node),harness??undefined,diagramImages,normal);chatRef.resolve(runtime);return runtime;});
  const chatInsertion=insertionsReady.then(insertions=>new ChatInsertion(store,chatStore,insertions));
  const councilInsertion=insertionsReady.then(insertions=>new CouncilInsertion(store,insertions));
  const investigateInsertion=insertionsReady.then(insertions=>new InvestigateInsertion(store,insertions));
  const threadsReady=inkReady.then(async ink=>new ThreadStore(ink,uiStateStore,(await assistance).ledger));
  const runtimeReady=threadsReady.then(threads=>new ThreadRuntime(store,threads,opts.provider??{
    name:'claude',checkAvailability:async()=>({available:false,code:'unsupported_cli',message:'Provider disabled. Enable it explicitly at server startup.'}),invoke:async()=>{throw new ProviderError('unsupported_cli');}
  },path=>{for(const c of clients)c.write(`event: ink\ndata: ${JSON.stringify({type:'ink',path})}\n\n`);},node=>nodeSettings.extras(node)));
  async function readUiState(): Promise<UiState> {
    try { const {v,tabs,active,treeCollapsed,theme,confirmAdd,typingHelp,doubleSpacePeriod,smartCorrections,neverCorrect}=await uiStateStore.read();return {v,tabs,active,...(treeCollapsed!==undefined?{treeCollapsed}:{}),...(theme!==undefined?{theme}:{}),...(confirmAdd!==undefined?{confirmAdd}:{}),...(typingHelp!==undefined?{typingHelp}:{}),...(doubleSpacePeriod!==undefined?{doubleSpacePeriod}:{}),...(smartCorrections!==undefined?{smartCorrections}:{}),...(neverCorrect!==undefined?{neverCorrect}:{})}; }
    catch { return {v:1,tabs:[],active:null}; }
  }
  function sanitizeUiState(raw: unknown): UiState {
    const r = (raw ?? {}) as Record<string, unknown>;
    const tabs: string[] = [];
    if (Array.isArray(r.tabs)) {
      for (const t of r.tabs.slice(0, 50)) {
        try {
          const rel = normalizeRel(t);
          if (isNotePath(rel) && !tabs.includes(rel)) tabs.push(rel);
        } catch {
          /* drop invalid tab */
        }
      }
    }
    if(r.neverCorrect!==undefined&&!validNeverCorrect(r.neverCorrect))throw new Error('Invalid typing preference.');
    const active = typeof r.active === "string" && tabs.includes(r.active) ? r.active : null;
    if(r.theme!==undefined&&r.theme!=='ember'&&r.theme!=='moss')throw new Error('Invalid theme preference.');
    if(r.confirmAdd!==undefined&&typeof r.confirmAdd!=='boolean')throw new Error('Invalid confirm-before-adding preference.');
    for(const name of ['typingHelp','doubleSpacePeriod','smartCorrections'] as const)if(r[name]!==undefined&&typeof r[name]!=='boolean')throw new Error('Invalid typing preference.');
    return { v: 1, tabs, active, ...(typeof r.treeCollapsed==='boolean'?{treeCollapsed:r.treeCollapsed}:{}),...(r.theme!==undefined?{theme:r.theme}:{}),...(typeof r.confirmAdd==='boolean'?{confirmAdd:r.confirmAdd}:{}),...(typeof r.typingHelp==='boolean'?{typingHelp:r.typingHelp}:{}),...(r.neverCorrect!==undefined?{neverCorrect:r.neverCorrect as string[]}:{}),...(typeof r.smartCorrections==='boolean'?{smartCorrections:r.smartCorrections}:{}),...(typeof r.doubleSpacePeriod==='boolean'?{doubleSpacePeriod:r.doubleSpacePeriod}:{}) };
  }
  async function writeUiState(s: UiState) { await uiStateStore.updateTabs(s); }

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const origin = (req.headers.origin ?? "").toLowerCase();
    const site = req.headers["sec-fetch-site"];
    if (origin && !security.originOk(origin)) return json(res, 403, { error: "forbidden_origin" });
    if (typeof site === "string" && site !== "same-origin" && site !== "none") return json(res, 403, { error: "forbidden_site" });
    // A launcher asks this before reusing a busy port. It reveals only that the port is Aitiarch.
    if (url.pathname === "/api/health" && req.method === "GET") return json(res, 200, { app: "aitiarch", v: 1 });

    if (url.pathname === "/api/session" && req.method === "GET") {
      if (!security.sessionAllowed(req.headers.cookie)) return json(res, 401, { error: "no_session", message: "Open Aitiarch from its launcher. This address alone does not start a session." });
      res.setHeader("Set-Cookie", `aitiarch=${token}; Path=/; HttpOnly; SameSite=Strict`);
      return json(res, 200, { rootName: path.basename(path.dirname(store.rootReal)) || path.basename(store.rootReal), rootPath: store.rootReal, gitRepo: await isGitRepository(store.rootReal), anchorCache: await (await inkReady).cache.status() });
    }
    if (!tokenOk(req)) return json(res, 401, { error: "no_session" });

    const mutating = req.method !== "GET" && req.method !== "HEAD";
    if (mutating) {
      if (req.headers["x-aitiarch"] !== "1" || !/^application\/json/i.test(req.headers["content-type"] ?? "") || !origin) {
        return json(res, 403, { error: "bad_request_headers" });
      }
    }

    if (url.pathname === "/api/pipeline-config" || url.pathname.startsWith("/api/pipeline-config/")) {
      // The user's pipeline overrides. Same front door as everything else (origin, session cookie, and for changes the JSON/x-aitiarch/origin rules above); bodies are capped at 64 KB.
      let store: PipelineConfigStore;
      try { store = new PipelineConfigStore(opts.pipelineConfigDir ?? resolveConfigFolder()); }
      catch { return json(res, 409, { error: "unavailable", message: "The settings folder is not available." }); }
      const route = `${req.method} ${url.pathname}`;
      try {
        if (route === "GET /api/pipeline-config/preview") {
          const surface=url.searchParams.get('surface');
          if(surface!=='chat'&&surface!=='skill-diagram'&&surface!=='investigate'&&surface!=='council')throw new PipelineConfigError(422,'invalid_surface','Choose chat, skill-diagram, investigate or council.');
          return json(res,200,pipelinePreview(surface,(await store.load()).effective));
        }
        if (route === "GET /api/pipeline-config") return json(res, 200, pipelineView(await store.load()));
        if (route === "GET /api/pipeline-config/export") {
          const data = JSON.stringify(await store.export(), null, 2) + "\n";
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="aitiarch-pipeline-config.json"' });
          return void res.end(data);
        }
        if (route === "PUT /api/pipeline-config") {
          const body = await readBody(req, PIPELINE_CONFIG_MAX_BYTES) as Record<string, unknown> | null;
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "overrides") throw new PipelineConfigError(422, "invalid_value", "Send {\"overrides\":{...}}.");
          return json(res, 200, pipelineView(await store.save(body.overrides)));
        }
        if (route === "PUT /api/pipeline-config/import") return json(res, 200, pipelineView(await store.import(await readBody(req, PIPELINE_CONFIG_MAX_BYTES))));
        if (route === "POST /api/pipeline-config/reset") { await readBody(req, PIPELINE_CONFIG_MAX_BYTES); return json(res, 200, pipelineView(await store.reset())); }
        return json(res, 404, { error: "not_found" });
      } catch (e) {
        if(e instanceof PreviewUnavailable)return json(res,409,{error:'preview_unavailable',message:e.message});
        if (e instanceof PipelineConfigError) return json(res, e.status, { error: e.code, message: e.message, ...(e.path ? { path: e.path } : {}) });
        throw e;
      }
    }
    if(url.pathname.startsWith('/api/council/')&&req.method==='GET'){const council=await councilReady;if(!council)return json(res,409,{error:'disabled'});try{if(url.pathname==='/api/council/availability')return json(res,200,{providers:await council.availability.get(url.searchParams.get('refresh')==='1')});if(url.pathname==='/api/council/history')return json(res,200,await council.history(url.searchParams.has('conversation')?url.searchParams.get('conversation')!:undefined));}catch{return json(res,409,{error:'invalid_conversation',message:'Council history could not be read for this conversation.'});}}
    if(url.pathname.startsWith('/api/council/')&&(req.method==='PUT'||req.method==='POST')){
      const council=await councilReady;if(!council)return json(res,409,{error:'disabled',message:'Council is not configured.'});
      const controller=new AbortController(),abort=()=>controller.abort();res.once('close',abort);
      try{const body=await readBody(req) as any;
        if(url.pathname==='/api/council/plan'&&req.method==='PUT'){
          const {approve,...input}=body??{};
          return json(res,200,approve===true?await council.approve(input):await council.plan(input));
        }
        if(url.pathname==='/api/council/bring-preview'&&req.method==='POST')return json(res,200,await (await councilInsertion).preview(body,id=>council.history(id) as any));
        if(url.pathname==='/api/council/bring-prepare'&&req.method==='POST')return json(res,200,await (await councilInsertion).prepare(body,id=>council.history(id) as any));
        if(url.pathname==='/api/council/cancel'&&req.method==='POST'){council.cancel(body?.conversation,body?.runId);return json(res,200,{cancelled:true});}
        if(url.pathname==='/api/council/run'&&req.method==='POST'){
          await council.run(body,controller.signal,event=>{if(res.destroyed){controller.abort();return;}if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);});return res.end();
        }
      }catch(e){const code=e instanceof Error&&['plan_required','plan_changed','invalid_conversation','invalid_run','notes_only','invalid_cap','already_running','invalid_bring','stale_review','no_answer','secrets_blocked'].includes(e.message)?e.message:'council_error';if(res.headersSent){if(!res.destroyed)res.write(`event: error\ndata: ${JSON.stringify({type:'error',code})}\n\n`);return res.end();}return json(res,409,{error:code,message:'Council: '+code.replace(/_/g,' ')+'.'});}
      finally{res.removeListener('close',abort);}
    }
    if (url.pathname === "/api/tree" && req.method === "GET") return json(res, 200, await (await explorerReady).tree());
    if (url.pathname === "/api/citations" && req.method === "GET") return json(res, 200, await noteIndex(await explorerReady));
    // The Constellation: the graph and remembered star positions; the handoff preview and its explicit write.
    if (url.pathname === "/api/graph" && req.method === "GET") return json(res, 200, { data: await buildGraph(await explorerReady), positions: await uiStateStore.starPositions().catch(() => ({})) });
    if (url.pathname === "/api/handoff" && req.method === "GET") return json(res, 200, await handoffDocument(await explorerReady));
    if (url.pathname === "/api/handoff/write" && req.method === "PUT") {
      await readBody(req);
      try { return json(res, 200, await writeHandoff(await explorerReady)); }
      catch (e) { if (e instanceof HandoffError) return json(res, 409, { error: e.code, message: e.message }); throw e; }
    }
    if (url.pathname === "/api/constellation/positions" && req.method === "PUT") {
      const b = (await readBody(req)) as { positions?: unknown };
      try { return json(res, 200, { positions: await uiStateStore.saveStarPositions(b?.positions as never) }); }
      catch (e) { const m = String((e as Error).message); return json(res, /ignored/.test(m) ? 409 : 400, { error: /ignored/.test(m) ? "not_private" : "invalid", message: /ignored/.test(m) ? "Star positions stay in memory until /ui-state.json* is git-ignored." : "Those positions could not be saved." }); }
    }
    if (url.pathname === "/api/backlinks" && req.method === "GET") return json(res, 200, await backlinks(await explorerReady, url.searchParams.get("path")));
    if (url.pathname.startsWith("/api/explorer/") && req.method === "PUT") {
      const b = (await readBody(req)) as Record<string, unknown>, ex = await explorerReady;
      switch (url.pathname) {
        case "/api/explorer/new-note": return json(res, 200, await ex.createNote(b?.path));
        case "/api/explorer/new-folder": return json(res, 200, await ex.createFolder(b?.path));
        case "/api/explorer/move-preview": return json(res, 200, await ex.planMove(b?.from, b?.to));
        case "/api/explorer/move": { const done = await ex.move(b?.from, b?.to); for (const c of clients) c.write(`event: tree\ndata: ${JSON.stringify({ type: "tree" })}\n\n`); return json(res, 200, done); }
      }
      return json(res, 404, { error: "not_found" });
    }
    if(url.pathname==='/api/nodes'&&req.method==='GET')return json(res,200,{nodes:await nodeSettings.get()});
    if(url.pathname==='/api/nodes'&&req.method==='PUT'){
      const body=await readBody(req);
      if(!validSavedNodes(body))return json(res,400,{error:'invalid_nodes',message:'Those settings are not valid. Nothing was changed.'});
      const {persisted}=await nodeSettings.save(body);return json(res,200,{nodes:await nodeSettings.get(),persisted});
    }
    if(url.pathname==='/api/skills'&&req.method==='GET'){
      const ids=(url.searchParams.get('ids')??'').split(',').filter(Boolean);
      return json(res,200,skillLibrary(await discoveredSkills(url.searchParams.get('refresh')==='1'),{q:url.searchParams.get('q')??'',ids,limit:Number(url.searchParams.get('limit'))||undefined}));
    }
    if(url.pathname==='/api/usage'&&req.method==='GET'){
      const chats=(await chatReady).usage(),h=await harnessReady,investigate=h?await h.investigate.usage():null;
      let privateUsage:import('../shared/usage.ts').UsageSummary={since:new Date().toISOString(),hourlyCap:activePipelineConfig().transport.planHourlyCap,providers:[]};
      if(opts.usage)try{privateUsage=await opts.usage.summary();}catch{privateUsage.privateUsageUnavailable=true;console.warn('Private usage log unavailable.',{kind:'private_usage_unavailable'});}
      return json(res,200,{...privateUsage,councilCli:opts.council?.adapters.find(a=>a.id==='codex')?.status?.(),...(chats.length?{chats}:{}),...(investigate&&(investigate.turns>0||investigate.ledgerUnavailable)?{investigate}:{}),...(h?{cli:{version:await h.runner.version(),tested:TESTED_CLI_VERSION}}:{})});
    }
    // Harness chat sessions: the app's own list for this project, a new one for a note, and a new label. Nothing here talks to the CLI.
    if(url.pathname==='/api/harness/sessions'&&req.method==='GET'){
      // `all=1`: every chat conversation of the project, whichever note it was started on (a conversation follows the person from note to note, so the picker lists them all).
      const h=await harnessReady,mode=url.searchParams.get('mode')==='investigate'?'investigate' as const:'chat' as const,note=mode==='chat'&&url.searchParams.get('all')!=='1'?url.searchParams.get('path')||undefined:undefined;if(note)await store.read(note);
      const index=h?.index??await councilIndexReady;
      return json(res,200,{enabled:!!index,sessions:index?await index.list({mode,...(note?{note}:{})}):[]});
    }
    // What Delete conversation would remove from the chat record of the note a conversation was started on: that note and how many saved replies. The confirmation says it.
    if(url.pathname==='/api/harness/sessions/replies'&&req.method==='GET'){
      if(!await harnessReady){const normal=await normalReady,s=await normal?.index.get(url.searchParams.get('id')??'');if(!s)return json(res,409,{error:'invalid_session',message:'No such conversation.'});const replies=s.mode==='chat'&&s.note?await(await chatReady).conversationReplies(s.note,s.id,new Set(Object.keys(await normal!.questions.read(s.id)))):0;return json(res,200,{note:s.note??null,replies});}
      const h=await harnessReady;if(!h)return json(res,409,{error:'disabled',message:'Sessions need the Claude Code CLI. Start Aitiarch with --claude.'});
      const s=await h.index.get(url.searchParams.get('id')??'');if(!s)return json(res,409,{error:'invalid_session',message:'No such session.'});
      const replies=s.mode==='chat'&&s.note?await (await chatReady).conversationReplies(s.note,s.id,new Set(Object.keys(await h.questions.read(s.id)))):0;
      return json(res,200,{note:s.note??null,replies});
    }
    // Investigations, read-only: the project's repo folder, a session's turns (question and answer, for a reload), whether it still needs its
    // plan confirmed, and a redacted excerpt of a real repo file around a line (for a file claim).
    if(url.pathname.startsWith('/api/harness/investigate/')&&req.method==='GET'){
      const h=await harnessReady;if(!h)return json(res,409,{error:'disabled',message:'Investigations need the Claude Code CLI. Start Aitiarch with --claude.'});
      const q=url.searchParams,session=q.get('session')??'';
      try{
        if(url.pathname==='/api/harness/investigate/repo')return json(res,200,{repo:await h.investigate.repo()});
        if(url.pathname==='/api/harness/investigate/turns')return json(res,200,{turns:await h.investigate.turns(session)});
        if(url.pathname==='/api/harness/investigate/status')return json(res,200,{needsPlan:await h.investigate.needsPlan(session)});
        if(url.pathname==='/api/harness/investigate/excerpt')return json(res,200,await h.investigate.excerpt(session,q.get('path'),Number(q.get('line'))));
      }catch(e){if(e instanceof InvestigateError)return json(res,409,{error:e.code,message:'Investigation: '+e.code.replace(/_/g,' ')+'.'});throw e;}
    }
    // The questions asked in this note's named conversations, by message id, so a reloaded panel can show them.
    // A named conversation's whole history by its id: its saved replies (from the chat record of the note it was started on, in order), its questions, its counters and the label. It does
    // not depend on which note is open.
    if(url.pathname==='/api/harness/sessions/history'&&req.method==='GET'){
      if(!await harnessReady){const normal=await normalReady,s=await normal?.index.get(url.searchParams.get('id')??'');if(!s||s.mode!=='chat')return json(res,409,{error:'invalid_session',message:'No such conversation.'});const questions=await normal!.questions.read(s.id),runtime=await chatReady;return json(res,200,{session:s,messages:s.note?await runtime.conversationMessages(s.note,s.id,new Set(Object.keys(questions))):[],questions,persistence:await chatStore.status(),usage:runtime.usage().find(c=>c.session===s.id)??null});}
      const h=await harnessReady;if(!h)return json(res,409,{error:'disabled',message:'Sessions need the Claude Code CLI. Start Aitiarch with --claude.'});
      const s=await h.index.get(url.searchParams.get('id')??'');if(!s||s.mode!=='chat'||!s.note)return json(res,409,{error:'invalid_session',message:'No such conversation.'});
      const questions=await h.questions.read(s.id),runtime=await chatReady;
      return json(res,200,{session:s,messages:await runtime.conversationMessages(s.note,s.id,new Set(Object.keys(questions))),questions,persistence:await chatStore.status(),usage:runtime.usage().find(c=>c.session===s.id)??null});
    }
    if(url.pathname==='/api/harness/questions'&&req.method==='GET'){
      // `session=<id>`: that conversation's questions by message id, whichever note is open; `path`: every conversation's started on that note.
      const h=await harnessReady??await normalReady,wanted=url.searchParams.get('session');
      if(wanted!==null){const s=h?await h.index.get(wanted):null;if(!s||s.mode!=='chat')return json(res,409,{error:'invalid_session',message:'No such conversation.'});return json(res,200,{questions:await h!.questions.read(s.id)});}
      const note=url.searchParams.get('path')??'';await store.read(note);
      const out:Record<string,string>={};if(h)for(const s of await h.index.list({mode:'chat',note}))Object.assign(out,await h.questions.read(s.id));
      return json(res,200,{questions:out});
    }
    if((url.pathname.startsWith('/api/harness/sessions/')||url.pathname.startsWith('/api/harness/investigate/'))&&req.method==='PUT'){
      const h=await harnessReady,b=await readBody(req) as any;
      if(!h&&url.pathname.startsWith('/api/harness/sessions/')){
        const index=await councilIndexReady;if(index)try{
          if(url.pathname==='/api/harness/sessions/new'){if(b?.mode!=='chat'||typeof b.path!=='string')throw new SessionIndexError('Invalid session.');await store.read(b.path);return json(res,200,await index.create({mode:'chat',label:b.label,note:b.path}));}
          if(url.pathname==='/api/harness/sessions/rename')return json(res,200,await index.rename(b?.id,b?.label));
          if(url.pathname==='/api/harness/sessions/delete'){const s=await index.get(b?.id);if(!s)throw new SessionIndexError('No such session.');const normal=await normalReady,replies=s.mode==='chat'&&s.note?await(await chatReady).forgetConversation(s.note,s.id,new Set(Object.keys(await normal!.questions.read(s.id)))):0;await normal!.questions.remove(s.id);await index.remove(b.id);return json(res,200,{removed:[],replies});}
        }catch(e){if(e instanceof SessionIndexError)return json(res,400,{error:'invalid_session',message:e.message});throw e;}
      }
      if(!h)return json(res,409,{error:'disabled',message:'Sessions need the Claude Code CLI. Start Aitiarch with --claude.'});
      if(url.pathname==='/api/harness/investigate/bring-preview'||url.pathname==='/api/harness/investigate/bring-prepare'){
        try{const ins=await investigateInsertion,turns=(id:string)=>h.investigate.turns(id) as any;return json(res,200,url.pathname.endsWith('preview')?await ins.preview(b,turns):await ins.prepare(b,turns));}
        catch(e){const code=e instanceof Error&&['invalid_bring','stale_review','no_answer','secrets_blocked'].includes(e.message)?e.message:'investigate_bring_failed';return json(res,409,{error:code,message:'Add to note: '+code.replace(/_/g,' ')+'.'});}
      }
      try{
        if(url.pathname==='/api/harness/sessions/new'){
          if(b?.mode==='investigate')return json(res,200,await h.investigate.create(b.label,b.repo));
          if(b?.mode!=='chat'||typeof b.path!=='string')throw new SessionIndexError('Invalid session.');await store.read(b.path);return json(res,200,await h.index.create({mode:'chat',label:b.label,note:b.path}));
        }
        if(url.pathname==='/api/harness/sessions/rename')return json(res,200,await h.index.rename(b?.id,b?.label));
        // Delete conversation: the CLI's transcript for this one id (under ~/.claude/projects/<its working folder>), then the app's own entry.
        if(url.pathname==='/api/harness/sessions/delete'){
          const s=await h.index.get(b?.id);if(!s)throw new SessionIndexError('No such session.');
          // Every CLI session this conversation used (a profile change starts a fresh one), each under the folder it ran in.
          const chatCwd=await h.runner.chatCwd(),dflt=s.mode==='chat'?chatCwd:await h.investigate.snapshotCwd(s.repo!);
          const used=[{id:s.id,cwd:s.cli?.id===s.id?s.cli.cwd:undefined},...(s.cli&&s.cli.id!==s.id?[{id:s.cli.id,cwd:s.cli.cwd}]:[]),...(s.past??[])];
          const removed:any[]=[];for(const x of used)removed.push(...await removeTranscript(x.cwd==='chat'?chatCwd:x.cwd??dflt,x.id,opts.harness?.home));
          // The replies this conversation saved in its note's chat record go with it (found by the id they carry, and by the ids of its kept questions for older ones).
          const replies=s.mode==='chat'&&s.note?await (await chatReady).forgetConversation(s.note,s.id,new Set(Object.keys(await h.questions.read(s.id)))):0;
          await h.questions.remove(s.id);await h.index.remove(s.id);await h.investigate.forget(s.id); // a conversation of either kind may have run Investigate turns: their stored turns and tripwire copy go too
          return json(res,200,{removed,replies});
        }
        if(url.pathname==='/api/harness/investigate/repo')return json(res,200,{repo:await h.investigate.chooseRepo(b?.repo)});
        if(url.pathname==='/api/harness/investigate/plan')return json(res,200,await h.investigate.plan(b?.session,b?.budgetUsd));
        if(url.pathname==='/api/harness/investigate/confirm')return json(res,200,await h.investigate.confirm(b?.session,b?.planHash));
        if(url.pathname==='/api/harness/investigate/cancel'){h.investigate.cancel(b?.session);return json(res,200,{});}
        if(url.pathname==='/api/harness/investigate/restore')return json(res,200,{restored:await h.investigate.restore(b?.session)});
        if(url.pathname==='/api/harness/investigate/send'){
          const controller=new AbortController();res.on('close',()=>controller.abort());
          await h.investigate.send(b?.session,b?.question,event=>{
            if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
            if(!res.destroyed)res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          },controller.signal);
          return res.end();
        }
      }catch(e){
        if(e instanceof SessionIndexError)return json(res,400,{error:'invalid_session',message:e.message});
        if(e instanceof InvestigateError){if(res.headersSent)return res.end();return json(res,409,{error:e.code,message:'Investigation: '+e.code.replace(/_/g,' ')+'. Nothing was run.'});}
        throw e;
      }
    }
    // One conversation entry point. What a turn may do is decided here, from what it carries (attachments) and what the conversation was approved for (its plan card): the page sends attachments
    // and never a profile or a cost cap. `files` lists matches for the "@" picker; `plan` is the card for given attachments; `approve` grants exactly what the server computes again; `turn` runs one turn.
    if(url.pathname==='/api/conversation/files'&&req.method==='GET'){
      const h=await harnessReady;if(!h)return json(res,409,{error:'disabled',message:'Conversations need the Claude Code CLI. Start Aitiarch with --claude.'});
      return json(res,200,await h.gate.suggest(url.searchParams.get('q')??''));
    }
    // What the conversation was approved for, as the server would honour it now (a stored grant that does not belong to this conversation and project, or whose record was changed, is nothing): for the page to
    // show the chips of the files and repo it covers. Display only; every turn is still decided by the gate.
    if(url.pathname==='/api/conversation/grant'&&req.method==='GET'){
      const h=await harnessReady;if(!h)return json(res,409,{error:'disabled',message:'Conversations need the Claude Code CLI. Start Aitiarch with --claude.'});
      const s=await h.index.get(url.searchParams.get('id')??'');if(!s)return json(res,409,{error:'invalid_session',message:'No such conversation.'});
      const g=h.gate.effective(s).grant;
      return json(res,200,{grant:g?{profile:g.profile,files:[...g.files],repo:g.repo,diagrams:g.diagrams,...(g.diagramNote?{diagramNote:g.diagramNote}:{}),budgetUsd:g.budgetUsd}:null});
    }
    if(url.pathname.startsWith('/api/conversation/')&&req.method==='PUT'){
      const h=await harnessReady,b=await readBody(req) as any;
      if(!h)return json(res,409,{error:'disabled',message:'Conversations need the Claude Code CLI. Start Aitiarch with --claude.'});
      try{
        const runtime=await chatReady;
        // Which diagrams a turn may open is decided here from the note the turn is about: the note open now (`openNote`; the conversation's own note when the page names none), which must be a real note of this project.
        // Never a path the page merely claims: openableDiagrams reads it through the store (and refuses hidden folders), and the editor line the turn carries must be about the same note.
        const base=async()=>{
          if(b?.openNote!==undefined&&typeof b.openNote!=='string')throw new PathError(400,'invalid_note','The open note is not a note of this project.');
          const note=typeof b?.openNote==='string'?b.openNote:typeof b?.path==='string'?b.path:'';
          if(b?.editor!==undefined&&(!b.editor||typeof b.editor!=='object'||(note&&b.editor.path!==note)))throw new PathError(400,'invalid_note','The editor line is about another note than the open one.');
          const d=note?await runtime.openableDiagrams(note).catch(()=>{throw new PathError(400,'invalid_note','The open note is not a note of this project.');}):null;
          return {conversation:b?.conversationId,attachments:b?.attachments,hasDiagrams:!!d?.has,diagrams:d?.all??[],...(d?{diagramNote:d.note}:{})};
        };        if(url.pathname==='/api/conversation/plan'){
          const plan=await h.gate.plan({...await base(),budgetUsd:b?.budgetUsd});
          const excludedFromCopy=plan.profile==='investigate'&&plan.repo?await excludedSnapshotPaths(plan.repo.path,store.rootReal,plan.attachments.repo?undefined:new Set(plan.files.map(f=>f.path))):undefined;
          return json(res,200,{...plan,...(excludedFromCopy?{excludedFromCopy}:{})});
        }
        if(url.pathname==='/api/conversation/approve')return json(res,200,{grant:await h.gate.approve({...await base(),budgetUsd:b?.budgetUsd,hash:b?.hash})});
        // SEND PATH 2 of 2. This entry runs a conversation turn that carries files or the repo (profile "investigate") through plan, approve and turn; it also runs a notes or diagrams turn when the page uses it
        // (the page itself sends those through /api/chat/review + /api/chat/send, path 1). The two paths are NOT merged yet: both ask the same gate (ConversationGate.authorize) before anything starts.
        if(url.pathname==='/api/conversation/turn'){
          if(typeof b?.text!=='string'||!b.text.trim())return json(res,400,{error:'invalid',message:'Write a question first.'});
          const input=await base(),auth=await h.gate.authorize(input); // refuses, with the card to show, anything the conversation was not approved for
          const controller=new AbortController(),abort=()=>controller.abort('client_disconnect');res.on('close',abort);
          const write=(event:{type:string})=>{if(res.destroyed){controller.abort('client_disconnect');return;}if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);};
          try{
            if(auth.profile==='investigate')await h.investigate.sendGranted(auth,b.text,write,controller.signal,input.diagrams.length?input.diagrams:undefined);
            else{
              const notes=auth.attachments.notes,context=(Array.isArray(b.context)?b.context.filter((c:any)=>c?.moduleId!=='other-notes'):[{moduleId:'this-note',ids:['note']}]).concat(notes.length?[{moduleId:'other-notes',ids:notes}]:[]);
              const review=await runtime.review({id:typeof b.id==='string'?b.id:randomUUID(),path:b.path,question:b.text,context,session:auth.session.id,...(typeof b.selection==='string'?{selection:b.selection}:{}),...(b.editor!==undefined?{editor:b.editor}:input.diagramNote&&input.diagramNote!==b.path?{editor:{path:input.diagramNote,title:input.diagramNote}}:{})}); // the review is about the same note the gate decided on
              await runtime.send({reviewId:review.reviewId,confirmed:true},write,controller.signal);
            }
            res.end();
          }finally{res.off('close',abort);}
          return;
        }
      }catch(e){
        if(res.headersSent)return res.end();
        if(e instanceof GateRefusal)return json(res,409,{error:e.code,message:'This conversation can not do that yet ('+e.code.replace(/_/g,' ')+'). Nothing was sent.',...(e.plan?{plan:e.plan}:{}),...(e.files?{files:e.files}:{})});
        if(e instanceof SessionIndexError)return json(res,400,{error:'invalid_session',message:e.message});
        if(e instanceof InvestigateError)return json(res,409,{error:e.code,message:'Investigation: '+e.code.replace(/_/g,' ')+'. Nothing was run.'});
        if(e instanceof ChatError)return json(res,409,{error:e.code,message:CHAT_MESSAGES[e.code]});
        throw e;
      }
      throw new PathError(400,'bad_body','Unknown conversation action.');
    }
    if(url.pathname==='/api/chat'&&req.method==='GET'){
      const note=url.searchParams.get('path')??'',session=url.searchParams.get('session')??'';await store.read(note);
      if(session&&!validSessionId(session))return json(res,409,{error:'invalid_chat',message:CHAT_MESSAGES.invalid_chat});
      const saved=await chatStore.read(note),runtime=await chatReady;
      return json(res,200,{...saved,messages:[...saved.messages,...runtime.memoryMessages(note)],persistence:await chatStore.status(),questionPlaceholder:'Question unavailable after reload.',usage:runtime.usage().find(c=>c.note===note&&c.session===(session||undefined))??null});
    }
    if(url.pathname==='/api/chat/modules'&&req.method==='GET')return json(res,200,await (await chatReady).modules(url.searchParams.get('path')??'',url.searchParams.get('sessions')==='1',url.searchParams.get('otherProjects')==='1'));
    // SEND PATH 1 of 2. /api/chat/review + /api/chat/send run the one-off chat and conversation turns whose profile is "notes" (no tools) or "diagrams" (Read in the PNG folder); the review shows what is sent and
    // send re-asks the gate. A turn that carries files or the repo (profile "investigate") never goes through here: it goes through /api/conversation/plan, approve and turn (path 2).
    if(url.pathname.startsWith('/api/chat/')&&req.method==='PUT'){
      const b=await readBody(req) as any,runtime=await chatReady;
      try{
        if(url.pathname==='/api/chat/review')return json(res,200,await runtime.review(b));
        if(url.pathname==='/api/chat/session-preview')return json(res,200,await runtime.sessionPreview(b.path,b.context));
        if(url.pathname==='/api/chat/settings')return json(res,200,await runtime.settings(b.path,b,typeof b.session==='string'&&validSessionId(b.session)?b.session:undefined));
        if(url.pathname==='/api/chat/cancel'){runtime.cancel(b.path);return json(res,200,{});}
        if(url.pathname==='/api/chat/enable'){
          if(b.action!=='add-ignore-line')throw new ChatError('invalid_chat');return json(res,200,await chatStore.enablePersistence());
        }
        if(url.pathname==='/api/chat/bring-preview')return json(res,200,await (await chatInsertion).preview(b));
        if(url.pathname==='/api/chat/bring-prepare')return json(res,200,await (await chatInsertion).prepare(b));
        if(url.pathname==='/api/chat/bring-complete')return json(res,200,await (await chatInsertion).complete(b.path,b.operationId));
        if(url.pathname==='/api/chat/bring-cancel')return json(res,200,await (await chatInsertion).cancel(b.path,b.operationId));
        if(url.pathname==='/api/chat/send'){
          // A stop is never a throw inside the stream callback (the CLI runner would swallow it as bad output): it aborts the request with its cause,
          // and the runtime records that cause and ends the turn. The closing frame (error or complete) is small and is still sent unless the page is gone.
          const controller=new AbortController(),abort=()=>controller.abort('client_disconnect');res.on('close',abort);
          let emitted=0;
          try{await runtime.send(b,event=>{
            if(res.destroyed){controller.abort('client_disconnect');return;}
            const closing=event.type==='error'||event.type==='complete';
            if(controller.signal.aborted&&!closing)return;
            if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
            const frame=`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
            if(!closing){emitted+=Buffer.byteLength(frame);if(emitted>512000){controller.abort('sse_limit');return;}}
            res.write(frame);if(!closing&&res.writableLength>262144)controller.abort('sse_limit');
          },controller.signal);res.end();}finally{res.off('close',abort);}return;
        }
      }catch(e){
        if(res.headersSent)return res.end();
        const code=e instanceof ChatError?e.code:e instanceof ProviderError?'provider_failed':'invalid_chat';
        return json(res,409,{error:code,message:e instanceof ChatError&&e.budget?budgetText(e.budget):CHAT_MESSAGES[code],...(e instanceof ChatError&&e.budget?{budget:e.budget}:{}),...(activePipelineConfig().normalAnswerer!=='claude'?whyOfError(code,e):{})});
      }
      throw new PathError(400,'bad_body','Unknown chat action.');
    }

    if(url.pathname==='/api/insertions'&&req.method==='GET')return json(res,200,await (await insertionsReady).reconcile(url.searchParams.get('path')??''));
    // A skill's diagram: served only to be framed by this app, under a CSP that blocks all network (also injected in the document itself).
    if(url.pathname==='/api/skill-diagram'&&req.method==='GET'){
      try{const name=url.searchParams.get('name')??'',bytes=await (await assistance).skillDiagrams.read(name),svg=name.endsWith('.svg');res.writeHead(200,{'Content-Type':svg?'image/svg+xml':'text/html; charset=utf-8','Content-Security-Policy':svg?SKILL_DIAGRAM_SVG_CSP_HEADER:SKILL_DIAGRAM_CSP_HEADER,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'private, max-age=31536000, immutable'});return res.end(bytes);}catch{return json(res,404,{error:'not_found'});}
    }
    // The picture of a diagram (a PNG the page made from the diagram's sanitised svg), which a conversation turn may open as a copy: listed and saved only under a strict name, and checked as untrusted bytes.
    // The page never reads it back (there are no thumbnails), so it is not served.
    if(url.pathname==='/api/diagram-images'&&req.method==='GET'){
      const names=(url.searchParams.get('names')??'').split(',').filter(Boolean);
      if(names.length>40||names.some(n=>!DIAGRAM_PNG_NAME.test(n)))return json(res,400,{error:'invalid_image',message:'Those are not diagram picture names.'});
      const images=[];for(const n of names){try{const i=await diagramImages.info(n);if(i)images.push(i);}catch{/* a name that cannot be served is simply not listed */}}
      return json(res,200,{images});
    }
    if(url.pathname==='/api/diagram-image'&&req.method==='PUT'){
      const b=await readBody(req) as {name?:unknown;data?:unknown};
      try{
        if(typeof b?.name!=='string'||!DIAGRAM_PNG_NAME.test(b.name))throw new DiagramImageError('bad_name');
        if(typeof b.data!=='string'||b.data.length>Math.ceil(DIAGRAM_PNG_MAX_BYTES*4/3)+8||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.data))throw new DiagramImageError('not_png');
        return json(res,200,await diagramImages.save(b.name,Buffer.from(b.data,'base64')));
      }catch(e){if(e instanceof DiagramImageError)return json(res,400,{error:'invalid_image',message:'The diagram picture was refused ('+e.problem.replace(/_/g,' ')+'). Nothing was saved.'});throw e;}
    }
    if(url.pathname==='/api/diagram-asset'&&req.method==='GET'){
      try{const bytes=await (await insertionsReady).asset(url.searchParams.get('name')??'');res.writeHead(200,{'Content-Type':'image/svg+xml','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=31536000, immutable'});return res.end(bytes);}catch{return json(res,404,{error:'not_found'});}
    }
    if(url.pathname==='/api/threads'&&req.method==='GET'){
      const active=new Set([...(await assistance).activeIds(),...(await runtimeReady).activeIds()]);
      return json(res,200,await (await threadsReady).reconcileInterrupted(url.searchParams.get('path')??'',active));
    }
    if(url.pathname==='/api/thread-drafts/status'&&req.method==='GET')return json(res,200,await uiStateStore.draftStatus());
    if(url.pathname==='/api/thread-drafts'&&req.method==='GET'){
      const status=await uiStateStore.draftStatus();return json(res,200,{...status,draft:status.enabled?await uiStateStore.draft(url.searchParams.get('path')??'',url.searchParams.get('id')??''):null});
    }
    if((url.pathname.startsWith('/api/threads/')||url.pathname.startsWith('/api/thread-drafts/'))&&req.method==='PUT'){
      const b=await readBody(req) as any,threads=await threadsReady,runtime=await runtimeReady;
      try{
        if(url.pathname==='/api/thread-drafts/enable'){
          if(b.action!=='add-ignore-line')throw new Error('Explicit ignore setup action required.');return json(res,200,await uiStateStore.enableDrafts());
        }
        // "Make it mine" targets a callout position in a note, not a thread id.
        if(url.pathname==='/api/threads/bring-adopt'){if(typeof b.path!=='string'||typeof b.from!=='number')throw new Error('Invalid callout target.');return json(res,200,await (await insertionsReady).adopt(b.path,b.from));}
        if(typeof b.path!=='string'||!validId(b.id))throw new Error('Invalid thread target.');
        if(url.pathname==='/api/thread-drafts/save')return json(res,200,await threads.saveDraft(b.path,b.id,b.text,b.revision));
        if(url.pathname==='/api/threads/bring-preview')return json(res,200,await (await insertionsReady).preview(b));
        if(url.pathname==='/api/threads/bring-prepare')return json(res,200,await (await insertionsReady).prepare(b));
        if(url.pathname==='/api/threads/bring-complete')return json(res,200,await (await insertionsReady).complete(b.path,b.operationId));
        if(url.pathname==='/api/threads/bring-cancel')return json(res,200,await (await insertionsReady).cancel(b.path,b.operationId));
        if(url.pathname==='/api/threads/brought'){if(typeof b.noteVersion!=='string')throw new Error('Missing note version.');await threads.brought(b.path,b.id,b.noteVersion);return json(res,200,{});}
        if(url.pathname==='/api/threads/action')return json(res,200,await threads.act(b.path,b.id,b.version,b.action));
        if(url.pathname==='/api/threads/notice'){
          const a=await (await assistance).availability();return json(res,200,await threads.providerNotice(b.path,b.id,a.provider==='chatgpt-plan'?'chatgpt-plan':'claude'));
        }
        if(url.pathname==='/api/threads/preview')return json(res,200,await runtime.preview(b));
        if(url.pathname==='/api/threads/invoke')return json(res,202,await runtime.start(b as ThreadRequest));
        if(url.pathname==='/api/threads/shown')return json(res,200,await threads.shown(b.path,b.id,b.replyId));
        if(url.pathname==='/api/threads/status')return json(res,200,{status:runtime.status(b.replyId)});
        if(url.pathname==='/api/threads/retry-save'){await runtime.retrySave(b.replyId);return json(res,200,await threads.read(b.path));}
        if(url.pathname==='/api/threads/cancel'){runtime.cancel(b.replyId);return json(res,200,{});}
      }catch(e){return json(res,409,{error:'thread_conflict',message:e instanceof Error?e.message:'Thread action failed. Original preserved.'});}
      throw new PathError(400,'bad_body','Unknown thread action.');
    }

    if(url.pathname==='/api/chatgpt-plan'&&req.method==='GET')return json(res,200,opts.plan?await opts.plan.status():{enabled:false});
    if(url.pathname.startsWith('/api/chatgpt-plan/')&&req.method==='PUT'){
      if(!opts.plan)throw new ProviderError('unsupported_cli','ChatGPT plan is disabled. Restart with --chatgpt-plan to enable it.');
      const b=await readBody(req) as Record<string,unknown>;
      if(url.pathname.endsWith('/sign-in')){const attempt=await opts.plan.beginSignIn();void attempt.completed.catch(()=>{});return json(res,200,{url:attempt.url});}
      if(url.pathname.endsWith('/sign-out'))return json(res,200,await opts.plan.signOut());
      if(url.pathname.endsWith('/models'))return json(res,200,await opts.plan.listModels());
      if(url.pathname.endsWith('/settings')){
        if(typeof b.hourlyCap==='number')await opts.plan.setHourlyCap(b.hourlyCap);
        if(typeof b.model==='string')opts.plan.setModel(b.model);
        return json(res,200,await opts.plan.status());
      }
      if(url.pathname.endsWith('/acknowledge')){await opts.plan.acknowledge();return json(res,200,{});}
      throw new PathError(400,'bad_body','Unknown ChatGPT connection action.');
    }

    if (url.pathname === "/api/assistance" && req.method === "GET") return json(res, 200, await (await assistance).availability());
    if (url.pathname === "/api/assistance/status" && req.method === "GET") {
      try { return json(res, 200, (await assistance).status(url.searchParams.get("id") ?? "")); }
      catch { return json(res, 404, { error: "interrupted", message: "Request not found or interrupted by server restart. It was not rerun." }); }
    }
    if (url.pathname.startsWith("/api/assistance/") && req.method === "PUT") {
      const b = await readBody(req) as Record<string, unknown>, service = await assistance;
      if (url.pathname === "/api/assistance/preview" || url.pathname === "/api/assistance/invoke") {
        const input = { id: b.id, path: b.path, action: b.action, question: b.question, text: b.text, from: b.from, to: b.to, ...(b.renderer === undefined ? {} : { renderer: b.renderer }), ...(b.skill === undefined ? {} : { skill: b.skill }) } as Invocation;
        if (url.pathname.endsWith("preview")) return json(res, 200, await service.preview(input));
        return json(res, 202, await service.start(input));
      }
      if (typeof b.id !== "string") throw new PathError(400, "bad_body", "Invalid request ID.");
      if (url.pathname.endsWith("/cancel")) { await service.cancel(b.id); return json(res, 200, {}); }
      if (url.pathname.endsWith("/retry-save")) { await service.retrySave(b.id); return json(res, 200, {}); }
      if (url.pathname.endsWith("/event") && typeof b.path === "string" && (b.event === "shown" || b.event === "dismissed")) {
        await service.event(b.path, b.id, b.event); return json(res, 200, {});
      }
      throw new PathError(400, "bad_body", "Invalid assistance action.");
    }

    if (url.pathname === "/api/anchor-cache/enable" && req.method === "PUT") {
      const b = (await readBody(req)) as Record<string, unknown>;
      if (b.action !== "add-ignore-line") throw new PathError(400, "bad_body", "Explicit cache setup action required.");
      return json(res, 200, await (await inkReady).cache.enable());
    }
    if (url.pathname === "/api/ink" && req.method === "GET") {
      const ink = await inkReady, path = url.searchParams.get("path") ?? "", snapshot = await ink.read(path);
      return json(res, 200, url.searchParams.get("resolve") === "1" && snapshot.version !== null ? await ink.reanchor(path, snapshot.version) : snapshot);
    }
    if (url.pathname === "/api/ink/checkpoint" && req.method === "PUT") {
      const b = (await readBody(req)) as Record<string, unknown>;
      if (typeof b.path !== "string" || !(b.inkVersion === null || typeof b.inkVersion === "string") || typeof b.noteVersion !== "string" || !Array.isArray(b.items)) throw new PathError(400, "bad_body", "Invalid mapping checkpoint.");
      try { return json(res, 200, await (await inkReady).checkpoint(b.path, b.inkVersion, b.noteVersion, b.items as Parameters<InkStore["checkpoint"]>[3])); }
      catch (e) { if (/conflict|busy/i.test(String(e))) return json(res, 409, { error: "conflict", message: String(e) }); throw e; }
    }
    if (url.pathname === "/api/ink/attach" && req.method === "PUT") {
      const b = (await readBody(req)) as Record<string, unknown>;
      if (typeof b.path !== "string" || typeof b.id !== "string" ||
          !(b.inkVersion === null || typeof b.inkVersion === "string") || typeof b.noteVersion !== "string" ||
          !Number.isSafeInteger(b.from) || !Number.isSafeInteger(b.to)) throw new PathError(400, "bad_body", "Invalid re-attachment request.");
      try { return json(res, 200, await (await inkReady).attach(b.path, b.id, b.inkVersion, b.noteVersion, b.from as number, b.to as number)); }
      catch (e) {
        if (/conflict|busy|already attached/i.test(String(e))) return json(res, 409, { error: "conflict", message: String(e) });
        if (/invalid|not found/i.test(String(e))) return json(res, 400, { error: "bad_selection", message: String(e) });
        throw e;
      }
    }

    if (url.pathname === "/api/file" && req.method === "GET") {
      return json(res, 200, await store.read(url.searchParams.get("path")));
    }
    if (url.pathname === "/api/file" && req.method === "PUT") {
      const body = (await readBody(req)) as Record<string, unknown>;
      if (typeof body.text !== "string" || typeof body.base !== "string") throw new PathError(400, "bad_body", "Expected {path, base, text}.");
      const text = body.text.replace(/\r\n?/g, "\n");
      const r = await store.write(body.path, text, body.base);
      if (r.ok) return json(res, 200, { version: r.version, changed: r.changed });
      return json(res, 409, { error: "conflict", reason: r.reason, current: r.current ?? null });
    }
    if (url.pathname === "/api/ui-state" && req.method === "GET") return json(res, 200, await readUiState());
    if (url.pathname === "/api/ui-state" && req.method === "PUT") {
      const s = sanitizeUiState(await readBody(req));
      await writeUiState(s);
      return json(res, 200, s);
    }
    if (url.pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 500\n\nevent: hello\ndata: {}\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    return json(res, 404, { error: "not_found" });
  }

  async function serveStatic(_req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    return serveDist(opts.distDir, res, url);
  }

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      if (!security.hostOk(req.headers.host)) {
        res.writeHead(421, { "Content-Type": "text/plain" });
        return res.end("Misdirected request");
      }
      res.setHeader("Content-Security-Policy", CSP);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith("/api/")) {
        // The launcher opens /?launch=<token>; the token becomes the cookie and leaves the address bar at once.
        const launched = security.launch(url);
        if (launched === "bad") { res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("This launch link is not valid. Open Aitiarch from its launcher again."); }
        if (launched === "ok") { url.searchParams.delete("launch"); const q = url.searchParams.toString(); res.writeHead(303, { "Set-Cookie": security.cookie(), Location: url.pathname + (q ? "?" + q : ""), "Cache-Control": "no-store" }); return res.end(); }
      }
      if (url.pathname.startsWith("/api/")) await api(req, res, url);
      else await serveStatic(req, res, url);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof PathError) return json(res, e.status, { error: e.code, message: e.message });
      if (e instanceof ProviderError) return json(res, 400, { error: e.code, message: e.message });
      json(res, 500, { error: "internal" });
    }
  };
  const server = http.createServer(handle);

  watcher.on("event", (ev: WatchEvent) => {
    const frame = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const c of clients) c.write(frame);
  });
  const ka = setInterval(() => {
    for (const c of clients) c.write(": keepalive\n\n");
  }, 15000);
  ka.unref();

  return {
    server,
    token,
    /** The request handler, for a host that serves several projects from one port. */
    handle,
    listen(wanted: number): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(wanted, "127.0.0.1", () => {
          port = (server.address() as AddressInfo).port;
          server.off("error", reject);
          resolve(port);
        });
      });
    },
    async close(): Promise<void> {
      await (await chatReady).close();
      clearInterval(ka);
      for (const c of clients) c.end();
      server.closeAllConnections();
      (await councilReady)?.close();
      await new Promise<void>((r) => server.close(() => r()));
      await (await assistance).close();await (await runtimeReady).close();
    },
  };
}
