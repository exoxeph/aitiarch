import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, connectEvents, type NoteFile, type ServerEvent, type TreeNode } from "./api.ts";
import { flattenTree, Overlay, PropertiesPanel, StatusBar, Tabs, Tree, type OverlayItem } from "./components.tsx";
import { EditorPane, type PaneHandle } from "./editor/EditorPane.tsx";
import { indentLines, restoreFailed, setHeading, toggleCodeBlock, toggleInline, toggleList } from "./editor/format.ts";
import type { SyncStatus } from "./editor/session.ts";
import { makeWikiResolver } from "./frontmatter.ts";

type Boot = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; rootName: string; rootPath: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [files, setFiles] = useState<Record<string, NoteFile>>({});
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, SyncStatus>>({});
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [online, setOnline] = useState(true);
  const [overlay, setOverlay] = useState<null | "palette" | "switcher">(null);
  const [showProps, setShowProps] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const panes = useRef(new Map<string, PaneHandle>());
  const listeners = useRef(new Set<(e: ServerEvent) => void>());
  const loaded = useRef(false);

  const subscribe = useCallback((fn: (e: ServerEvent) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const refreshTree = useCallback(() => api.tree().then(setTree).catch(() => {}), []);
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
  }, [files]);

  // ---- boot: session, tree, restore tabs ----
  useEffect(() => {
    let off = () => {};
    (async () => {
      try {
        const s = await api.session();
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
        setTabs(ok);
        setActive(ui.active && ok.includes(ui.active) ? ui.active : (ok[0] ?? null));
        setBoot({ state: "ready", rootName: s.rootName, rootPath: s.rootPath });
        loaded.current = true;
        off = connectEvents((e) => {
          if (e.type === "open") setOnline(true);
          if (e.type === "closed") setOnline(false);
          if (e.type === "tree" || e.type === "removed") void refreshTree();
          for (const l of listeners.current) l(e);
        });
      } catch (e) {
        setBoot({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => off();
  }, [refreshTree]);

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
        {notice && (
          <div className="notice" role="alert">
            {notice} <button className="ghost" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}
        {tabs.map((p) =>
          files[p] ? (
            <EditorPane key={p} file={files[p]} visible={p === active} resolver={resolver} onOpenWiki={onOpenWiki} onStatus={onStatus} onDoc={onDoc} subscribe={subscribe} register={register} />
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
        <aside className="rightpanel" aria-label="Note details">
          <PropertiesPanel text={active ? (docs[active] ?? activeFile?.text) : undefined} />
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
