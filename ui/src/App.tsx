import {notebookWords} from './editor/smart-dictionary.ts';
import type {BringPreview,RepairStatus} from '../server/insertion-store.ts';
import type {DiagramLayout} from '../shared/diagram-svg.ts';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
// The Constellation and d3-force load only when the view is first opened: none of it is in the first page load.
const Constellation = lazy(() => import("./constellation/Constellation.tsx"));
import { api, ApiError, connectEvents, type Backlink, type InkSnapshot, type NoteFile, type ServerEvent, type TreeNode } from "./api.ts";
import { previewText, titleOf, type CiteNote } from "./citations/citation-model.ts";
import { citeAtCursor } from "./citations/cite-editor.ts";
import { BacklinksPanel } from "./citations/BacklinksPanel.tsx";
import type { InkItem } from "../shared/ink.ts";
import { OrphanList } from "./ink/OrphanList.tsx";
import {inkField} from './editor/ink.ts';
import { EditorView } from "@codemirror/view";
import { flattenTree, Overlay, PropertiesPanel, StatusBar, Tabs, Tree, type OverlayItem } from "./components.tsx";
import { EditorPane, type PaneHandle } from "./editor/EditorPane.tsx";
import { indentLines, restoreFailed, setHeading, toggleCodeBlock, toggleInline, toggleList } from "./editor/format.ts";
import type { SyncStatus } from "./editor/session.ts";
import { makeWikiResolver } from "./frontmatter.ts";
import { ChatGPTSettings } from "./ChatGPTSettings.tsx";
import { UsagePanel } from './UsagePanel.tsx';
import {NotesMenu} from './menu/NotesMenu.tsx';
import {defaultNote} from './menu/explorer-model.ts';
import {NoteMenu} from './menu/NoteMenu.tsx';
import {useEdgeMenu} from './menu/useEdgeMenu.ts';
import {ChatPanel} from './chat/ChatPanel.tsx';
import {showQuote} from './editor/quote-highlight.ts';
import {ThreadPanel} from './threads/ThreadPanel.tsx';
import {DismissedThoughts} from './ink/DismissedThoughts.tsx';
import {calloutHeader} from './editor/reveal.ts';
import {ThoughtInsertionPreview} from './ink/ThoughtInsertionPreview.tsx';
import {ThoughtChat} from './ink/ThoughtChat.tsx';
import {previewAiCallout,previewThoughtInsertion} from '../shared/thoughts.ts';
import {secretKinds} from '../server/chat/secrets.ts';
import {SettingsDialog} from './settings/SettingsDialog.tsx';
import {isolateHistory,undo} from '@codemirror/commands';
/** A brief highlight on the lines that were just added, so you can see where they went. */
function flashInserted(view:{state:{doc:{lineAt:(p:number)=>{from:number;to:number;number:number};length:number}};domAtPos:(p:number)=>{node:Node}},from:number,length:number){
  requestAnimationFrame(()=>{try{const end=Math.min(from+length,view.state.doc.length);let pos=from;const seen=new Set<Element>();
    while(pos<=end){const line=view.state.doc.lineAt(pos),el=(view.domAtPos(line.from).node as HTMLElement).closest?.('.cm-line')??(view.domAtPos(line.from).node.parentElement?.closest('.cm-line'));if(el&&!seen.has(el)){seen.add(el);el.classList.add('cm-flash');}if(line.to+1<=pos)break;pos=line.to+1;}
    setTimeout(()=>seen.forEach(el=>el.classList.remove('cm-flash')),1600);}catch{/* the highlight is only a courtesy */}});
}
import {previewTakeawayInsertion} from '../shared/takeaway-insertion.ts';
import {SLASH_ITEMS,slashInsert} from './editor/slash.ts';
import {invokeSelection} from './editor/toolbar.ts';

