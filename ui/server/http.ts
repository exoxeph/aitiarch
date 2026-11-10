import {validNeverCorrect} from '../shared/typing-preferences.ts';
import {InvestigatorError,type InvestigatorRunner,type AgentName} from '../shared/investigator.ts';
import {InvestigatorRuntime} from './investigator/runtime.ts';import {PolicyGate} from './investigator/policy.ts';import {Lookups} from './investigator/lookups.ts';import {LedgerStore} from './ledger-store.ts';
import {ChatRuntime,ChatError} from './chat/runtime.ts';
import {CHAT_MESSAGES} from '../shared/chat.ts';
import {ChatStore} from './chat/store.ts';import {ChatInsertion} from './chat/insertion.ts';
import {InsertionStore} from './insertion-store.ts';
import { UiStateStore } from './ui-state-store.ts';
import {ThreadStore} from './thread-store.ts';
import {ThreadRuntime,type ThreadRequest} from './thread-runtime.ts';
import {validId} from '../shared/threads.ts';
// Local HTTP server: JSON API + SSE + static UI. Loopback only, with Host/Origin checks, a per-launch
// cookie token, and a strict Content-Security-Policy, because this process can write to your notes.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { normalizeRel, isNotePath, PathError } from "./paths.ts";
import type { Store } from "./store.ts";
import { InkStore } from "./ink-store.ts";
import type { NoteWatcher, WatchEvent } from "./watch.ts";
import { Assistance } from "./assistance.ts";
import { ProviderError, type Provider } from "./providers/index.ts";
import type { Invocation } from "../shared/invocation.ts";
import type { ChatGPTPlan } from "./providers/chatgpt-plan.ts";

