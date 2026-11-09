import type {BringPreview,RepairStatus} from '../server/insertion-store.ts';
import type {DiagramLayout} from '../shared/diagram-svg.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, connectEvents, type InkSnapshot, type NoteFile, type ServerEvent, type TreeNode } from "./api.ts";
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
import {ThreadPanel} from './threads/ThreadPanel.tsx';
import {DismissedThoughts} from './ink/DismissedThoughts.tsx';
import {calloutHeader} from './editor/reveal.ts';
import {ThoughtInsertionPreview} from './ink/ThoughtInsertionPreview.tsx';
import {ThoughtChat} from './ink/ThoughtChat.tsx';
import {previewThoughtInsertion} from '../shared/thoughts.ts';
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
  const [treeCollapsed,setTreeCollapsed]=useState(false);
  const [treePersistence,setTreePersistence]=useState(false);
  const [treeNotice,setTreeNotice]=useState(false);
  const [theme,setTheme]=useState<'system'|'light'|'dark'>('system');
  const [typingHelpOn,setTypingHelpOn]=useState(true),[doubleSpacePeriod,setDoubleSpacePeriod]=useState(true);
  useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
  const chooseTheme=(value:'system'|'light'|'dark')=>{setTheme(value);if(!treePersistence)setTreeNotice(true);};
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
  const [showProps, setShowProps] = useState(true);
  const [rightTab, setRightTab] = useState<"details" | "activity">("details");
  const [notice, setNotice] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState<null | { file: string; line: string }>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const panes = useRef(new Map<string, PaneHandle>());
  const listeners = useRef(new Set<(e: ServerEvent) => void>());
  const loaded = useRef(false);
  useEffect(()=>{const open=(event:Event)=>{const detail=(event as CustomEvent<{id:string;thought?:boolean}>).detail;setThreadId(detail.id);setThoughtChat(detail.id);};window.addEventListener('open-thread',open);return()=>window.removeEventListener('open-thread',open);},[]);

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
        const [t, ui, persistence] = await Promise.all([api.tree(), api.uiState(),api.uiStatePersistence().catch(()=>({enabled:false}))]);
        setTreeCollapsed(ui.treeCollapsed??false);setConfirmAdd(ui.confirmAdd??false);setTreePersistence(persistence.enabled);
        if(persistence.enabled){setTheme(ui.theme??'system');setTypingHelpOn(ui.typingHelp??true);setDoubleSpacePeriod(ui.doubleSpacePeriod??true);}
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
    const t = setTimeout(() => void api.putUiState({ v: 1, tabs, active, ...(treePersistence?{treeCollapsed,theme,confirmAdd,typingHelp:typingHelpOn,doubleSpacePeriod}:{}) }).catch(() => {if(treePersistence){setTreePersistence(false);setTreeNotice(true);}}), 300);
    return () => clearTimeout(t);
  }, [tabs, active, treeCollapsed,treePersistence,theme,confirmAdd,typingHelpOn,doubleSpacePeriod]);

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
      {id:'tree',label:treeCollapsed?'Expand file tree':'Collapse file tree',group:'Workspace',run:()=>{setTreeCollapsed(v=>!v);if(!treePersistence)setTreeNotice(true);}},
      {id:'typing-help',label:`Typing help: ${typingHelpOn?'On':'Off'}`,group:'Typing',run:()=>{setTypingHelpOn(v=>!v);if(!treePersistence)setTreeNotice(true);}},
      {id:'double-space',label:`Double-space period: ${doubleSpacePeriod?'On':'Off'}`,group:'Typing',run:()=>{setDoubleSpacePeriod(v=>!v);if(!treePersistence)setTreeNotice(true);}},
      ...(['system','light','dark'] as const).map(value=>({id:`theme:${value}`,label:`Theme: ${value[0].toUpperCase()+value.slice(1)}`,group:'Appearance',run:()=>chooseTheme(value)})),
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
    return list.map(item=>({...item,group:item.group??(['open','props','save','reload'].includes(item.id)?'Workspace':'Formatting')}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, showProps,paths,treeCollapsed,treePersistence,openNote,confirmAdd,typingHelpOn,doubleSpacePeriod]);

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
    <div className={`app${treeCollapsed?' tree-collapsed':''}`}>
      <header className="topbar">
        <button className="ghost tree-toggle" aria-label={treeCollapsed?'Expand file tree':'Collapse file tree'} aria-controls="note-tree" aria-expanded={!treeCollapsed} onClick={()=>{setTreeCollapsed(v=>!v);if(!treePersistence)setTreeNotice(true);}} title={treeCollapsed?'Expand file tree':'Collapse file tree'}>☰</button>
        <Tabs tabs={tabs} active={active} status={status} onSelect={setActive} onClose={(p) => void closeTab(p)} />
        <span className="spacer" />
        <select className="theme-toggle" aria-label="Theme" value={theme} onChange={e=>chooseTheme(e.target.value as typeof theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
        <button className="ghost" onClick={() => setOverlay("palette")} title="Command palette (Ctrl+K; Ctrl+P)">
          Commands
        </button>
      </header>
      <aside id="note-tree" className="sidebar" aria-label="Notes" hidden={treeCollapsed}>
        <div className="side-title" title={boot.rootPath}>{boot.rootName}</div>
        <Tree tree={tree} active={active} onOpen={(p) => void openNote(p)} />
      </aside>
      <main className="editor-col">
        {treeNotice&&<div className="notice" role="note">File tree and theme preferences stay in memory until ignore coverage for <code>/ui-state.json*</code> is verified.
          <button onClick={async()=>{try{const s=await api.enableThreadDrafts();setTreePersistence(s.enabled);setTreeNotice(!s.enabled);}catch{setNotice('Could not verify UI state ignore coverage. The file tree preference remains in memory.');}}}>Add /ui-state.json* to root .gitignore</button>
          <button onClick={()=>setTreeNotice(false)}>Dismiss tree preference notice</button>
        </div>}
        <ChatGPTSettings/>
        <UsagePanel/>
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
            <EditorPane key={p} file={files[p]} visible={p === active} resolver={resolver} onOpenWiki={onOpenWiki} onStatus={onStatus} onDoc={onDoc} subscribe={subscribe} register={register}
              inkItems={inkFiles[p]?.document.items} trustedText={p === active ? trustedText : null}
              typingOptions={{enabled:typingHelpOn,doubleSpace:doubleSpacePeriod}}
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
          {rightTab==='activity'&&insertPreview&&<section className="attach-preview" aria-label="Review takeaway insertion"><h2>Insert your takeaway</h2><p>This adds only your submitted text through the editor. Undo works normally.</p><pre>{insertPreview.preview.changes.insert}</pre><button onClick={()=>void applyInsert()}>Insert my takeaway</button><button onClick={()=>setInsertPreview(null)}>Cancel insertion</button></section>}
          {rightTab === "activity" && attachDraft && <section className="attach-preview" aria-label="Review re-attachment">
            <h2>Review re-attachment</h2>
            <div className="small muted">Old quote</div><blockquote>{attachDraft.quote}</blockquote>
            <div className="small muted">New selected text</div><blockquote>{attachDraft.target}</blockquote>
            <div className="attach-actions"><button onClick={() => void saveAttach()}>Save re-attachment</button><button onClick={() => setAttachDraft(null)}>Cancel</button></div>
          </section>}
        </aside>
      )}
      {toast&&<div className="thought-toast" role="status"><span>{toast.text}</span><button onClick={()=>void thoughtAction(toast.id,toast.undo)}>Undo</button><button aria-label="Close notice" onClick={()=>setToast(null)}>Close</button></div>}
      {added&&<div className="thought-toast" role="status"><span>{added.text} · Undo (Ctrl+Z)</span><details className="added-detail"><summary>What was added</summary><pre>{added.detail}</pre></details><button onClick={()=>{const h=active?panes.current.get(active):undefined;if(h){undo(h.view);h.view.focus();}setAdded(null);}}>Undo</button><button aria-label="Close notice" onClick={()=>setAdded(null)}>Close</button></div>}
      {showDismissed&&<DismissedThoughts items={activeItems} restore={id=>void thoughtAction(id,'restore')} close={()=>setShowDismissed(false)}/>}
      {active&&thoughtChat&&<ThoughtChat id={thoughtChat} close={()=>setThoughtChat(null)}><ThreadPanel path={active} items={activeItems} version={currentInk?.version??null} saved={s=>onInkSaved(active,s)} insert={async item=>{await prepareInsert(item);setShowProps(true);setRightTab('activity');}} openId={thoughtChat} onOpen={id=>{setThoughtChat(id);setThreadId(id);}} visible/></ThoughtChat>}
      {bringPreview&&<ThoughtInsertionPreview text={bringPreview.preview.changes.insert} insert={()=>void bringThought()} cancel={()=>setBringPreview(null)}/>}
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
