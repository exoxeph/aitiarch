import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Autolink, Strikethrough, TaskList, Table } from '@lezer/markdown';
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { citeEnv, type CiteEnv } from "../citations/cite-env.ts";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import type { InkItem } from "../../shared/ink.ts";
import {BLOB_RESERVE,layoutThoughts,thoughtSide,thoughtVisible} from '../../shared/thoughts.ts';
import { MarginRail, type PlacedMargin } from "../ink/MarginRail.tsx";
import { api, ApiError, type InkSnapshot, type NoteFile, type ServerEvent } from "../api.ts";
import { conflictDecorations, conflictHandlers, conflictsField } from "./conflicts.ts";
import { livePreview, previewHandlers, wikiResolver } from "./livepreview.ts";
import { externalChange, NoteSession, type SyncStatus } from "./session.ts";
import { addInk, removeInk, inkField, setInk, setThoughtNarrow } from "./ink.ts";
import {codeEditing} from "./code-editing.ts";
import {writingKeys} from "./writing.ts";
import {footnotes} from "./footnotes.ts";
import {clickBelow,writingPrompt} from "./prompts.ts";
import {hiddenMarkers} from "./markers.ts";
import { codeHighlight, codeLanguages } from "./codeblocks.ts";
import { toggleTaskAtCaret } from "./tasks.ts";
import { slashMenu } from "./slash.ts";
import { tablePreview } from "./tables.ts";
import {wordNavigation} from './navigation.ts';
import { invocationHandlers, invokedKeys, formattingKeys, selectionToolbar } from "./toolbar.ts";
import { useInvocations } from "./useInvocations.tsx";
import {typingHelp,type TypingOptions} from './typing-help.ts';
let dictionaryReady:Promise<(word:string)=>string|null>|undefined;
const loadDictionary=()=>dictionaryReady??=import('./load-dictionary.ts').then(module=>module.ready);

export interface PaneHandle {
  view: EditorView;
  session: NoteSession;
}

interface Props {
  typingOptions?:TypingOptions;
  file: NoteFile;
  visible: boolean;
  resolver: (target: string) => string | null;
  onOpenWiki: (target: string) => void;
  /** What @ citations need: which notes exist, how to open and preview one, and the note index for the picker. */
  cite?: Omit<CiteEnv, "from">;
  onStatus: (path: string, s: SyncStatus) => void;
  onDoc: (path: string, text: string) => void;
  subscribe: (fn: (e: ServerEvent) => void) => () => void;
  register: (path: string, h: PaneHandle | null) => void;
  inkItems?: InkItem[];
  trustedText?: string | null;
  inkVersion?: string | null;
  onInk?: (path: string, items: InkItem[]) => void;
  onInkSaved?: (path: string, snapshot: InkSnapshot) => void;
  onInkError?: (message: string) => void;
}

