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
  doubleSpacePeriod?:boolean;
  theme?: 'system' | 'light' | 'dark';
  confirmAdd?: boolean;
}
import type { InkDocument, InkItem } from "../shared/ink.ts";
import type { Invocation } from "../shared/invocation.ts";
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
  const res = await fetch(url, {
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

export const api = {
  usage:()=>ok<import('../shared/usage.ts').UsageSummary>('GET','/api/usage'),
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
  const es = new EventSource("/api/events");
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
