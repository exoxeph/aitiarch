// Thin client for the local Aitiarch server. All state lives in files on disk; nothing here is cached
// beyond the current page.
export type EolLabel = "LF" | "CRLF" | "CR" | "mixed" | "none";

export interface NoteFile {
  path: string;
  text: string;
  version: string;
  eol: EolLabel;
  bom: boolean;
  size: number;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
}

export interface UiState {
  v: 1;
  tabs: string[];
  active: string | null;
  treeCollapsed?: boolean;
  typingHelp?:boolean;
  doubleSpacePeriod?:boolean;smartCorrections?:boolean;neverCorrect?:string[];
  theme?: 'ember' | 'moss';
  confirmAdd?: boolean;
}
import { scoped } from "./project-base.ts";
import type { ProjectEntry } from "../server/registry.ts";
import type { FolderListing } from "../server/folders.ts";
import type { InitPlan } from "../server/project-init.ts";
import type { ProjectSummary } from "../server/project-summary.ts";
import type { MovePlan } from "../server/explorer.ts";
import type { Backlink, NoteSummary } from "../server/citations.ts";
export type { ProjectEntry, FolderListing, InitPlan, ProjectSummary, MovePlan, Backlink, NoteSummary };
import type { InkDocument, InkItem } from "../shared/ink.ts";
import type { Invocation } from "../shared/invocation.ts";
import type { ChatEvent, ChatMessage, ChatUsage } from "../shared/chat.ts";
import { sseFrames } from "./chat/chat-model.ts";
import type { InvestigatorEvent } from "../shared/investigator.ts";
import { investigatorFrames } from "./chat/trail-model.ts";
export interface InkSnapshot { document: InkDocument; version: string | null }