export interface AppOptions {
  sessionModules?:import('../shared/chat.ts').ContextModule[];
  store: Store;
  watcher: NoteWatcher;
  distDir: string;
  allowOrigins?: string[];
  provider?: Provider;
  investigator?:Partial<Record<AgentName,InvestigatorRunner>>;
  plan?: ChatGPTPlan;
  usage?: {summary():Promise<import('../shared/usage.ts').UsageSummary>};
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
  const token = randomBytes(24).toString("hex");
  const clients = new Set<http.ServerResponse>();
  const assistance = inkReady.then(ink => new Assistance(store, ink, opts.provider ?? {
    checkAvailability: async () => ({ available: false, code: "unsupported_cli", message: "Claude is not configured. Start with --claude and an absolute executable path. Codex is disabled." }),
    invoke: async () => { throw new ProviderError("unsupported_cli"); },
  }, path => { for (const c of clients) c.write(`event: ink\ndata: ${JSON.stringify({ type: "ink", path })}\n\n`); }));
  let port = 0;
  const extraOrigins = new Set((opts.allowOrigins ?? []).map((o) => o.toLowerCase()));

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extraOrigins]);

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(data);
  };

  const readBody = (req: http.IncomingMessage): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let n = 0;
      req.on("data", (c: Buffer) => {
        n += c.length;
        if (n > MAX_BODY) {
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

  const cookieToken = (req: http.IncomingMessage): string => {
    const m = /(?:^|;\s*)aitiarch=([0-9a-f]+)/.exec(req.headers.cookie ?? "");
    return m ? m[1] : "";
  };
  const tokenOk = (req: http.IncomingMessage): boolean => {
    const a = Buffer.from(cookieToken(req));
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const uiStateStore = new UiStateStore(store.rootReal);
  const investigatorPolicy=new PolicyGate(uiStateStore,path.dirname(store.rootReal));
  const investigator=new InvestigatorRuntime(investigatorPolicy,new Lookups(investigatorPolicy),new LedgerStore(store.rootReal),opts.investigator??{},undefined,store.rootReal);
  const insertionsReady=Promise.all([inkReady,assistance]).then(([ink,service])=>new InsertionStore(ink,store,service.ledger));
  const chatStore=new ChatStore(store.rootReal);
  const chatReady=inkReady.then(ink=>new ChatRuntime(store,ink,chatStore,opts.provider,opts.sessionModules));
  const chatInsertion=insertionsReady.then(insertions=>new ChatInsertion(store,chatStore,insertions));
  const threadsReady=inkReady.then(async ink=>new ThreadStore(ink,uiStateStore,(await assistance).ledger));
  const runtimeReady=threadsReady.then(threads=>new ThreadRuntime(store,threads,opts.provider??{
    name:'claude',checkAvailability:async()=>({available:false,code:'unsupported_cli',message:'Provider disabled. Enable it explicitly at server startup.'}),invoke:async()=>{throw new ProviderError('unsupported_cli');}
  },path=>{for(const c of clients)c.write(`event: ink\ndata: ${JSON.stringify({type:'ink',path})}\n\n`);}));
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
    if (origin && !allowedOrigins().has(origin)) return json(res, 403, { error: "forbidden_origin" });
    if (typeof site === "string" && site !== "same-origin" && site !== "none") return json(res, 403, { error: "forbidden_site" });

    if (url.pathname === "/api/session" && req.method === "GET") {
      res.setHeader("Set-Cookie", `aitiarch=${token}; Path=/; HttpOnly; SameSite=Strict`);
      return json(res, 200, { rootName: path.basename(path.dirname(store.rootReal)) || path.basename(store.rootReal), rootPath: store.rootReal, anchorCache: await (await inkReady).cache.status() });
    }
    if (!tokenOk(req)) return json(res, 401, { error: "no_session" });

    const mutating = req.method !== "GET" && req.method !== "HEAD";
    if (mutating) {
      if (req.headers["x-aitiarch"] !== "1" || !/^application\/json/i.test(req.headers["content-type"] ?? "") || !origin) {
        return json(res, 403, { error: "bad_request_headers" });
      }
    }

    if (url.pathname === "/api/tree" && req.method === "GET") return json(res, 200, await store.tree());
    if(url.pathname==='/api/investigator'&&req.method==='GET')return json(res,200,{...await investigatorPolicy.status(),claudeConfigured:!!opts.investigator?.claude,codex:'Blocked: cannot verify root confinement or pattern denial.'});
    if(url.pathname.startsWith('/api/investigator/')&&req.method==='PUT'){
      const b=await readBody(req) as any;
      try{
        if(url.pathname==='/api/investigator/configure'){
          if(b.enabled===true&&b.action!=='enable-investigator')throw new InvestigatorError('invalid_policy');const {action,...patch}=b;const status=await investigatorPolicy.configure(patch);if(b.enabled===false)investigator.stopAll();return json(res,200,status);
        }
        if(url.pathname==='/api/investigator/grant'){await investigatorPolicy.grant(b.chat,b.tier,b.duration);return json(res,200,{});}
        if(url.pathname==='/api/investigator/enable-persistence'){if(b.action!=='add-ignore-line')throw new InvestigatorError('invalid_policy');return json(res,200,await uiStateStore.enableDrafts());}
        if(url.pathname==='/api/investigator/cancel'){investigator.cancel(b.chat,b.id);return json(res,200,{});}
        if(url.pathname==='/api/investigator/stop'){investigator.stopAll();return json(res,200,{});}
        if(url.pathname==='/api/investigator/answer'){
          const controller=new AbortController(),abort=()=>controller.abort();res.on('close',abort);let bytes=0;
          try{await investigator.answer(b,event=>{
            if(res.destroyed)throw new InvestigatorError('cancelled');const frame=`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;bytes+=Buffer.byteLength(frame);if(bytes>1000000||res.writableLength>262144)throw new InvestigatorError('budget');
            if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store'});res.write(frame);
          },controller.signal);res.end();}finally{res.off('close',abort);}return;
        }
        throw new InvestigatorError('invalid_envelope');
      }catch(e){if(res.headersSent)return res.end();const code=e instanceof InvestigatorError?e.code:'invalid_policy';return json(res,409,{error:code,message:code==='blocked'?'Blocked: raise policy to retry':'Investigator: '+code+'. Nothing was retried.'});}
    }
    if(url.pathname==='/api/usage'&&req.method==='GET'){
      const chats=(await chatReady).usage();return json(res,200,{...(opts.usage?await opts.usage.summary():{since:new Date().toISOString(),hourlyCap:2,providers:[]}),...(chats.length?{chats}:{})});
    }
    if(url.pathname==='/api/chat'&&req.method==='GET'){
      const note=url.searchParams.get('path')??'';await store.read(note);
      const saved=await chatStore.read(note),runtime=await chatReady;
      return json(res,200,{...saved,messages:[...saved.messages,...runtime.memoryMessages(note)],persistence:await chatStore.status(),questionPlaceholder:'Question unavailable after reload.',usage:runtime.usage().find(c=>c.note===note)??null});
    }
    if(url.pathname==='/api/chat/modules'&&req.method==='GET')return json(res,200,await (await chatReady).modules(url.searchParams.get('path')??'',url.searchParams.get('sessions')==='1',url.searchParams.get('otherProjects')==='1'));
    if(url.pathname.startsWith('/api/chat/')&&req.method==='PUT'){
      const b=await readBody(req) as any,runtime=await chatReady;
      try{
        if(url.pathname==='/api/chat/review')return json(res,200,await runtime.review(b));
        if(url.pathname==='/api/chat/session-preview')return json(res,200,await runtime.sessionPreview(b.path,b.context));
        if(url.pathname==='/api/chat/settings')return json(res,200,await runtime.settings(b.path,b));
        if(url.pathname==='/api/chat/cancel'){runtime.cancel(b.path);return json(res,200,{});}
        if(url.pathname==='/api/chat/enable'){
          if(b.action!=='add-ignore-line')throw new ChatError('invalid_chat');return json(res,200,await chatStore.enablePersistence());
        }
        if(url.pathname==='/api/chat/bring-preview')return json(res,200,await (await chatInsertion).preview(b));
        if(url.pathname==='/api/chat/bring-prepare')return json(res,200,await (await chatInsertion).prepare(b));
        if(url.pathname==='/api/chat/bring-complete')return json(res,200,await (await chatInsertion).complete(b.path,b.operationId));
        if(url.pathname==='/api/chat/bring-cancel')return json(res,200,await (await chatInsertion).cancel(b.path,b.operationId));
        if(url.pathname==='/api/chat/send'){
          const controller=new AbortController(),abort=()=>controller.abort();res.on('close',abort);
          let emitted=0;
          try{await runtime.send(b,event=>{
            if(res.destroyed)throw new ChatError('cancelled');
            if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
            const frame=`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
            emitted+=Buffer.byteLength(frame);if(emitted>512000)throw new ChatError('cancelled');
            res.write(frame);if(res.writableLength>262144)throw new ChatError('cancelled');
          },controller.signal);res.end();}finally{res.off('close',abort);}return;
        }
      }catch(e){
        if(res.headersSent)return res.end();
        const code=e instanceof ChatError?e.code:e instanceof ProviderError?'provider_failed':'invalid_chat';
        return json(res,409,{error:code,message:CHAT_MESSAGES[code]});
      }
      throw new PathError(400,'bad_body','Unknown chat action.');
    }

    if(url.pathname==='/api/insertions'&&req.method==='GET')return json(res,200,await (await insertionsReady).reconcile(url.searchParams.get('path')??''));
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
        const input = { id: b.id, path: b.path, action: b.action, question: b.question, text: b.text, from: b.from, to: b.to } as Invocation;
        if (url.pathname.endsWith("preview")) return json(res, 200, service.preview(input));
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
    const dist = path.resolve(opts.distDir);
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

  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? "").toLowerCase();
      if (!allowedHosts().has(host) && !extraOrigins.has(`http://${host}`)) {
        res.writeHead(421, { "Content-Type": "text/plain" });
        return res.end("Misdirected request");
      }
      res.setHeader("Content-Security-Policy", CSP);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) await api(req, res, url);
      else await serveStatic(req, res, url);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof PathError) return json(res, e.status, { error: e.code, message: e.message });
      if (e instanceof ProviderError) return json(res, 400, { error: e.code, message: e.message });
      json(res, 500, { error: "internal" });
    }
  });

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
      await investigator.close();
      await (await chatReady).close();
      clearInterval(ka);
      for (const c of clients) c.end();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await (await assistance).close();await (await runtimeReady).close();
    },
  };
}