export function EditorPane(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState<PlacedMargin[]>([]);
  const live = useRef(props);
  live.current = props;
  const resolverSlot = useRef(new Compartment());
  const citeSlot = useRef(new Compartment());
  const viewRef = useRef<EditorView | null>(null);
  const inkVersionRef = useRef(props.inkVersion ?? null);
  const knownIds = useRef(new Set((props.inkItems ?? []).map(i => i.id)));
  const sessionRef = useRef<NoteSession | null>(null);
  const dictionaryRef=useRef<((word:string)=>string|null)|undefined>(undefined);
  useEffect(()=>{const el=host.current;if(!el)return;const warm=()=>{if(live.current.typingOptions?.smart===false||dictionaryRef.current)return;void loadDictionary().then(correct=>{dictionaryRef.current=correct;el.dataset.smartReady='true';}).catch(()=>{});};el.addEventListener('keydown',warm);return()=>el.removeEventListener('keydown',warm);},[]);
  const invoked = useInvocations(props.file.path, viewRef, sessionRef, snapshot => {
    inkVersionRef.current = snapshot.version;
    knownIds.current = new Set(snapshot.document.items.map(i => i.id));
    live.current.onInkSaved?.(props.file.path, snapshot);
  });
  const invokeRef = useRef(invoked.begin); invokeRef.current = invoked.begin;
  // While a question or review is open in its blob, the format toolbar would sit on top of it, so it is hidden meanwhile.
  useEffect(() => { surface.current?.toggleAttribute('data-asking', !!invoked.draftId); }, [invoked.draftId]);
  // Try diagram again (a user click) opens a normal, reviewable Visualize request for the same selection.
  useEffect(() => {
    const again = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id, v = viewRef.current;
      const item = v?.state.field(inkField).items.find((i) => i.id === id);
      if (!v || !item || item.attachment.status !== 'attached') return;
      invokeRef.current('visualize', { text: v.state.doc.toString(), from: item.attachment.from, to: item.attachment.to });
    };
    window.addEventListener('visualize-again', again);
    return () => window.removeEventListener('visualize-again', again);
  }, []);

  useEffect(() => {
    const path = props.file.path;
    let session!: NoteSession;
    let checkpointing: Promise<void> = Promise.resolve();
    let lastCheckpoint = "";
    async function checkpoint(noteVersion: string, items: InkItem[]) {
      items = items.filter(i => knownIds.current.has(i.id));
      if (!items.length) return;
      const key = JSON.stringify([noteVersion, items.map(({ id, anchor, attachment }) => ({ id, anchor, attachment }))]);
      if (key === lastCheckpoint) return;
      const job = checkpointing.catch(() => {}).then(async () => {
        if(key===lastCheckpoint)return;
        let updates = items;
        for (let attempt = 0; ; attempt++) {
          try {
            const snapshot = await api.checkpointInk({ path, inkVersion: inkVersionRef.current, noteVersion, items: updates });
            inkVersionRef.current = snapshot.version;
            lastCheckpoint = key;
            live.current.onInkSaved?.(path, snapshot);
            return;
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 409 || attempt >= 7) throw e;
            await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)));
            // A completion may have changed only body/metadata or appended a
            // second request. Merge mappings, never replace those new fields.
            const latest = await api.ink(path);
            if (latest.document.noteVersion !== noteVersion) { if(session.base.version!==noteVersion)return;throw e; }
            inkVersionRef.current = latest.version;
            updates = latest.document.items.map(i => items.find(u => u.id === i.id) ?? i);
          }
        }
      });
      checkpointing = job;
      await job.catch(() => live.current.onInkError?.("Ink mapping could not be saved. Its sidecar is preserved; reload may use strict search."));
    }
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.file.text,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          wordNavigation,
          markdown({ extensions: [Strikethrough, TaskList, Autolink, Table], codeLanguages, addKeymap: false }), // the stock markdown keymap is off; writing.ts provides the list, quote and callout behaviour on Enter, Backspace and Tab
          codeEditing,
          writingKeys, // Enter, Backspace and Tab in lists, checklists, quotes and callouts (each is a key you pressed; see writing.ts)
          typingHelp(()=>{const options=live.current.typingOptions??{enabled:true,doubleSpace:true};return {...options,dictionary:options.vocabulary?dictionaryRef.current:undefined};}),
          invokedKeys,
          formattingKeys,
          keymap.of([
            { key: "Mod-Alt-Enter", run: toggleTaskAtCaret },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          conflictsField,
          inkField,
          conflictDecorations,
          conflictHandlers.of({ resolve: (id, choice) => session.resolve(id, choice) }),
          previewHandlers.of({ openWiki: (t) => live.current.onOpenWiki(t) }),
          resolverSlot.current.of(wikiResolver.of(props.resolver)),
          citeSlot.current.of(props.cite ? citeEnv.of({ from: props.file.path, ...props.cite }) : []),
          livePreview,
          footnotes,
          writingPrompt,
          clickBelow,
          hiddenMarkers,
          tablePreview,
          codeHighlight,
          slashMenu,
          invocationHandlers.of({ invoke: (action, source) => invokeRef.current(action, source) }),
          selectionToolbar,
          EditorView.contentAttributes.of({ "aria-label": `Editing ${path}`, spellcheck: "true" }),
          EditorView.updateListener.of((u) => {
            const inkChanged = u.transactions.some(t => t.effects.some(e => e.is(setInk) || e.is(addInk) || e.is(removeInk)));
            if (u.docChanged || inkChanged) live.current.onInk?.(path, u.state.field(inkField).items);
            if (u.docChanged || u.viewportChanged || inkChanged || u.transactions.some(t=>t.effects.some(e=>e.is(setThoughtNarrow)))) queueMargin();
            if (inkChanged && session) queueDoc();
            if (!u.docChanged) return;
            if (!u.transactions.some((t) => t.annotation(externalChange))) session.userChanged();
            queueDoc();
          }),
        ],
      }),
    });
    viewRef.current = view;
    session = new NoteSession(view, { save: async (p, b, t) => {
      const items = view.state.field(inkField).items;
      const result = await api.save(p, b, t);
      if (result.ok) await checkpoint(result.version, items);
      return result;
    }, load: (p) => api.load(p) }, path, props.file, {
      onStatus: (s) => live.current.onStatus(path, s),
    });
    live.current.onStatus(path, "saved");
    sessionRef.current = session;
    live.current.register(path, { view, session });

    let raf = 0;
    let marginRaf = 0;
    const tail=document.createElement('div');tail.className='thought-scroll-tail';tail.setAttribute('aria-hidden','true');host.current?.append(tail);
    function queueMargin() {
      if(marginRaf)return;
      marginRaf = requestAnimationFrame(() => {
        marginRaf=0;
        if (!surface.current || !live.current.visible) return;
        const bounds = surface.current.getBoundingClientRect();
        const ink = view.state.field(inkField);
        const narrow=bounds.width<560+BLOB_RESERVE; // the column may shrink to 560px; below that there is no room for a blob on each side
        if(surface.current.dataset.thoughtLayout!==(narrow?'narrow':'wide')){surface.current.dataset.thoughtLayout=narrow?'narrow':'wide';queueMargin();return;}
        if(ink.items.length&&!!ink.narrow!==narrow){view.dispatch({effects:setThoughtNarrow.of(narrow)});return;}
        const rows = narrow?[]:ink.items.filter(thoughtVisible).flatMap(item => {
          const anchor = item.attachment;
          if (anchor.status !== "attached") return [];
          const coords = view.coordsAtPos(anchor.from);
          const scroll=host.current?.scrollTop??0;
          const block=view.lineBlockAt(anchor.from);const anchorTop=coords?.top??view.documentTop+block.top;
          const el=Array.from(surface.current!.querySelectorAll<HTMLElement>('.margin-card')).find(el=>el.dataset.inkId===item.id);
          // The connector is straight and level with the first line of the anchored text. It stops just beside the sentence when
          // nothing else is on that side of the line, and otherwise at the edge of the writing column, so it never crosses text.
          let rightX:number|undefined,leftX:number|undefined;
          if(coords){
           const lineEnd=view.moveToLineBoundary(EditorSelection.cursor(anchor.from),true).head,lineStart=view.moveToLineBoundary(EditorSelection.cursor(anchor.from),false).head;
           const endPos=Math.min(anchor.to,lineEnd),endBox=view.coordsAtPos(endPos,-1);
           if(endBox&&view.state.sliceDoc(endPos,lineEnd).trim()==='')rightX=endBox.right-bounds.left+6;
           if(view.state.sliceDoc(lineStart,anchor.from).trim()==='')leftX=coords.left-bounds.left-6;
          }
          return [{id:item.id,item,target:anchorTop-bounds.top+scroll,side:thoughtSide(item.id),height:el?.getBoundingClientRect().height??160,...(coords?{end:{x:coords.left-bounds.left,lineBottom:coords.bottom-bounds.top,lineMid:(coords.top+coords.bottom)/2-bounds.top,rightX,leftX}}:{})}];
        });
        const scroll=host.current?.scrollTop??0;
        // Inserted diagrams span the whole width, margins included, so the thoughts make room above or below them.
        const blocked=Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-image')).map(fig=>{const r=fig.getBoundingClientRect();return {top:r.top-bounds.top+scroll,bottom:r.bottom-bounds.top+scroll};});
        const placed=layoutThoughts(rows,blocked);
        setMargin(placed.map(p=>({...p,top:p.top-scroll,target:p.target-scroll})));
        const bottom=Math.max(0,...placed.map(p=>p.top+p.height+16));
        tail.style.height=Math.max(0,bottom-view.dom.offsetHeight)+'px';
      });
    }
    function queueDoc() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const text = view.state.doc.toString();
        live.current.onDoc(path, text);
        if (session.status === "saved" && session.base.text === text) void checkpoint(session.base.version, view.state.field(inkField).items);
      });
    }
    live.current.onDoc(path, props.file.text);
    const highlight=(event:Event)=>{
      const mark=(event.target as Element)?.closest<HTMLElement>('[data-thought-anchor]'),id=event.type==='pointerout'?null:mark?.dataset.thoughtAnchor;
      surface.current?.querySelectorAll<HTMLElement>('.margin-card').forEach(el=>el.classList.toggle('thought-active',!!id&&el.dataset.inkId===id));
    };
    host.current?.addEventListener('pointerover',highlight);host.current?.addEventListener('pointerout',highlight);
    surface.current?.addEventListener("thought-size",queueMargin);
    host.current?.addEventListener("scroll", queueMargin, { passive: true });
    const observer = new ResizeObserver(queueMargin);
    if (host.current) observer.observe(host.current);

    const unsub = props.subscribe((e) => {
      if (e.type === "changed" && e.path === path) {
        session.refresh().catch(() => {});
      } else if (e.type === "removed" && e.path === path) session.markMissing();
      else if (e.type === "open") void session.resync().catch(() => {});
    });

    // last-chance save when the tab is hidden or closed (keepalive request survives unload)
    const onHide = () => {
      if (document.visibilityState === "hidden") void session.flush();
    };
    const onPageHide = () => {
      const text = view.state.doc.toString();
      if (text !== session.base.text && session.status !== "conflict" && session.status !== "missing") {
        void api.save(path, session.base.version, text, true);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);

    if (new URLSearchParams(location.search).has("debug")) {
      const w = window as unknown as { __aitiarch?: Record<string, unknown> };
      w.__aitiarch ??= {};
      w.__aitiarch[path] = { view, session };
    }

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      unsub();
      cancelAnimationFrame(raf);
      cancelAnimationFrame(marginRaf);
      host.current?.removeEventListener('pointerover',highlight);host.current?.removeEventListener('pointerout',highlight);
      surface.current?.removeEventListener("thought-size",queueMargin);tail.remove();
      host.current?.removeEventListener("scroll", queueMargin);
      observer.disconnect();
      void session.flush().finally(() => session.dispose());
      live.current.register(path, null);
      view.destroy();
      viewRef.current = null;
      sessionRef.current = null;
    };
    // The pane is keyed by path; props.file is only the initial content for this editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: resolverSlot.current.reconfigure(wikiResolver.of(props.resolver)) });
  }, [props.resolver]);
  // A new note list (or open handler) gives the pane a fresh citation environment, so chips and the picker see the current notes.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: citeSlot.current.reconfigure(props.cite ? citeEnv.of({ from: props.file.path, ...props.cite }) : []) });
  }, [props.cite, props.file.path]);

  useEffect(() => {
    if (props.visible) viewRef.current?.focus();
  }, [props.visible]);

  useEffect(() => {
    knownIds.current = new Set((props.inkItems ?? []).map(i => i.id));
    if (props.trustedText != null && props.inkVersion !== undefined) inkVersionRef.current = props.inkVersion;
    viewRef.current?.dispatch({ effects: setInk.of({ items: props.inkItems ?? [], trustedText: props.trustedText ?? null }) });
  }, [props.inkItems, props.trustedText, props.inkVersion]);

  return <div className={props.visible ? "ink-surface" : "ink-surface surface-hidden"} ref={surface} data-note-path={props.file.path}>
    {invoked.panel}
    {invoked.draftSection&&!margin.some(m=>m.item.id===invoked.draftId)&&<div className="invocation-panel">{invoked.draftSection}</div>}
    <div className="pane" ref={host} data-path={props.file.path} />
    <MarginRail placed={margin} renderDraft={id=>id===invoked.draftId?invoked.draftSection:null} />
  </div>;
}
