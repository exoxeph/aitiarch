import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Autolink, Strikethrough, TaskList, Table } from '@lezer/markdown';
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import type { InkItem } from "../../shared/ink.ts";
import { MarginRail, type PlacedMargin } from "../ink/MarginRail.tsx";
import { api, ApiError, type InkSnapshot, type NoteFile, type ServerEvent } from "../api.ts";
import { conflictDecorations, conflictHandlers, conflictsField } from "./conflicts.ts";
import { livePreview, previewHandlers, wikiResolver } from "./livepreview.ts";
import { externalChange, NoteSession, type SyncStatus } from "./session.ts";
import { addInk, removeInk, inkField, setInk } from "./ink.ts";
import { codeHighlight, codeLanguages } from "./codeblocks.ts";
import { toggleTaskAtCaret } from "./tasks.ts";
import { slashMenu } from "./slash.ts";
import { tablePreview } from "./tables.ts";
import { invocationHandlers, invokedKeys, formattingKeys, selectionToolbar } from "./toolbar.ts";
import { useInvocations } from "./useInvocations.tsx";

export interface PaneHandle {
  view: EditorView;
  session: NoteSession;
}

interface Props {
  file: NoteFile;
  visible: boolean;
  resolver: (target: string) => string | null;
  onOpenWiki: (target: string) => void;
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
  const viewRef = useRef<EditorView | null>(null);
  const inkVersionRef = useRef(props.inkVersion ?? null);
  const knownIds = useRef(new Set((props.inkItems ?? []).map(i => i.id)));
  const sessionRef = useRef<NoteSession | null>(null);
  const invoked = useInvocations(props.file.path, viewRef, sessionRef, snapshot => {
    inkVersionRef.current = snapshot.version;
    knownIds.current = new Set(snapshot.document.items.map(i => i.id));
    live.current.onInkSaved?.(props.file.path, snapshot);
  });
  const invokeRef = useRef(invoked.begin); invokeRef.current = invoked.begin;

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
          markdown({ extensions: [Strikethrough, TaskList, Autolink, Table], codeLanguages, addKeymap: false }), // no auto-inserted list markers: the editor never writes text you didn't type
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
          livePreview,
          tablePreview,
          codeHighlight,
          slashMenu,
          invocationHandlers.of({ invoke: (action, source) => invokeRef.current(action, source) }),
          selectionToolbar,
          EditorView.contentAttributes.of({ "aria-label": `Editing ${path}`, spellcheck: "true" }),
          EditorView.updateListener.of((u) => {
            const inkChanged = u.transactions.some(t => t.effects.some(e => e.is(setInk) || e.is(addInk) || e.is(removeInk)));
            if (u.docChanged || inkChanged) live.current.onInk?.(path, u.state.field(inkField).items);
            if (u.docChanged || u.viewportChanged || inkChanged) queueMargin();
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
    function queueMargin() {
      cancelAnimationFrame(marginRaf);
      marginRaf = requestAnimationFrame(() => {
        if (!surface.current || !live.current.visible) return;
        const bounds = surface.current.getBoundingClientRect();
        const ink = view.state.field(inkField);
        const rows = ink.items.filter(i => i.kind === "margin").flatMap(item => {
          const anchor = item.attachment;
          if (anchor.status !== "attached") return [];
          const coords = view.coordsAtPos(anchor.from);
          return coords ? [{ item, top: Math.max(8, coords.top - bounds.top) }] : [];
        }).sort((a, b) => a.top - b.top);
        let next = 8;
        setMargin(rows.map(row => { const top = Math.max(row.top, next); next = top + 90; return { ...row, top }; }));
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
    <div className="pane" ref={host} data-path={props.file.path} />
    <MarginRail placed={margin} />
  </div>;
}
