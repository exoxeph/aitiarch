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
import { investigateFrames } from "./chat/investigate-model.ts";
export interface InkSnapshot { document: InkDocument; version: string | null }

export type SaveResult =
  | { ok: true; version: string; changed: boolean }
  | { ok: false; reason: "conflict" | "missing"; current: NoteFile | null }
  | { ok: false; reason: "network"; message: string };

export class ApiError extends Error {
  status: number;
  code: string;
  /** The rest of the server's error body (for a budget refusal: the numbers). */
  detail: any;
  constructor(status: number, code: string, message: string, detail?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function call(method: "GET" | "PUT" | "POST", url: string, body?: unknown, keepalive = false): Promise<{ status: number; data: any }> {
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

async function ok<T>(method: "GET" | "PUT" | "POST", url: string, body?: unknown): Promise<T> {
  const { status, data } = await call(method, url, body);
  if (status >= 200 && status < 300) return data as T;
  throw new ApiError(status, data?.error ?? "error", data?.message ?? `Request failed (${status})`, data);
}

/** What GET /api/chat returns: accepted assistant messages only (questions are not stored), plus where the chat is kept. */
export interface ChatSnapshot { v: 1; note: string; messages: ChatMessage[]; persistence: { enabled: boolean }; questionPlaceholder: string; usage: ChatUsage | null }
/** PUT /api/chat/send as a server-sent-event stream. Rejects with ApiError when the server refuses before streaming starts. */
export async function streamChat(body: { reviewId: string; confirmed?: boolean; dontAskAgain?: boolean }, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(scoped("/api/chat/send"), { method: "PUT", credentials: "same-origin", signal, headers: { "Content-Type": "application/json", "X-Aitiarch": "1" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    let data: any = null;
    try { data = await res.json(); } catch { /* empty body */ }
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? `Request failed (${res.status})`, data);
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

/** One investigation turn as server-sent events. Unknown event types are passed on (the trail counts them); broken frames are dropped. */
export async function streamInvestigate(body: { session: string; question: string }, onEvent: (e: { type: string }) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(scoped("/api/harness/investigate/send"), { method: "PUT", credentials: "same-origin", signal, headers: { "Content-Type": "application/json", "X-Aitiarch": "1" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    let data: any = null;
    try { data = await res.json(); } catch { /* empty body */ }
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? `Request failed (${res.status})`, data);
  }
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > 2_000_000) throw new ApiError(0, "budget", "The investigation sent too much at once and was stopped.");
    const parsed = investigateFrames(buffer); buffer = parsed.rest;
    for (const e of parsed.events) onEvent(e);
  }
}

/** What every conversation call sends: the conversation, the note it is kept under, and the attachments. Never a profile or a cap: the server derives those. */
export interface ConversationBody { conversationId: string; path: string; /** The note open now: the server derives the diagrams of a turn from it, and checks it is a note of this project. */ openNote?: string; attachments: import("../shared/profile.ts").Attachments }
/** PUT /api/conversation/turn as server-sent events, in either shape (chat or Investigate): the `start` event's `profile` says which. Unknown types are passed on. */
export async function streamConversation(body: ConversationBody & { id: string; text: string; context?: unknown; selection?: string; editor?: unknown }, onEvent: (e: { type: string; [k: string]: unknown }) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(scoped("/api/conversation/turn"), { method: "PUT", credentials: "same-origin", signal, headers: { "Content-Type": "application/json", "X-Aitiarch": "1" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    let data: any = null;
    try { data = await res.json(); } catch { /* empty body */ }
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? `Request failed (${res.status})`, data);
  }
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > 2_000_000) throw new ApiError(0, "budget", "The turn sent too much at once and was stopped.");
    const parsed = investigateFrames(buffer); buffer = parsed.rest;
    for (const e of parsed.events) onEvent(e as { type: string });
  }
  for (const e of investigateFrames(buffer + decoder.decode() + "\n\n").events) onEvent(e as { type: string });
}

export const api = {
  councilAvailability:(refresh=false)=>ok<{providers:import('../server/providers/council-availability.ts').Availability[]}>('GET','/api/council/availability'+(refresh?'?refresh=1':'')),
  councilHistory:(id:string)=>ok<import('../server/council-history.ts').CouncilRecord>('GET','/api/council/history?conversation='+encodeURIComponent(id)),
  councilPlan:(body:unknown)=>ok<Awaited<ReturnType<import('../server/council.ts').CouncilService['plan']>>>('PUT','/api/council/plan',body),
  councilApprove:(body:unknown)=>ok<unknown>('PUT','/api/council/plan',{...body as object,approve:true}),
  councilRun:async(body:unknown,signal:AbortSignal)=>{const res=await fetch(scoped('/api/council/run'),{method:'POST',credentials:'same-origin',signal,headers:{'Content-Type':'application/json','X-Aitiarch':'1'},body:JSON.stringify(body)});const d=await res.json();if(!res.ok)throw new ApiError(res.status,d.error,d.message);return d as Awaited<ReturnType<import('../server/council.ts').CouncilService['run']>>;},
  /** The one conversation API: "@" picker matches, the plan card for given attachments, and approving exactly that card. */
  /** What a conversation was approved for, as the server would honour it now; null when nothing (or a grant it would refuse). For the chips only: the server decides every turn. */
  conversationGrant:(id:string)=>ok<{grant:{profile:import('../shared/profile.ts').Profile;files:string[];repo:boolean;diagrams:boolean;diagramNote?:string;budgetUsd:number}|null}>('GET','/api/conversation/grant?id='+encodeURIComponent(id)),
  conversationFiles:(q:string)=>ok<{files:string[];notes:string[]}>('GET',`/api/conversation/files?q=${encodeURIComponent(q)}`),
  conversationPlan:(body:ConversationBody&{budgetUsd?:number})=>ok<import('../server/harness/conversation.ts').ConversationPlan>('PUT','/api/conversation/plan',body),
  conversationApprove:(body:ConversationBody&{budgetUsd?:number;hash:string})=>ok<{grant:unknown}>('PUT','/api/conversation/approve',body),
  /** A note's chat. With `session`, the same record but with that conversation's counters in `usage` (a conversation has its own budget). */
  chat:(path:string,session?:string)=>ok<ChatSnapshot>('GET',`/api/chat?path=${encodeURIComponent(path)}${session?'&session='+encodeURIComponent(session):''}`),
  chatCall:<T,>(action:string,body:unknown)=>ok<T>('PUT','/api/chat/'+action,body),
  /** Harness chat sessions for a note: whether they are on (the Claude Code CLI is configured) and the list, most recent first. */
  harnessSessions:(path:string,mode:'chat'|'investigate'='chat',all=false)=>ok<{enabled:boolean;sessions:import('../shared/harness.ts').HarnessSession[]}>('GET',`/api/harness/sessions?path=${encodeURIComponent(path)}&mode=${mode}${all?'&all=1':''}`),
  /** A named conversation by its id: its saved replies in order, its questions by message id, its counters. Whichever note is open. */
  harnessHistory:(id:string)=>ok<{session:import('../shared/harness.ts').HarnessSession;messages:import('../shared/chat.ts').ChatMessage[];questions:Record<string,string>;persistence:{enabled:boolean};usage:import('../shared/chat.ts').ChatUsage|null}>('GET',`/api/harness/sessions/history?id=${encodeURIComponent(id)}`),
  /** Investigations: the project's repo folder, a session's stored turns and plan status, the plan card actions, and a redacted file excerpt. */
  investigateRepo:()=>ok<{repo:string|null}>('GET','/api/harness/investigate/repo'),
  investigateChooseRepo:(repo:string)=>ok<{repo:string}>('PUT','/api/harness/investigate/repo',{repo}),
  investigateTurns:(session:string)=>ok<{turns:import('../server/harness/investigate.ts').InvestigateTurn[]}>('GET',`/api/harness/investigate/turns?session=${encodeURIComponent(session)}`),
  investigateStatus:(session:string)=>ok<{needsPlan:boolean}>('GET',`/api/harness/investigate/status?session=${encodeURIComponent(session)}`),
  investigateCall:<T,>(action:'plan'|'confirm'|'cancel'|'restore',body:unknown)=>ok<T>('PUT','/api/harness/investigate/'+action,body),
  investigateExcerpt:(session:string,path:string,line:number)=>ok<{path:string;line:number;from:number;lines:string[]}>('GET',`/api/harness/investigate/excerpt?session=${encodeURIComponent(session)}&path=${encodeURIComponent(path)}&line=${line}`),
  harnessSessionCall:(action:'new'|'rename',body:unknown)=>ok<import('../shared/harness.ts').HarnessSession>('PUT','/api/harness/sessions/'+action,body),
  /** Questions asked in this note's named conversations, by message id. */
  harnessQuestions:(path:string)=>ok<{questions:Record<string,string>}>('GET',`/api/harness/questions?path=${encodeURIComponent(path)}`),
  /** The pictures of diagrams (names like `diagram-<hash>.png`) that exist, with their size; and saving one the page made (base64 PNG), which the server checks again. */
  diagramImages:(names:string[])=>ok<{images:{name:string;width:number;height:number;bytes:number}[]}>('GET',`/api/diagram-images?names=${names.map(encodeURIComponent).join(',')}`),
  saveDiagramImage:(name:string,data:string)=>ok<{name:string;width:number;height:number;bytes:number}>('PUT','/api/diagram-image',{name,data}),
  /** What deleting a conversation would remove from the chat of the note it was started on: that note, and how many saved replies. */
  harnessSessionReplies:(id:string)=>ok<{note:string|null;replies:number}>('GET',`/api/harness/sessions/replies?id=${encodeURIComponent(id)}`),
  /** Deletes a conversation: the app's entry and Claude Code's own transcript of it. */
  harnessSessionDelete:(id:string)=>ok<{removed:string[]}>('PUT','/api/harness/sessions/delete',{id}),
  chatSessions:(path:string,otherProjects=false)=>ok<{id:import('../shared/chat.ts').ContextChoice['moduleId'];label:string;entries:import('../shared/chat.ts').ContextEntry[];notice?:string}[]>('GET',`/api/chat/modules?path=${encodeURIComponent(path)}&sessions=1&otherProjects=${otherProjects?'1':'0'}`),
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
