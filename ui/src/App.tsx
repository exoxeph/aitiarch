import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, connectEvents, type InkSnapshot, type NoteFile, type ServerEvent, type TreeNode } from "./api.ts";
import type { InkItem } from "../shared/ink.ts";
import { OrphanList } from "./ink/OrphanList.tsx";
import { EditorView } from "@codemirror/view";
import { flattenTree, Overlay, PropertiesPanel, StatusBar, Tabs, Tree, type OverlayItem } from "./components.tsx";
import { EditorPane, type PaneHandle } from "./editor/EditorPane.tsx";
import { indentLines, restoreFailed, setHeading, toggleCodeBlock, toggleInline, toggleList } from "./editor/format.ts";
import type { SyncStatus } from "./editor/session.ts";
import { makeWikiResolver } from "./frontmatter.ts";
import { ChatGPTSettings } from "./ChatGPTSettings.tsx";
import {ThreadPanel} from './threads/ThreadPanel.tsx';
import {previewTakeawayInsertion} from '../shared/takeaway-insertion.ts';

type Boot = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; rootName: string; rootPath: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [files, setFiles] = useState<Record<string, NoteFile>>({});
  const [inkFiles, setInkFiles] = useState<Record<string, InkSnapshot>>({});
  const [mappedInk, setMappedInk] = useState<Record<string, InkItem[]>>({});
  const onInk = useCallback((path: string, items: InkItem[]) => setMappedInk(m => ({ ...m, [path]: items })), []);
  const onInkSaved = useCallback((path: string, snapshot: InkSnapshot) => setInkFiles(m => ({ ...m, [path]: snapshot })), []);
  const [attachDraft, setAttachDraft] = useState<null | { path: string; id: string; from: number; to: number; noteVersion: string; noteText: string; inkVersion: string | null; quote: string; target: string }>(null);
  const [threadId,setThreadId]=useState<string|null>(null);
  const [insertPreview,setInsertPreview]=useState<null|{path:string;id:string;noteText:string;inkVersion:string|null;preview:ReturnType<typeof previewTakeawayInsertion>}>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, SyncStatus>>({});
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [online, setOnline] = useState(true);
  const [overlay, setOverlay] = useState<null | "palette" | "switcher">(null);
  const [showProps, setShowProps] = useState(true);
  const [rightTab, setRightTab] = useState<"details" | "activity">("details");
  const [notice, setNotice] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState<null | { file: string; line: string }>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const panes = useRef(new Map<string, PaneHandle>());
  const listeners = useRef(new Set<(e: ServerEvent) => void>());
  const loaded = useRef(false);
  useEffect(()=>{const open=(event:Event)=>{setThreadId((event as CustomEvent<{id:string}>).detail.id);setRightTab('activity');setShowProps(true);};window.addEventListener('open-thread',open);return()=>window.removeEventListener('open-thread',open);},[]);

  // Intersection, document visibility and the visible pane determine "shown".
  // Completion in an inactive tab alone must never produce a ledger event.
  useEffect(() => {
    if (boot.state !== "ready") return;
    const observed = new Set<Element>(), seen = new Set<string>();
    const show = (el: Element) => {
      if (document.visibilityState !== "visible" || !el.getClientRects().length) return;
      const id = (el as HTMLElement).dataset.inkId, path = el.closest<HTMLElement>("[data-note-path]")?.dataset.notePath;
      if (!id || !path) return;
      const key = `${path}:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      void api.inkEvent(path, id, "shown").catch(() => { seen.delete(key); setNotice("Could not record that this answer was shown. The answer is preserved."); });
    };
    const observer = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) show(e.target); });
    const scan = () => {
      document.querySelectorAll('[data-generated-complete="true"]').forEach(el => {
        if (!observed.has(el)) { observed.add(el); observer.observe(el); }
      });
    };
    const visible = () => {
      scan();
      for (const el of observed) {
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) show(el);
      }
    };
    const mutations = new MutationObserver(scan); mutations.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", visible); scan();
    return () => { observer.disconnect(); mutations.disconnect(); document.removeEventListener("visibilitychange", visible); };
  }, [boot.state]);

  const subscribe = useCallback((fn: (e: ServerEvent) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const refreshTree = useCallback(() => api.tree().then(setTree).catch(() => {}), []);
  const refreshInk = useCallback((path: string, resolve = false) => api.ink(path, resolve).then(s => setInkFiles(m => ({ ...m, [path]: s }))).catch(() => {
    setNotice(`Ink for ${path} could not be loaded. Its sidecar is preserved.`);
  }), []);
  const paths = useMemo(() => flattenTree(tree), [tree]);
  const resolver = useMemo(() => makeWikiResolver(paths), [paths]);

  const openNote = useCallback(async (path: string) => {
    setNotice(null);
    if (!files[path]) {
      try {
        const f = await api.file(path);
        setFiles((m) => ({ ...m, [path]: f }));
      } catch (e) {
        setNotice(e instanceof ApiError ? `Can't open ${path}: ${e.message}` : `Can't open ${path}.`);
        return;
      }
    }
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
    void refreshInk(path, true);
  }, [files, refreshInk]);

  // ---- boot: session, tree, restore tabs ----
  useEffect(() => {
    let off = () => {};
    (async () => {
      try {
        const s = await api.session();
        if (!s.anchorCache.enabled && !sessionStorage.getItem(`anchor-cache-notice:${s.rootPath}`)) {
          setCacheNotice({ file: s.anchorCache.ignoreFile, line: s.anchorCache.ignoreLine });
          sessionStorage.setItem(`anchor-cache-notice:${s.rootPath}`, "shown");
        }
        const [t, ui] = await Promise.all([api.tree(), api.uiState()]);
        setTree(t);
        const all = flattenTree(t);
        let want = ui.tabs.filter((p) => all.includes(p));
        if (want.length === 0) {
          const first = all.find((p) => p.toLowerCase() === "notebook.md") ?? all[0];
          if (first) want = [first];
        }
        const loadedFiles: Record<string, NoteFile> = {};
        for (const p of want) {
          try {
            loadedFiles[p] = await api.file(p);
          } catch {
            /* skip unreadable tab */
          }
        }
        const ok = want.filter((p) => loadedFiles[p]);
        setFiles(loadedFiles);
        const loadedInk: Record<string, InkSnapshot> = {};
        for (const p of ok) try { loadedInk[p] = await api.ink(p, true); } catch { setNotice(`Ink for ${p} could not be loaded. Its sidecar is preserved.`); }
        setInkFiles(loadedInk);
        setTabs(ok);
        setActive(ui.active && ok.includes(ui.active) ? ui.active : (ok[0] ?? null));
        setBoot({ state: "ready", rootName: s.rootName, rootPath: s.rootPath });
        loaded.current = true;
        off = connectEvents((e) => {
          if (e.type === "open") setOnline(true);
          if (e.type === "closed") setOnline(false);
          if (e.type === "tree" || e.type === "removed") void refreshTree();
          if (e.type === "ink" && e.path) void refreshInk(e.path);
          for (const l of listeners.current) l(e);
        });
      } catch (e) {
        setBoot({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => off();
  }, [refreshTree, refreshInk]);

  // ---- persist open tabs (a small file in the notebook folder) ----
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => void api.putUiState({ v: 1, tabs, active }).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [tabs, active]);

  const closeTab = useCallback(
    async (path: string) => {
      const h = panes.current.get(path);
      if (h) {
        await h.session.flush();
        if (h.session.status === "conflict") return setNotice(`Resolve the conflict in ${path} before closing it.`);
        if (h.session.status === "offline" || h.session.status === "error") return setNotice(`${path} has unsaved changes that couldn't be saved yet.`);
      }
      setNotice(null);
      setTabs((t) => {
        const i = t.indexOf(path);
        const next = t.filter((x) => x !== path);
        setActive((a) => (a === path ? (next[Math.min(i, next.length - 1)] ?? null) : a));
        return next;
      });
      setFiles((m) => {
        const { [path]: _gone, ...rest } = m;
        return rest;
      });
    },
    [],
  );

  const onStatus = useCallback((p: string, s: SyncStatus) => setStatus((m) => (m[p] === s ? m : { ...m, [p]: s })), []);
  const onDoc = useCallback((p: string, text: string) => setDocs((m) => (m[p] === text ? m : { ...m, [p]: text })), []);
  const register = useCallback((p: string, h: PaneHandle | null) => void (h ? panes.current.set(p, h) : panes.current.delete(p)), []);
  const onOpenWiki = useCallback(
    (target: string) => {
      const p = resolver(target);
      if (p) void openNote(p);
      else setNotice(`No note named “${target}” (links never create files).`);
    },
    [resolver, openNote],
  );

  // ---- keyboard: Ctrl/Cmd+P palette, Ctrl/Cmd+O switcher ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "p" || k === "o") {
        e.preventDefault();
        e.stopPropagation();
        setOverlay(k === "p" ? "palette" : "switcher");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const activeHandle = () => (active ? panes.current.get(active) : undefined);
  const activeText = active ? (docs[active] ?? files[active]?.text ?? "") : "";
  const currentInk = active ? inkFiles[active] : undefined;
  const openVersion = active ? (panes.current.get(active)?.session.base.version ?? files[active]?.version ?? null) : null;
  const trustedText = active && currentInk?.document.noteVersion === openVersion && status[active] !== "dirty" && status[active] !== "conflict"
    && activeText === (panes.current.get(active)?.session.base.text ?? files[active]?.text) ? activeText : null;
  const activeItems = useMemo(() => (active ? mappedInk[active] ?? currentInk?.document.items ?? [] : []).map(item => ({ ...item,
    attachment: active && status[active] === "missing" ? { status: "orphaned" as const, reason: "note-missing" as const }
      : item.attachment,
  })), [currentInk, mappedInk, active, status]);
  useEffect(() => {
    if (activeItems.some(i => i.attachment.status === "orphaned")) setRightTab("activity");
  }, [active, currentInk]);
  const prepareAttach = async (item: InkItem, from: number, to: number) => {
    if (!active || !currentInk) return;
    const h = panes.current.get(active);
    if (!h || h.session.status !== "saved") return setNotice("Save or resolve this note before re-attaching ink.");
    const text = h.view.state.doc.toString();
    if (from < 0 || to > text.length || from >= to) return setNotice("Select some text to re-attach the ink.");
    try {
      const disk = await api.file(active);
      if (disk.version !== h.session.base.version || disk.text !== text) return setNotice("The note changed. Reload it before re-attaching ink.");
      h.view.dispatch({ effects: EditorView.scrollIntoView(from, { y: "center" }) });
      setAttachDraft({ path: active, id: item.id, from, to, noteVersion: disk.version, noteText: text, inkVersion: currentInk.version,
        quote: item.anchor.quote, target: text.slice(from, to) });
    } catch { setNotice("Can't verify the selected text against the saved note."); }
  };
  const saveAttach = async () => {
    const d = attachDraft;
    if (!d) return;
    const h = panes.current.get(d.path);
    if (!h || h.session.status !== "saved" || h.view.state.doc.toString() !== d.noteText) {
      setAttachDraft(null); return setNotice("The note changed since selection. Select the target again.");
    }
    try {
      const s = await api.attachInk({ path: d.path, id: d.id, inkVersion: d.inkVersion, noteVersion: d.noteVersion, from: d.from, to: d.to });
      setInkFiles(m => ({ ...m, [d.path]: s }));
      setAttachDraft(null);
    } catch (e) { setAttachDraft(null); setNotice(e instanceof ApiError && e.status === 409 ? "The note or ink changed since selection. Review it and try again." : "Re-attachment could not be saved."); }
  };
  const prepareInsert=async(item:InkItem)=>{
    if(!active)return;const h=panes.current.get(active);if(!h)throw new Error('Open the note first.');
    await h.session.flush();if(h.session.status!=='saved')throw new Error('Save or resolve the note before insertion.');
    const [disk,s]=await Promise.all([api.file(active),api.threads(active)]),latest=s.document.items.find(i=>i.id===item.id);
    if(disk.version!==h.session.base.version||disk.text!==h.view.state.doc.toString()||!latest)throw new Error('The note changed. Review it before insertion.');
    setInsertPreview({path:active,id:item.id,noteText:disk.text,inkVersion:s.version,preview:previewTakeawayInsertion(disk,latest,disk.version)});
  };
  const applyInsert=async()=>{
    const p=insertPreview;if(!p)return;setInsertPreview(null);
    try{const h=panes.current.get(p.path);if(!h||h.session.status!=='saved'||h.view.state.doc.toString()!==p.noteText)throw new Error('The note changed. Review a new insertion preview.');
      const [disk,s]=await Promise.all([api.file(p.path),api.threads(p.path)]);
      const latest=s.document.items.find(i=>i.id===p.id);
      if(!latest||disk.version!==p.preview.noteVersion)throw new Error('The note or thread changed. Review a new insertion preview.');
      const checked=previewTakeawayInsertion(disk,latest,p.preview.noteVersion);
      if(JSON.stringify(checked)!==JSON.stringify(p.preview))throw new Error('The note or takeaway changed. Review a new insertion preview.');
      h.view.dispatch({changes:p.preview.changes});await h.session.flush();if(h.session.status!=='saved')throw new Error('Insertion has a save conflict. Resolve it in the editor.');
    }catch(e){setNotice(e instanceof Error?e.message:'Insertion failed.');}
  };
  const withView = (fn: (h: PaneHandle) => void) => () => {
    const h = activeHandle();
    if (h) fn(h);
  };
  const fmt = (make: (s: PaneHandle["view"]["state"]) => ReturnType<typeof toggleInline>) =>
    withView((h) => {
      const spec = make(h.view.state);
      if (spec) h.view.dispatch(spec);
      h.view.focus();
    });

  const commands = useMemo(() => {
    const list: Array<OverlayItem & { run: () => void }> = [
      { id: "open", label: "Open note…", hint: "Ctrl+O", run: () => setOverlay("switcher") },
      { id: "props", label: showProps ? "Hide properties panel" : "Show properties panel", run: () => setShowProps((v) => !v) },
      { id: "save", label: "Save now", run: withView((h) => void h.session.flush()) },
      { id: "reload", label: "Reload this note from disk", run: withView((h) => void h.session.resync()) },
      { id: "bold", label: "Format: Bold", hint: "Ctrl+B", run: fmt((s) => toggleInline(s, "**")) },
      { id: "italic", label: "Format: Italic", hint: "Ctrl+I", run: fmt((s) => toggleInline(s, "*")) },
      { id: "code", label: "Format: Inline code", run: fmt((s) => toggleInline(s, "`")) },
      { id: "codeblock", label: "Format: Code block", run: fmt(toggleCodeBlock) },
      { id: "bullet", label: "Format: Bulleted list", run: fmt((s) => toggleList(s, "bullet")) },
      { id: "numbered", label: "Format: Numbered list", run: fmt((s) => toggleList(s, "ordered")) },
      { id: "indent", label: "Format: Indent", run: fmt(indentLines) },
      { id: "restore", label: "Restore failed mark at cursor", run: fmt((s) => restoreFailed(s)) },
      ...[0, 1, 2, 3, 4].map((n) => ({ id: `h${n}`, label: n ? `Format: Heading ${n}` : "Format: Plain paragraph", run: fmt((s) => setHeading(s, n)) })),
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, showProps]);

  if (boot.state === "loading") return <div className="boot">Opening notebook…</div>;
  if (boot.state === "error") {
    return (
      <div className="boot">
        <h1>Can't reach the notebook server</h1>
        <p>{boot.message}</p>
        <p className="muted">Start it with <code>npm start</code> inside your project, then reload.</p>
      </div>
    );
  }

  const activeFile = active ? files[active] : undefined;
  return (
    <div className="app">
      <header className="topbar">
        <Tabs tabs={tabs} active={active} status={status} onSelect={setActive} onClose={(p) => void closeTab(p)} />
        <span className="spacer" />
        <button className="ghost" onClick={() => setOverlay("palette")} title="Command palette (Ctrl+P)">
          Commands
        </button>
      </header>
      <aside className="sidebar" aria-label="Notes">
        <div className="side-title" title={boot.rootPath}>{boot.rootName}</div>
        <Tree tree={tree} active={active} onOpen={(p) => void openNote(p)} />
      </aside>
      <main className="editor-col">
        <ChatGPTSettings/>
        {cacheNotice && <div className="notice" role="alert">
          Anchor snapshots are disabled. Add this exact line to <code>{cacheNotice.file}</code>: <code>{cacheNotice.line}</code>
          <button disabled={cacheBusy} onClick={async () => {
            setCacheBusy(true);
            try {
              const result = await api.enableAnchorCache();
              if (result.enabled) { setCacheNotice(null); setNotice("Anchor snapshots enabled. Existing ignore rules were preserved."); }
            } catch { setNotice("Cache setup failed or ignore coverage could not be verified. Persistence remains disabled; review the ignore file."); }
            finally { setCacheBusy(false); }
          }}>Add /.cache/ to root .gitignore</button>
          <button className="ghost" onClick={() => setCacheNotice(null)}>Dismiss</button>
        </div>}
        {notice && (
          <div className="notice" role="alert">
            {notice} <button className="ghost" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}
        {tabs.map((p) =>
          files[p] ? (
            <EditorPane key={p} file={files[p]} visible={p === active} resolver={resolver} onOpenWiki={onOpenWiki} onStatus={onStatus} onDoc={onDoc} subscribe={subscribe} register={register}
              inkItems={inkFiles[p]?.document.items} trustedText={p === active ? trustedText : null}
              inkVersion={inkFiles[p]?.version} onInk={onInk} onInkSaved={onInkSaved} onInkError={setNotice} />
          ) : null,
        )}
        {tabs.length === 0 && (
          <div className="empty">
            <p>No note open.</p>
            <p className="muted">Press <kbd>Ctrl</kbd>+<kbd>O</kbd> to open one.</p>
          </div>
        )}
      </main>
      {showProps && (
        <aside className="rightpanel" aria-label="Note details and activity" data-note-path={active ?? undefined}>
          <div className="right-tabs"><button className={rightTab === "details" ? "on" : ""} onClick={() => setRightTab("details")}>Details</button>
            <button className={rightTab === "activity" ? "on" : ""} onClick={() => setRightTab("activity")}>Activity{activeItems.filter(i => i.attachment.status === "orphaned").length ? ` (${activeItems.filter(i => i.attachment.status === "orphaned").length})` : ""}</button></div>
          {rightTab === "details" && <PropertiesPanel text={active ? (docs[active] ?? activeFile?.text) : undefined} />}
          {rightTab === "activity" && active && <OrphanList text={activeText} items={activeItems} onPick={(item, from, to) => void prepareAttach(item, from, to)}
            onSelect={item => {
              const h = activeHandle();
              if (!h) return;
              const sel = h.view.state.selection.main;
              void prepareAttach(item, sel.from, sel.to);
            }} />}
          {active&&<div hidden={rightTab!=='activity'}><ThreadPanel path={active} items={activeItems} version={currentInk?.version??null} saved={s=>onInkSaved(active,s)} insert={prepareInsert} openId={threadId} onOpen={setThreadId} visible={rightTab==='activity'}/></div>}
          {rightTab==='activity'&&insertPreview&&<section className="attach-preview" aria-label="Review takeaway insertion"><h2>Insert your takeaway</h2><p>This adds only your submitted text through the editor. Undo works normally.</p><pre>{insertPreview.preview.changes.insert}</pre><button onClick={()=>void applyInsert()}>Insert my takeaway</button><button onClick={()=>setInsertPreview(null)}>Cancel insertion</button></section>}
          {rightTab === "activity" && attachDraft && <section className="attach-preview" aria-label="Review re-attachment">
            <h2>Review re-attachment</h2>
            <div className="small muted">Old quote</div><blockquote>{attachDraft.quote}</blockquote>
            <div className="small muted">New selected text</div><blockquote>{attachDraft.target}</blockquote>
            <div className="attach-actions"><button onClick={() => void saveAttach()}>Save re-attachment</button><button onClick={() => setAttachDraft(null)}>Cancel</button></div>
          </section>}
        </aside>
      )}
      <footer className="statusbar">
        <StatusBar path={active} status={active ? status[active] : undefined} text={active ? (docs[active] ?? activeFile?.text) : undefined} eol={activeFile?.eol} bom={activeFile?.bom} online={online} rootPath={boot.rootPath} />
      </footer>
      {overlay === "switcher" && (
        <Overlay
          title="Open note"
          placeholder="Open note…"
          items={paths.map((p) => ({ id: p, label: p.replace(/\.md$/i, "") }))}
          onPick={(id) => {
            setOverlay(null);
            void openNote(`${id}.md`.replace(/\.md\.md$/i, ".md"));
          }}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "palette" && (
        <Overlay
          title="Command palette"
          placeholder="Type a command…"
          items={commands}
          onPick={(id) => {
            setOverlay(null);
            const c = commands.find((x) => x.id === id);
            setTimeout(() => c?.run(), 0);
          }}
          onClose={() => {
            setOverlay(null);
            activeHandle()?.view.focus();
          }}
        />
      )}
    </div>
  );
}