export type SaveResult =
  | { ok: true; version: string; changed: boolean }
  | { ok: false; reason: "conflict" | "missing"; current: NoteFile | null }
  | { ok: false; reason: "network"; message: string };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(method: "GET" | "PUT", url: string, body?: unknown, keepalive = false): Promise<{ status: number; data: any }> {
  const res = await fetch(scoped(url), {
    method,
    credentials: "same-origin",
    keepalive,
    headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-Aitiarch": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, data };
}

async function ok<T>(method: "GET" | "PUT", url: string, body?: unknown): Promise<T> {
  const { status, data } = await call(method, url, body);
  if (status >= 200 && status < 300) return data as T;
  throw new ApiError(status, data?.error ?? "error", data?.message ?? `Request failed (${status})`);
}

/** What GET /api/chat returns: accepted assistant messages only (questions are not stored), plus where the chat is kept. */
export interface ChatSnapshot { v: 1; note: string; messages: ChatMessage[]; persistence: { enabled: boolean }; questionPlaceholder: string; usage: ChatUsage | null }
/** PUT /api/chat/send as a server-sent-event stream. Rejects with ApiError when the server refuses before streaming starts. */
export async function streamChat(body: { reviewId: string; confirmed?: boolean; dontAskAgain?: boolean }, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(scoped("/api/chat/send"), { method: "PUT", credentials: "same-origin", signal, headers: { "Content-Type": "application/json", "X-Aitiarch": "1" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    let data: any = null;
    try { data = await res.json(); } catch { /* empty body */ }
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = sseFrames(buffer); buffer = parsed.rest;
    for (const e of parsed.events) onEvent(e);
  }
  for (const e of sseFrames(buffer + decoder.decode() + "\n\n").events) onEvent(e);
}

/** PUT /api/investigator/answer as a server-sent-event stream of M4 investigator events. Rejects with ApiError when refused before streaming. */
export async function streamInvestigator(body: { chat: string; id: string; note: string; question: string }, onEvent: (e: InvestigatorEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(scoped("/api/investigator/answer"), { method: "PUT", credentials: "same-origin", signal, headers: { "Content-Type": "application/json", "X-Aitiarch": "1" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    let data: any = null;
    try { data = await res.json(); } catch { /* empty body */ }
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > 1_000_000) throw new ApiError(0, "budget", "The investigation sent too much at once and was stopped.");
    const parsed = investigatorFrames(buffer); buffer = parsed.rest;
    for (const e of parsed.events) onEvent(e);
  }
  for (const e of investigatorFrames(buffer + decoder.decode() + "\n\n").events) onEvent(e);
}

export const api = {
  chat:(path:string)=>ok<ChatSnapshot>('GET',`/api/chat?path=${encodeURIComponent(path)}`),
  chatCall:<T,>(action:string,body:unknown)=>ok<T>('PUT','/api/chat/'+action,body),
  chatSessions:(path:string,otherProjects=false)=>ok<{id:import('../shared/chat.ts').ContextChoice['moduleId'];label:string;entries:import('../shared/chat.ts').ContextEntry[];notice?:string}[]>('GET',`/api/chat/modules?path=${encodeURIComponent(path)}&sessions=1&otherProjects=${otherProjects?'1':'0'}`),
  investigator:()=>ok<any>('GET','/api/investigator'),
  investigatorCall:<T,>(action:string,body:unknown)=>ok<T>('PUT','/api/investigator/'+action,body),
  usage:()=>ok<import('../shared/usage.ts').UsageSummary>('GET','/api/usage'),
  /** The Skill library never sends a flat list: skills come only from a search (q) or from ids you already hold. */
  skills:(q:string,ids:string[]=[])=>ok<import('../server/skill-library.ts').SkillLibraryReply>('GET','/api/skills'+(q||ids.length?'?'+new URLSearchParams({...(q?{q}:{}),...(ids.length?{ids:ids.join(',')}:{})}).toString():'')),
  nodes:()=>ok<{nodes:import('../shared/node-settings.ts').NodeSettings}>('GET','/api/nodes'),
  saveNodes:(nodes:import('../shared/node-settings.ts').SavedNodeSettings)=>ok<{nodes:import('../shared/node-settings.ts').NodeSettings;persisted:boolean}>('PUT','/api/nodes',nodes),
  insertionStatus:(path:string)=>ok<import('../server/insertion-store.ts').RepairStatus>('GET',`/api/insertions?path=${encodeURIComponent(path)}`),
  threads:(path:string)=>ok<InkSnapshot>('GET',`/api/threads?path=${encodeURIComponent(path)}`),
  threadAction:(path:string,id:string,version:string|null,action:unknown)=>ok<InkSnapshot>('PUT','/api/threads/action',{path,id,version,action}),
  threadCall:<T,>(action:string,body:unknown)=>ok<T>('PUT','/api/threads/'+action,body),
  threadDraft:(path:string,id:string)=>ok<{enabled:boolean;ignoreLine:string;ignoreFile:string;draft:{text:string;revision:string}|null}>('GET',`/api/thread-drafts?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`),
  saveThreadDraft:(path:string,id:string,text:string,revision:string|null)=>ok<{revision:string}>('PUT','/api/thread-drafts/save',{path,id,text,revision}),
  enableThreadDrafts:()=>ok<{enabled:boolean}>('PUT','/api/thread-drafts/enable',{action:'add-ignore-line'}),
  uiStatePersistence:()=>ok<{enabled:boolean}>('GET','/api/thread-drafts/status'),
  assistance: () => ok<{ available: boolean; provider?: string; message?: string; warnings?: string[] }>("GET", "/api/assistance"),
  planStatus:()=>ok<{enabled:boolean;connected?:boolean;model?:string|null;hourlyCap?:number;welcome?:boolean}>('GET','/api/chatgpt-plan'),
  planAction:<T,>(action:string,body:unknown={})=>ok<T>('PUT','/api/chatgpt-plan/'+action,body),
  previewInvocation: (body: Invocation) => ok<unknown>("PUT", "/api/assistance/preview", body),
  invoke: (body: Invocation) => ok<InkSnapshot>("PUT", "/api/assistance/invoke", body),
  requestStatus: (id: string) => ok<{ status: string }>("GET", `/api/assistance/status?id=${encodeURIComponent(id)}`),
  cancelRequest: (id: string) => ok<unknown>("PUT", "/api/assistance/cancel", { id }),
  retryInkSave: (id: string) => ok<unknown>("PUT", "/api/assistance/retry-save", { id }),
  inkEvent: (path: string, id: string, event: "shown" | "dismissed") => ok<unknown>("PUT", "/api/assistance/event", { path, id, event }),
  enableAnchorCache: () => ok<{ enabled: boolean }>("PUT", "/api/anchor-cache/enable", { action: "add-ignore-line" }),
  session: () => ok<{ rootName: string; rootPath: string; anchorCache: { enabled: boolean; ignoreFile: string; ignoreLine: string } }>("GET", "/api/session"),
  tree: () => ok<TreeNode>("GET", "/api/tree"),
  citations: () => ok<NoteSummary[]>("GET", "/api/citations"),
  // The Constellation: graph data with remembered star positions, the handoff order, and its explicit write.
  graph: () => ok<{ data: import("../shared/graph.ts").GraphData; positions: Record<string, [number, number]> }>("GET", "/api/graph"),
  handoff: () => ok<{ order: string[]; markdown: string }>("GET", "/api/handoff"),
  writeHandoff: () => ok<{ written: true; path: string; order: string[] }>("PUT", "/api/handoff/write", {}),
  saveStarPositions: (positions: Record<string, [number, number]>) => ok<{ positions: Record<string, [number, number]> }>("PUT", "/api/constellation/positions", { positions }),
  backlinks: (path: string) => ok<Backlink[]>("GET", `/api/backlinks?path=${encodeURIComponent(path)}`),
  // The projects home: the registry, the folder browser, Initialize, and the per-card summary. All unprefixed host routes.
  projects: (sort: "recent" | "name" = "recent") => ok<{ projects: ProjectEntry[]; home: string }>("GET", `/api/projects?sort=${sort}`),
  folders: (path?: string) => ok<FolderListing>("GET", `/api/projects/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  initPreview: (path: string) => ok<InitPlan>("GET", `/api/projects/preview?path=${encodeURIComponent(path)}`),
  projectSummary: (id: string) => ok<ProjectSummary>("GET", `/api/projects/summary?id=${id}`),
  addProject: (path: string) => ok<ProjectEntry>("PUT", "/api/projects/add", { path }),
  initProject: (path: string) => ok<ProjectEntry>("PUT", "/api/projects/init", { path }),
  openProject: (id: string) => ok<ProjectEntry>("PUT", "/api/projects/open", { id }),
  pinProject: (id: string, pinned: boolean) => ok<ProjectEntry>("PUT", "/api/projects/pin", { id, pinned }),
  removeProject: (id: string) => ok<unknown>("PUT", "/api/projects/remove", { id }),
  // The explorer inside one project.
  newNote: (path: string) => ok<{ path: string }>("PUT", "/api/explorer/new-note", { path }),
  newFolder: (path: string) => ok<{ path: string }>("PUT", "/api/explorer/new-folder", { path }),
  movePreview: (from: string, to: string) => ok<MovePlan>("PUT", "/api/explorer/move-preview", { from, to }),
  move: (from: string, to: string) => ok<MovePlan>("PUT", "/api/explorer/move", { from, to }),
  file: (path: string) => ok<NoteFile>("GET", `/api/file?path=${encodeURIComponent(path)}`),
  ink: (path: string, resolve = false) => ok<InkSnapshot>("GET", `/api/ink?path=${encodeURIComponent(path)}${resolve ? "&resolve=1" : ""}`),
  checkpointInk: (body: { path: string; inkVersion: string | null; noteVersion: string; items: Pick<InkItem, "id" | "anchor" | "attachment">[] }) => ok<InkSnapshot>("PUT", "/api/ink/checkpoint", body),
  attachInk: (body: { path: string; id: string; inkVersion: string | null; noteVersion: string; from: number; to: number }) =>
    ok<InkSnapshot>("PUT", "/api/ink/attach", body),
  /** Like file() but resolves null when the note no longer exists. */
  async load(path: string): Promise<NoteFile | null> {
    try {
      return await api.file(path);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  uiState: () => ok<UiState>("GET", "/api/ui-state"),
  putUiState: (s: UiState) => ok<UiState>("PUT", "/api/ui-state", s),
  async save(path: string, base: string, text: string, keepalive = false): Promise<SaveResult> {
    try {
      const { status, data } = await call("PUT", "/api/file", { path, base, text }, keepalive);
      if (status === 200) return { ok: true, version: data.version, changed: data.changed };
      if (status === 409) return { ok: false, reason: data.reason === "missing" ? "missing" : "conflict", current: data.current ?? null };
      return { ok: false, reason: "network", message: data?.message ?? `Server returned ${status}` };
    } catch (e) {
      return { ok: false, reason: "network", message: String(e) };
    }
  },
};

export type ServerEvent =
  | { type: "changed"; path: string; version: string }
  | { type: "removed"; path: string }
  | { type: "tree" }
  | { type: "ink"; path: string }
  | { type: "open" }
  | { type: "closed" };

/** Subscribe to server-sent events. EventSource reconnects by itself; 'open' fires on every (re)connect so callers can resync. */
export function connectEvents(onEvent: (e: ServerEvent) => void): () => void {
  const es = new EventSource(scoped("/api/events"));
  es.onopen = () => onEvent({ type: "open" });
  es.onerror = () => onEvent({ type: "closed" });
  for (const t of ["changed", "removed", "tree", "ink"] as const) {
    es.addEventListener(t, (m) => {
      try {
        onEvent(JSON.parse((m as MessageEvent).data));
      } catch {
        /* ignore malformed frame */
      }
    });
  }
  return () => es.close();
}
