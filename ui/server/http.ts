import {validNeverCorrect} from '../shared/typing-preferences.ts';
import {harnessDirectory,SessionIndex,SessionIndexError} from './harness/session-index.ts';import {ClaudeSessionRunner} from './harness/claude-session.ts';import {InvestigateError,InvestigateService} from './harness/investigate.ts';import {removeTranscript} from './harness/transcripts.ts';import {sweepStaleTurnFolders} from './harness/sweep.ts';import {QuestionStore} from './harness/questions.ts';
import {ChatRuntime,ChatError} from './chat/runtime.ts';
import {CHAT_MESSAGES,budgetText} from '../shared/chat.ts';
import {validSessionId} from '../shared/harness.ts';
import {ChatStore} from './chat/store.ts';import {ChatInsertion} from './chat/insertion.ts';
import {InsertionStore} from './insertion-store.ts';
import {SKILL_DIAGRAM_CSP_HEADER,SKILL_DIAGRAM_SVG_CSP_HEADER} from '../shared/skill-diagram.ts';
import { UiStateStore } from './ui-state-store.ts';
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

export interface AppOptions {
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
  const chatStore=new ChatStore(store.rootReal);
  const harnessReady=opts.harness?SessionIndex.open(opts.harness.dir??harnessDirectory(store.rootReal)).then(async index=>{const h=opts.harness!;await sweepStaleTurnFolders(index.dir).catch(()=>{}); /* a turn that was cut off leaves its notes in a turn-* folder: clear the old ones when the project opens */return {index,
    runner:new ClaudeSessionRunner({command:h.command,prefixArgs:h.prefixArgs,model:h.model,dir:index.dir}),questions:new QuestionStore(index.dir),
    investigate:new InvestigateService({index,dir:index.dir,notebook:store.rootReal,command:h.command,prefixArgs:h.prefixArgs,model:h.model})};}):Promise.resolve(null);
  const chatReady=Promise.all([inkReady,harnessReady]).then(([ink,harness])=>new ChatRuntime(store,ink,chatStore,opts.provider,opts.sessionModules,node=>nodeSettings.extras(node),harness??undefined));
  const chatInsertion=insertionsReady.then(insertions=>new ChatInsertion(store,chatStore,insertions));
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
      return json(res, 200, { rootName: path.basename(path.dirname(store.rootReal)) || path.basename(store.rootReal), rootPath: store.rootReal, anchorCache: await (await inkReady).cache.status() });
    }
    if (!tokenOk(req)) return json(res, 401, { error: "no_session" });

    const mutating = req.method !== "GET" && req.method !== "HEAD";
    if (mutating) {
      if (req.headers["x-aitiarch"] !== "1" || !/^application\/json/i.test(req.headers["content-type"] ?? "") || !origin) {
        return json(res, 403, { error: "bad_request_headers" });
      }
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
      const chats=(await chatReady).usage(),h=await harnessReady,investigate=h?await h.investigate.usage():null;return json(res,200,{...(opts.usage?await opts.usage.summary():{since:new Date().toISOString(),hourlyCap:2,providers:[]}),...(chats.length?{chats}:{}),...(investigate&&investigate.turns>0?{investigate}:{})});
    }
    // Harness chat sessions: the app's own list for this project, a new one for a note, and a new label. Nothing here talks to the CLI.
    if(url.pathname==='/api/harness/sessions'&&req.method==='GET'){
      const h=await harnessReady,mode=url.searchParams.get('mode')==='investigate'?'investigate' as const:'chat' as const,note=mode==='chat'?url.searchParams.get('path')||undefined:undefined;if(note)await store.read(note);
      return json(res,200,{enabled:!!h,sessions:h?await h.index.list({mode,...(note?{note}:{})}):[]});
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
    if(url.pathname==='/api/harness/questions'&&req.method==='GET'){
      const h=await harnessReady,note=url.searchParams.get('path')??'';await store.read(note);
      const out:Record<string,string>={};if(h)for(const s of await h.index.list({mode:'chat',note}))Object.assign(out,await h.questions.read(s.id));
      return json(res,200,{questions:out});
    }
    if((url.pathname.startsWith('/api/harness/sessions/')||url.pathname.startsWith('/api/harness/investigate/'))&&req.method==='PUT'){
      const h=await harnessReady,b=await readBody(req) as any;
      if(!h)return json(res,409,{error:'disabled',message:'Sessions need the Claude Code CLI. Start Aitiarch with --claude.'});
      try{
        if(url.pathname==='/api/harness/sessions/new'){
          if(b?.mode==='investigate')return json(res,200,await h.investigate.create(b.label,b.repo));
          if(b?.mode!=='chat'||typeof b.path!=='string')throw new SessionIndexError('Invalid session.');await store.read(b.path);return json(res,200,await h.index.create({mode:'chat',label:b.label,note:b.path}));
        }
        if(url.pathname==='/api/harness/sessions/rename')return json(res,200,await h.index.rename(b?.id,b?.label));
        // Delete conversation: the CLI's transcript for this one id (under ~/.claude/projects/<its working folder>), then the app's own entry.
        if(url.pathname==='/api/harness/sessions/delete'){
          const s=await h.index.get(b?.id);if(!s)throw new SessionIndexError('No such session.');
          const cwd=s.mode==='chat'?await h.runner.chatCwd():await h.investigate.snapshotCwd(s.repo!);
          const removed=await removeTranscript(cwd,s.id,opts.harness?.home);
          // The replies this conversation saved in its note's chat record go with it (found by the id they carry, and by the ids of its kept questions for older ones).
          const replies=s.mode==='chat'&&s.note?await (await chatReady).forgetConversation(s.note,s.id,new Set(Object.keys(await h.questions.read(s.id)))):0;
          await h.questions.remove(s.id);await h.index.remove(s.id);if(s.mode==='investigate')await h.investigate.forget(s.id);
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
    if(url.pathname==='/api/chat'&&req.method==='GET'){
      const note=url.searchParams.get('path')??'',session=url.searchParams.get('session')??'';await store.read(note);
      if(session&&!validSessionId(session))return json(res,409,{error:'invalid_chat',message:CHAT_MESSAGES.invalid_chat});
      const saved=await chatStore.read(note),runtime=await chatReady;
      return json(res,200,{...saved,messages:[...saved.messages,...runtime.memoryMessages(note)],persistence:await chatStore.status(),questionPlaceholder:'Question unavailable after reload.',usage:runtime.usage().find(c=>c.note===note&&c.session===(session||undefined))??null});
    }
    if(url.pathname==='/api/chat/modules'&&req.method==='GET')return json(res,200,await (await chatReady).modules(url.searchParams.get('path')??'',url.searchParams.get('sessions')==='1',url.searchParams.get('otherProjects')==='1'));
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
        return json(res,409,{error:code,message:e instanceof ChatError&&e.budget?budgetText(e.budget):CHAT_MESSAGES[code],...(e instanceof ChatError&&e.budget?{budget:e.budget}:{})});
      }
      throw new PathError(400,'bad_body','Unknown chat action.');
    }

    if(url.pathname==='/api/insertions'&&req.method==='GET')return json(res,200,await (await insertionsReady).reconcile(url.searchParams.get('path')??''));
    // A skill's diagram: served only to be framed by this app, under a CSP that blocks all network (also injected in the document itself).
    if(url.pathname==='/api/skill-diagram'&&req.method==='GET'){
      try{const name=url.searchParams.get('name')??'',bytes=await (await assistance).skillDiagrams.read(name),svg=name.endsWith('.svg');res.writeHead(200,{'Content-Type':svg?'image/svg+xml':'text/html; charset=utf-8','Content-Security-Policy':svg?SKILL_DIAGRAM_SVG_CSP_HEADER:SKILL_DIAGRAM_CSP_HEADER,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'private, max-age=31536000, immutable'});return res.end(bytes);}catch{return json(res,404,{error:'not_found'});}
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
      await new Promise<void>((r) => server.close(() => r()));
      await (await assistance).close();await (await runtimeReady).close();
    },
  };
}