type Boot = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; rootName: string; rootPath: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [tree, setTree] = useState<TreeNode | null>(null);
  const menu=useEdgeMenu(),burgerRef=useRef<HTMLButtonElement>(null),noteMenuRef=useRef<HTMLButtonElement>(null),chatPillRef=useRef<HTMLButtonElement>(null);
  const [noteMenuOpen,setNoteMenuOpen]=useState(false),[chatOpen,setChatOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[settingsVersion,setSettingsVersion]=useState(0);
  const [treePersistence,setTreePersistence]=useState(false);
  const [treeNotice,setTreeNotice]=useState(false);
  const [theme,setTheme]=useState<'ember'|'moss'>('ember');
  const [smartCorrections,setSmartCorrections]=useState(true),[neverCorrect,setNeverCorrect]=useState<string[]>([]);
  const [vocabulary,setVocabulary]=useState<ReadonlySet<string>|null>(null);
  const vocabularyNotes=useRef(new Map<string,string>());
  const rejectCorrection=useCallback((word:string)=>{setNeverCorrect(previous=>previous.includes(word)?previous:[...previous,word].slice(-10000));if(!treePersistence)setTreeNotice(true);},[treePersistence]);
  const [typingHelpOn,setTypingHelpOn]=useState(true),[doubleSpacePeriod,setDoubleSpacePeriod]=useState(true);
  useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
  const chooseTheme=(value:'ember'|'moss')=>{setTheme(value);if(!treePersistence)setTreeNotice(true);};
  const [files, setFiles] = useState<Record<string, NoteFile>>({});
  const [inkFiles, setInkFiles] = useState<Record<string, InkSnapshot>>({});
  const [mappedInk, setMappedInk] = useState<Record<string, InkItem[]>>({});
  const onInk = useCallback((path: string, items: InkItem[]) => setMappedInk(m => ({ ...m, [path]: items })), []);
  const onInkSaved = useCallback((path: string, snapshot: InkSnapshot) => setInkFiles(m => ({ ...m, [path]: snapshot })), []);
  const [attachDraft, setAttachDraft] = useState<null | { path: string; id: string; from: number; to: number; noteVersion: string; noteText: string; inkVersion: string | null; quote: string; target: string }>(null);
  const [thoughtChat,setThoughtChat]=useState<string|null>(null),[toast,setToast]=useState<null|{text:string;id:string;undo:'restore'|'unresolve'}>(null),[confirmAdd,setConfirmAdd]=useState(false),[added,setAdded]=useState<null|{text:string;detail:string}>(null),[showDismissed,setShowDismissed]=useState(false);
  const [bringPreview,setBringPreview]=useState<null|{path:string;id:string;noteText:string;preview:BringPreview;render?:{layout:DiagramLayout;theme:'light'|'dark'};replyId?:string}>(null);
  const [insertionRepair,setInsertionRepair]=useState<RepairStatus|null>(null);
  const [repairError,setRepairError]=useState(false);
  const [threadId,setThreadId]=useState<string|null>(null);
  const [insertPreview,setInsertPreview]=useState<null|{path:string;id:string;noteText:string;inkVersion:string|null;preview:ReturnType<typeof previewTakeawayInsertion>}>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, SyncStatus>>({});
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [online, setOnline] = useState(true);
  const [overlay, setOverlay] = useState<null | "palette" | "switcher">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState<null | { file: string; line: string }>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const panes = useRef(new Map<string, PaneHandle>());
  const listeners = useRef(new Set<(e: ServerEvent) => void>());
  const loaded = useRef(false);
  useEffect(()=>{const open=(event:Event)=>{const detail=(event as CustomEvent<{id:string;thought?:boolean}>).detail;setThreadId(detail.id);setThoughtChat(detail.id);};window.addEventListener('open-thread',open);return()=>window.removeEventListener('open-thread',open);},[]);
  // A Think or Ask review takes the stage: the note menu, if open, closes so it cannot sit over the review's Send button.
  useEffect(()=>{const close=()=>setNoteMenuOpen(false);window.addEventListener('invocation-begin',close);return()=>window.removeEventListener('invocation-begin',close);},[]);

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
  // Moving or renaming: a note with unsaved work is never moved out from under its editor.
  const moveBlocked = useCallback((moving: string[]) => {
    const hit = tabs.filter(t => moving.some(m => t === m || t.startsWith(m + "/")) && status[t] && status[t] !== "saved");
    return hit.length ? `Save ${hit[0]}${hit.length > 1 ? ` and ${hit.length - 1} more` : ""} before moving it.` : null;
  }, [tabs, status]);
  // After a move the open tabs follow their notes to the new paths (their text, ink and links already moved on disk).
  const afterMove = useCallback(async (moves: { from: string; to: string }[]) => {
    const map = new Map(moves.map(m => [m.from, m.to])), moved = tabs.filter(t => map.has(t));
    if (!moved.length) return;
    const fresh: Record<string, NoteFile> = {};
    for (const t of moved) { const to = map.get(t)!; try { fresh[to] = await api.file(to); } catch { /* that tab simply closes */ } }
    setFiles(f => { const n = { ...f }; for (const t of moved) delete n[t]; return { ...n, ...fresh }; });
    setInkFiles(f => { const n = { ...f }; for (const t of moved) delete n[t]; return n; });
    setTabs(ts => ts.flatMap(t => !map.has(t) ? [t] : fresh[map.get(t)!] ? [map.get(t)!] : []));
    setActive(a => a && map.has(a) ? (fresh[map.get(a)!] ? map.get(a)! : null) : a);
    for (const p of Object.keys(fresh)) void refreshInk(p, true);
  }, [tabs, refreshInk]);
  const paths = useMemo(() => flattenTree(tree), [tree]);
  // Read only local note APIs. Failed reads disable dictionary guesses conservatively.
  useEffect(()=>{let current=true;setVocabulary(null);void (async()=>{const notes=new Map<string,string>();for(const p of paths)notes.set(p,(await api.file(p)).text);if(current){vocabularyNotes.current=notes;setVocabulary(notebookWords(notes));}})().catch(()=>{});return()=>{current=false;};},[paths]);
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

  // @ citations: which notes exist, opening one, a short preview, and the note index the picker searches (cached for a moment while typing).
  const openRef = useRef(openNote); openRef.current = openNote;
  const notesCache = useRef<{ at: number; p: Promise<CiteNote[]> } | null>(null);
  const [jump, setJump] = useState<{ path: string; heading: string } | null>(null);
  // Keyed on the note list itself, not the tree object: every tree refresh made a new environment, and reconfiguring the
  // editors for it closed an open Think or Ask review under the user (the threads check caught it).
  const pathsKey = paths.join("\n");
  const cite = useMemo(() => {
    const have = new Set(pathsKey ? pathsKey.split("\n") : []);
    return {
      has: (p: string) => have.has(p),
      open: (p: string, heading: string | null) => { void openRef.current(p); if (heading) setJump({ path: p, heading }); },
      notes: () => {
        const c = notesCache.current; if (c && Date.now() - c.at < 1500) return c.p;
        const p = api.citations(); notesCache.current = { at: Date.now(), p }; p.catch(() => { notesCache.current = null; }); return p;
      },
      preview: async (p: string) => { try { return previewText((await api.file(p)).text) || null; } catch { return null; } },
    };
  }, [pathsKey]);
  // Backlinks for the open note: read again when it changes, and (briefly after) when any note or the tree changes on disk.
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  // The Constellation view, and the notes it hands to the chat ("Use as chat context").
  const [mapOpen, setMapOpen] = useState(false), [mapNotes, setMapNotes] = useState<string[]>([]), mapButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active) { setBacklinks([]); return; }
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => void api.backlinks(active).then(b => { if (live) setBacklinks(b); }).catch(() => {});
    load();
    const on = (e: ServerEvent) => { if (e.type === "changed" || e.type === "tree" || e.type === "removed") { clearTimeout(timer); timer = setTimeout(load, 500); } };
    listeners.current.add(on);
    return () => { live = false; clearTimeout(timer); listeners.current.delete(on); };
  }, [active]);

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
        const [t, ui, persistence] = await Promise.all([api.tree(), api.uiState(),api.uiStatePersistence().catch(()=>({enabled:false}))]);
        setConfirmAdd(ui.confirmAdd??false);setTreePersistence(persistence.enabled);
        if(persistence.enabled){setTheme(ui.theme??'ember');setTypingHelpOn(ui.typingHelp??true);setDoubleSpacePeriod(ui.doubleSpacePeriod??true);setSmartCorrections(ui.smartCorrections??true);setNeverCorrect(ui.neverCorrect??[]);}
        setTree(t);
        const all = flattenTree(t);
        let want = ui.tabs.filter((p) => all.includes(p));
        if (want.length === 0) {
          const first = defaultNote(all);
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
          if(e.type==='changed'&&e.path){const path=e.path;void api.file(path).then(f=>{vocabularyNotes.current.set(path,f.text);const view=panes.current.get(path)?.view;
            setVocabulary(notebookWords(vocabularyNotes.current,view?{path,text:view.state.doc.toString(),head:view.state.selection.main.head}:undefined));
          }).catch(()=>setVocabulary(null));}
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
    const t = setTimeout(() => void api.putUiState({ v: 1, tabs, active, ...(treePersistence?{theme,confirmAdd,typingHelp:typingHelpOn,doubleSpacePeriod,smartCorrections,neverCorrect}:{}) }).catch(() => {if(treePersistence){setTreePersistence(false);setTreeNotice(true);}}), 300);
    return () => clearTimeout(t);
  }, [tabs, active, treePersistence,theme,confirmAdd,typingHelpOn,doubleSpacePeriod,smartCorrections,neverCorrect]);

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
      if (k === "p" || k === "o" || k === "k") {
        e.preventDefault();
        e.stopPropagation();
        setOverlay(k === "o" ? "switcher" : "palette");
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
  useEffect(()=>{if(thoughtChat&&!activeItems.some(i=>i.id===thoughtChat))setThoughtChat(null);},[thoughtChat,activeItems]);
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
  useEffect(()=>{setThoughtChat(null);setBringPreview(null);setInsertionRepair(null);setRepairError(false);if(!active)return;let stopped=false;void api.insertionStatus(active).then(s=>{if(!stopped)setInsertionRepair(s);}).catch(()=>{if(!stopped)setRepairError(true);});return()=>{stopped=true;};},[active]);
  // Add to note: the same journaled steps as before (preview, prepare, one editor dispatch, complete). By default they run
  // straight away from one click and the text that was added is shown afterwards; with "confirm before adding" on, the preview
  // dialog comes first. `replyId` picks one specific AI message instead of the first answer.
  const runBring=async(p:NonNullable<typeof bringPreview>)=>{
    let inserted=false,operationId:string|undefined;
    try{const h=panes.current.get(p.path);if(!h||h.session.status!=='saved'||h.view.state.doc.toString()!==p.noteText)throw new Error('The note changed. Review a new preview.');
      const [disk,ink]=await Promise.all([api.file(p.path),api.threads(p.path)]),latest=ink.document.items.find(i=>i.id===p.id),mapped=h.view.state.field(inkField).items.find(i=>i.id===p.id);
      if(!latest||!mapped)throw new Error('The thought changed. Review a new preview.');
      const extra=p.replyId?{replyId:p.replyId}:{};
      const checked=await api.threadCall<BringPreview>('bring-preview',{path:p.path,id:p.id,noteVersion:p.preview.noteVersion,...p.render,...extra});
      if(JSON.stringify(checked)!==JSON.stringify(p.preview))throw new Error('The thought changed. Review a new preview.');
      if(h.session.status!=='saved'||h.session.base.version!==disk.version||h.view.state.doc.toString()!==p.noteText)throw new Error('The note changed. Review a new preview.');
      const prepared=await api.threadCall<{operationId:string}>('bring-prepare',{path:p.path,id:p.id,noteVersion:p.preview.noteVersion,...p.render,...extra,preview:p.preview});operationId=prepared.operationId;
      if(h.session.status!=='saved'||h.session.base.version!==disk.version||h.view.state.doc.toString()!==p.noteText)throw new Error('The note changed. Review a new preview.');
      h.view.dispatch({changes:checked.changes,annotations:isolateHistory.of('full')});inserted=true;setInsertionRepair({pending:1,unverified:0});
      flashInserted(h.view,checked.changes.from,checked.changes.insert.length);
      const quote=mapped.anchor.quote.replace(/\s+/g,' ').trim();setAdded({text:`Added under “${quote.length>36?quote.slice(0,35)+'…':quote}”`,detail:checked.changes.insert.trim()});
      await h.session.flush();if(h.session.status!=='saved')throw new Error('Insertion has a save conflict. Resolve it in the editor.');
      setInsertionRepair(await api.threadCall<RepairStatus>('bring-complete',{path:p.path,id:p.id,operationId}));
    }catch(e){if(operationId&&!inserted)await api.threadCall('bring-cancel',{path:p.path,id:p.id,operationId}).catch(()=>{});setAdded(null);setNotice((inserted?'The insertion is preserved in the editor. ':'')+(e instanceof Error?e.message:'AI insertion failed.'));}
  };
  const bringConfirm=useRef(false);bringConfirm.current=confirmAdd;
  useEffect(()=>{
    const bring=async(event:Event)=>{
      const {id,replyId}=(event as CustomEvent<{id:string;replyId?:string}>).detail;if(!active)return;
      try{const h=panes.current.get(active);if(!h)throw new Error('Open the note first.');await h.session.flush();
        if(h.session.status!=='saved')throw new Error('Save or resolve the note before insertion.');
        const [disk,ink]=await Promise.all([api.file(active),api.threads(active)]);
        const latest=ink.document.items.find(i=>i.id===id),mapped=h.view.state.field(inkField).items.find(i=>i.id===id);
        if(!latest||!mapped||disk.text!==h.view.state.doc.toString()||disk.version!==h.session.base.version)throw new Error('The note changed. Review a new preview.');
        const reply=replyId?[...(latest.thread?.followups??[]),...(latest.thread?.summary.reply?[latest.thread.summary.reply]:[])].find(r=>r.id===replyId):undefined;
        if(replyId&&!reply)throw new Error('That reply was not found.');
        const diagram=reply?reply.diagram:latest.diagram;
        let render:{layout:DiagramLayout;theme:'light'|'dark'}|undefined;if(diagram){const m=await import('./diagrams/view.ts');render={layout:await m.cachedLayout(diagram),theme:m.diagramTheme()};}
        const extra=replyId?{replyId}:{};
        const preview=await api.threadCall<BringPreview>('bring-preview',{path:active,id,noteVersion:disk.version,...render,...extra});
        const p={path:active,id,noteText:disk.text,preview,render,...extra};
        if(bringConfirm.current)setBringPreview(p);else void runBring(p);
      }catch(e){setNotice(e instanceof Error?e.message:'Could not preview AI insertion.');}
    };window.addEventListener('bring-thought',bring);return()=>window.removeEventListener('bring-thought',bring);
  });
  // "Make it mine": an explicit click on an AI callout removes its AI label (one undoable edit) and records the adoption.
  useEffect(()=>{
    const adopt=async(event:Event)=>{
      const pos=(event as CustomEvent<{pos:number}>).detail.pos;if(!active)return;const h=panes.current.get(active);if(!h)return;
      const doc=h.view.state.doc,line=doc.lineAt(Math.min(pos,doc.length)),header=calloutHeader(line.text);if(!header||header.kind!=='ai')return;
      let recorded=false;
      try{await h.session.flush();if(h.session.status==='saved')recorded=(await api.threadCall<{recorded:boolean}>('bring-adopt',{path:active,from:line.from})).recorded;}
      catch(e){setNotice(e instanceof Error?e.message:'The adoption could not be recorded.');}
      const end=Math.min(line.to+1,doc.length);
      h.view.dispatch({changes:{from:line.from,to:end,insert:''},userEvent:'input.adopt',annotations:isolateHistory.of('full')});
      setAdded({text:'Made it mine · the AI label is removed',detail:recorded?'Recorded: AI-inserted, later adopted by you.':'No AI insertion was on record for this block, so only the label was removed.'});
      h.view.focus();
    };
    window.addEventListener('adopt-callout',adopt);return()=>window.removeEventListener('adopt-callout',adopt);
  });  const bringThought=async()=>{const p=bringPreview;if(!p)return;setBringPreview(null);await runBring(p);panes.current.get(p.path)?.view.focus();};  const prepareInsert=async(item:InkItem)=>{
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

  // Dismiss hides a thought (nothing is deleted); Restore brings it back. Both are the existing human thread actions.
  const thoughtAction=async(id:string,type:'dismiss'|'restore'|'resolve'|'unresolve')=>{if(!active)return;try{const latest=await api.threads(active),s=await api.threadAction(active,id,latest.version,{type});onInkSaved(active,s);setToast(type==='dismiss'?{text:'Thought dismissed.',id,undo:'restore'}:type==='resolve'?{text:'Thought resolved.',id,undo:'unresolve'}:null);if(type==='restore')setShowDismissed(false);}catch(e){setNotice(e instanceof Error?e.message:'That action could not be applied.');}};
  useEffect(()=>{const dismiss=(e:Event)=>void thoughtAction((e as CustomEvent<{id:string}>).detail.id,'dismiss'),resolve=(e:Event)=>void thoughtAction((e as CustomEvent<{id:string}>).detail.id,'resolve'),reopen=(e:Event)=>void thoughtAction((e as CustomEvent<{id:string}>).detail.id,'unresolve'),show=()=>setShowDismissed(true);window.addEventListener('dismiss-thought',dismiss);window.addEventListener('resolve-thought',resolve);window.addEventListener('reopen-thought',reopen);window.addEventListener('show-dismissed',show);return()=>{window.removeEventListener('dismiss-thought',dismiss);window.removeEventListener('resolve-thought',resolve);window.removeEventListener('reopen-thought',reopen);window.removeEventListener('show-dismissed',show);};});
  // Resolving collapses the open conversation (it stays visible, dimmed, in the margin).
  const wasResolved=useRef(false);
  useEffect(()=>{const now=!!activeItems.find(i=>i.id===thoughtChat)?.thread?.resolvedAt;if(thoughtChat&&now&&!wasResolved.current)setThoughtChat(null);wasResolved.current=now;},[thoughtChat,activeItems]);
  useEffect(()=>{if(!added)return;const timer=setTimeout(()=>setAdded(null),12000);return()=>clearTimeout(timer);},[added]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),9000);return()=>clearTimeout(timer);},[toast]);
  const commands = useMemo(() => {
    const list: Array<OverlayItem & { run: () => void }> = [
      ...paths.map(path=>({id:`note:${path}`,label:`Jump to note: ${path}`,group:'Notes',run:()=>void openNote(path)})),
      ...SLASH_ITEMS.map((item,i)=>({id:`insert:${i}`,label:`Insert: ${item.label}`,group:'Insert blocks',run:withView(h=>{
        const r=h.view.state.selection.main,insert=slashInsert(item,r.from,r.to);
        h.view.dispatch({changes:insert.changes,selection:{anchor:insert.caret},userEvent:'input.palette',scrollIntoView:true});h.view.focus();
      })})),
      {id:'confirm-add',label:confirmAdd?'Add to note: add straight away (no confirmation)':'Add to note: confirm before adding',group:'AI',run:()=>{setConfirmAdd(v=>!v);if(!treePersistence)setTreeNotice(true);}},
      {id:'dismissed',label:'Show dismissed thoughts',group:'AI',run:()=>setShowDismissed(true)},
      {id:'visualize',label:'AI: Visualize selection as a diagram',group:'AI',run:withView(h=>{if(!invokeSelection(h.view,'visualize'))setNotice('Select some text first, then choose Visualize.');})},
      {id:'tree',label:'Notes menu: open or close',group:'Workspace',run:()=>menu.toggle(false)},
      {id:'typing-help',label:`Typing help: ${typingHelpOn?'On':'Off'}`,group:'Typing',run:()=>{setTypingHelpOn(v=>!v);if(!treePersistence)setTreeNotice(true);}},
      {id:'smart-corrections',label:`Smart corrections: ${smartCorrections?'On':'Off'}`,group:'Typing',run:()=>{setSmartCorrections(v=>!v);if(!treePersistence)setTreeNotice(true);}},
      {id:'double-space',label:`Double-space period: ${doubleSpacePeriod?'On':'Off'}`,group:'Typing',run:()=>{setDoubleSpacePeriod(v=>!v);if(!treePersistence)setTreeNotice(true);}},
      ...(['ember','moss'] as const).map(value=>({id:`theme:${value}`,label:`Theme: ${value[0].toUpperCase()+value.slice(1)}`,group:'Appearance',run:()=>chooseTheme(value)})),
      { id: "open", label: "Open note…", hint: "Ctrl+O", run: () => setOverlay("switcher") },
      { id: "props", label: noteMenuOpen ? "Hide note details" : "Show note details", run: () => setNoteMenuOpen((v) => !v) },
      { id: "chat", label: chatOpen ? "Close chat" : "Open chat", group: "Workspace", run: () => setChatOpen((v) => !v) },
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
    return list.map(item=>({...item,group:item.group??(['open','props','save','reload'].includes(item.id)?'Workspace':'Formatting')}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, noteMenuOpen,chatOpen,paths,treePersistence,openNote,confirmAdd,typingHelpOn,doubleSpacePeriod,smartCorrections,neverCorrect]);

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
  const orphanCount = activeItems.filter(i => i.attachment.status === "orphaned").length;
  // What the chat chips offer: the same validated AI replies the server's "Threads" module reads (never questions, drafts or summaries).
  const chatThreadsText = activeItems.flatMap(i => [...(i.generation?.status === "complete" ? [i.body] : []), ...(i.thread?.followups ?? []).filter(r => r.generation.status === "complete").map(r => r.body)]).join("\n\n");
  const chatSelection = () => { const h = active ? panes.current.get(active) : undefined; if (!h) return ""; const s = h.view.state.selection.main; return s.empty ? "" : h.view.state.sliceDoc(s.from, s.to).slice(0, 8000); };
  // Add to note for an investigation answer. The server's insertion journal only knows stored chat messages, so this goes through the editor like
  // the other AI callouts (shared previewAiCallout, one undoable edit, the same toast) without a journal entry; "Make it mine" still works on it.
  const addTextToNote = async (body: string) => {
    if (!active) return;
    try {
      if (secretKinds(body).length) throw new Error("Add to note blocked: this answer may contain a secret or private key. Nothing was inserted.");
      const h = panes.current.get(active); if (!h) throw new Error("Open the note first.");
      await h.session.flush(); if (h.session.status !== "saved") throw new Error("Save or resolve the note before insertion.");
      const disk = await api.file(active);
      if (h.session.base.version !== disk.version || h.view.state.doc.toString() !== disk.text) throw new Error("The note changed. Try again.");
      const head = h.view.state.selection.main.head, preview = previewAiCallout({ text: disk.text, version: disk.version }, body, head > 0 ? Math.min(head, disk.text.length) : disk.text.length);
      h.view.dispatch({ changes: preview.changes, annotations: isolateHistory.of("full") });
      flashInserted(h.view, preview.changes.from, preview.changes.insert.length);
      setAdded({ text: "Added from investigation", detail: preview.changes.insert.trim() });
      await h.session.flush();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Adding to the note failed."); }
  };
  // Add to note for a chat reply: the same journaled steps as an AI thought (preview, prepare, one editor dispatch, complete), then the same toast with Undo.
  const addChatMessage = async (id: string) => {
    if (!active) return;
    let inserted = false, operationId: string | undefined;
    try {
      const h = panes.current.get(active); if (!h) throw new Error("Open the note first.");
      await h.session.flush(); if (h.session.status !== "saved") throw new Error("Save or resolve the note before insertion.");
      const disk = await api.file(active), unchanged = () => h.session.status === "saved" && h.session.base.version === disk.version && h.view.state.doc.toString() === disk.text;
      if (!unchanged()) throw new Error("The note changed. Review a new preview.");
      const head = h.view.state.selection.main.head, body = { path: active, id, noteVersion: disk.version, after: head > 0 ? Math.min(head, disk.text.length) : disk.text.length };
      const preview = await api.chatCall<BringPreview>("bring-preview", body);
      const prepared = await api.chatCall<{ operationId: string }>("bring-prepare", { ...body, preview }); operationId = prepared.operationId;
      if (!unchanged()) throw new Error("The note changed. Review a new preview.");
      h.view.dispatch({ changes: preview.changes, annotations: isolateHistory.of("full") }); inserted = true; setInsertionRepair({ pending: 1, unverified: 0 });
      flashInserted(h.view, preview.changes.from, preview.changes.insert.length);
      setAdded({ text: "Added from chat", detail: preview.changes.insert.trim() });
      await h.session.flush(); if (h.session.status !== "saved") throw new Error("Insertion has a save conflict. Resolve it in the editor.");
      setInsertionRepair(await api.chatCall<RepairStatus>("bring-complete", { path: active, operationId }));
    } catch (e) {
      if (operationId && !inserted) await api.chatCall("bring-cancel", { path: active, operationId }).catch(() => {});
      if (!inserted) setAdded(null);
      setNotice((inserted ? "The insertion is preserved in the editor. " : "") + (e instanceof Error ? e.message : "Adding to the note failed."));
    }
  };
  const settingsPanel = <div className="menu-settings-body">
    {([['Typing help',typingHelpOn,setTypingHelpOn],['Smart corrections',smartCorrections,setSmartCorrections],['Double-space period',doubleSpacePeriod,setDoubleSpacePeriod]] as const).map(([label,on,set])=>
      <button key={label} type="button" role="switch" aria-checked={on} className="menu-switch" onClick={()=>{set(!on);if(!treePersistence)setTreeNotice(true);}}><span>{label}</span><i aria-hidden="true"/></button>)}
    <ChatGPTSettings/>
  </div>;
  return (
    <div className="app">
      <header className="topbar">
        <button ref={burgerRef} className="ghost tree-toggle" aria-label="Notes menu" aria-controls="note-tree" aria-expanded={menu.open} title="Notes menu" onClick={e=>menu.toggle(e.detail===0)}>☰</button>
        <Tabs tabs={tabs} active={active} status={status} onSelect={setActive} onClose={(p) => void closeTab(p)} />
        <span className="spacer" />
        <select className="theme-toggle" aria-label="Theme" value={theme} onChange={e=>chooseTheme(e.target.value as typeof theme)}><option value="ember">Ember</option><option value="moss">Moss</option></select>
        <button className="ghost commands-btn" aria-label="Commands" onClick={() => setOverlay("palette")} title="Command palette (Ctrl+K; Ctrl+P)">
          <span className="commands-label">Commands</span>
          <svg className="commands-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M5.5 5.5v5M10.5 5.5v5M5.5 5.5h5M5.5 10.5h5M5.5 5.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2Zm5 0a2 2 0 1 1 2-2 2 2 0 0 1-2 2Zm-5 5a2 2 0 1 0-2 2 2 2 0 0 0 2-2Zm5 0a2 2 0 1 0 2 2 2 2 0 0 0-2-2Z"/></svg>
        </button>
        {backlinks.length > 0 && <button type="button" className="ghost backlinks-pill" aria-label={`${backlinks.length} ${backlinks.length === 1 ? "note links" : "notes link"} here. Show backlinks`} title="Backlinks" onClick={() => setNoteMenuOpen(true)}>↩ {backlinks.length}</button>}
        <NoteMenu open={noteMenuOpen} setOpen={setNoteMenuOpen} count={orphanCount} buttonRef={noteMenuRef}>
          <BacklinksPanel items={backlinks} onOpen={p => { setNoteMenuOpen(false); void openNote(p); }} />
          <PropertiesPanel text={active ? (docs[active] ?? activeFile?.text) : undefined} />
          {active && <OrphanList text={activeText} items={activeItems} onPick={(item, from, to) => void prepareAttach(item, from, to)}
            onSelect={item => {
              const h = activeHandle();
              if (!h) return;
              const sel = h.view.state.selection.main;
              void prepareAttach(item, sel.from, sel.to);
            }} />}
          {insertPreview&&<section className="attach-preview" aria-label="Review takeaway insertion"><h2>Insert your takeaway</h2><p>This adds only your submitted text through the editor. Undo works normally.</p><pre>{insertPreview.preview.changes.insert}</pre><button onClick={()=>void applyInsert()}>Insert my takeaway</button><button onClick={()=>setInsertPreview(null)}>Cancel insertion</button></section>}
          {attachDraft && <section className="attach-preview" aria-label="Review re-attachment">
            <h2>Review re-attachment</h2>
            <div className="small muted">Old quote</div><blockquote>{attachDraft.quote}</blockquote>
            <div className="small muted">New selected text</div><blockquote>{attachDraft.target}</blockquote>
            <div className="attach-actions"><button onClick={() => void saveAttach()}>Save re-attachment</button><button onClick={() => setAttachDraft(null)}>Cancel</button></div>
          </section>}
        </NoteMenu>
        <button ref={mapButtonRef} type="button" className="map-pill" aria-label="Constellation" aria-expanded={mapOpen} onClick={() => setMapOpen(v => !v)} title="Your notes as a map of linked stars">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="3.5" cy="11.5" r="1.6" fill="currentColor"/><circle cx="8" cy="4" r="2" fill="currentColor"/><circle cx="12.8" cy="10" r="1.3" fill="currentColor"/><path d="M4.6 10.2 7 5.6M9.6 5.2l2.4 3.6M5.1 11.4l6.3-1.2"/></svg>
          <span className="map-pill-label">Constellation</span>
        </button>
        <button ref={chatPillRef} type="button" className="chat-pill" aria-expanded={chatOpen} aria-controls="chat-panel" onClick={() => setChatOpen(v => !v)}><span className="chat-pill-dot" aria-hidden="true" />Chat</button>
      </header>
      <NotesMenu menu={menu} burger={burgerRef} rootName={boot.rootName} rootPath={boot.rootPath} tree={tree} active={active} onOpen={(p) => void openNote(p)} onSearch={() => setOverlay("palette")} onSettings={() => setSettingsOpen(true)} usage={<UsagePanel />} settings={settingsPanel} onTreeChanged={() => refreshTree()} onMoved={m => void afterMove(m)} blocked={moveBlocked} />
      <main className="editor-col" data-note-path={active ?? undefined}>
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
        {(insertionRepair?.pending||repairError)?<div className="notice" role="status" aria-label="AI insertion recording pending">AI insertion recording pending. The note is preserved; no insertion will be repeated. {insertionRepair?.unverified?'The saved insertion could not be verified.':''}<button onClick={()=>{if(active)void api.insertionStatus(active).then(s=>{setInsertionRepair(s);setRepairError(false);}).catch(()=>setRepairError(true));}}>Retry recording (no AI call)</button></div>:null}
        {notice && (
          <div className="notice" role="alert">
            {notice} <button className="ghost" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}
        {tabs.map((p) =>
          files[p] ? (
            <EditorPane key={p} file={files[p]} visible={p === active} resolver={resolver} onOpenWiki={onOpenWiki} cite={cite} jumpTo={jump?.path === p ? jump.heading : null} onJumped={() => setJump(null)} onStatus={onStatus} onDoc={onDoc} subscribe={subscribe} register={register}
              inkItems={inkFiles[p]?.document.items} trustedText={p === active ? trustedText : null}
              typingOptions={{enabled:typingHelpOn,doubleSpace:doubleSpacePeriod,smart:smartCorrections,vocabulary:vocabulary??undefined,neverCorrect,onReject:rejectCorrection}}
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
      {mapOpen && <Suspense fallback={<section className="constellation" role="status" aria-label="Constellation"><p className="cn-empty">Charting your notes…</p></section>}>
        <Constellation active={active} subscribe={subscribe}
          onClose={() => { setMapOpen(false); mapButtonRef.current?.focus(); }}
          onOpen={p => { setMapOpen(false); void openNote(p); }}
          onUseAsContext={ps => { setMapNotes(ps); setMapOpen(false); setChatOpen(true); }} />
      </Suspense>}
      {chatOpen && <ChatPanel key={active ?? "none"} extraNotes={mapNotes} onClearExtraNotes={() => setMapNotes([])} path={active} noteText={active ? (docs[active] ?? activeFile?.text ?? "") : ""} threadsText={chatThreadsText} getSelection={chatSelection} onAdd={addChatMessage} onAddText={addTextToNote} onOpenSettings={() => setSettingsOpen(true)} settingsVersion={settingsVersion} onShowQuote={(quote) => { const h = active ? panes.current.get(active) : undefined; return !!h && showQuote(h.view, quote); }} onCiteClaim={(heading) => { const h = active ? panes.current.get(active) : undefined; return !!h && !!active && citeAtCursor(h.view, active, { path: active, title: titleOf(h.view.state.doc.toString(), active), ...(heading ? { heading } : {}) }); }} onClose={() => { setChatOpen(false); chatPillRef.current?.focus(); }} />}
      {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); setSettingsVersion(v => v + 1); burgerRef.current?.focus(); }} />}
      {toast&&<div className="thought-toast" role="status"><span>{toast.text}</span><button onClick={()=>void thoughtAction(toast.id,toast.undo)}>Undo</button><button aria-label="Close notice" onClick={()=>setToast(null)}>Close</button></div>}
      {added&&<div className="thought-toast" role="status"><span>{added.text} · Undo (Ctrl+Z)</span><details className="added-detail"><summary>What was added</summary><pre>{added.detail}</pre></details><button onClick={()=>{const h=active?panes.current.get(active):undefined;if(h){undo(h.view);h.view.focus();}setAdded(null);}}>Undo</button><button aria-label="Close notice" onClick={()=>setAdded(null)}>Close</button></div>}
      {showDismissed&&<DismissedThoughts items={activeItems} restore={id=>void thoughtAction(id,'restore')} close={()=>setShowDismissed(false)}/>}
      {active&&thoughtChat&&<ThoughtChat id={thoughtChat} close={()=>setThoughtChat(null)}><ThreadPanel path={active} items={activeItems} version={currentInk?.version??null} saved={s=>onInkSaved(active,s)} insert={async item=>{await prepareInsert(item);setNoteMenuOpen(true);}} openId={thoughtChat} onOpen={id=>{setThoughtChat(id);setThreadId(id);}} visible/></ThoughtChat>}
      {bringPreview&&<ThoughtInsertionPreview text={bringPreview.preview.changes.insert} insert={()=>void bringThought()} cancel={()=>setBringPreview(null)}/>}
      <footer className="statusbar">
        <span id="status-notice-slot" className="status-notice-slot">{treeNotice&&<span className="status-notice" role="note"><span className="status-notice-text" title="File tree and theme preferences stay in memory until ignore coverage for /ui-state.json* is verified.">File tree and theme preferences stay in memory until <code>/ui-state.json*</code> is ignored.</span>
          <button aria-label="Add /ui-state.json* to root .gitignore" onClick={async()=>{try{const s=await api.enableThreadDrafts();setTreePersistence(s.enabled);setTreeNotice(!s.enabled);}catch{setNotice('Could not verify UI state ignore coverage. The file tree preference remains in memory.');}}}>Add to .gitignore</button>
          <button aria-label="Dismiss tree preference notice" onClick={()=>setTreeNotice(false)}>Dismiss</button></span>}</span>
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
