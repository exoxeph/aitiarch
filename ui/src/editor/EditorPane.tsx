import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { api, type NoteFile, type ServerEvent } from "../api.ts";
import { conflictDecorations, conflictHandlers, conflictsField } from "./conflicts.ts";
import { toggleInline } from "./format.ts";
import { livePreview, previewHandlers, wikiResolver } from "./livepreview.ts";
import { externalChange, NoteSession, type SyncStatus } from "./session.ts";
import { selectionToolbar } from "./toolbar.ts";

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
}

export function EditorPane(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const resolverSlot = useRef(new Compartment());
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const path = props.file.path;
    let session!: NoteSession;
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.file.text,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ addKeymap: false }), // no auto-inserted list markers: the editor never writes text you didn't type
          keymap.of([
            { key: "Mod-b", run: (v) => (act(v, toggleInline(v.state, "**")), true) },
            { key: "Mod-i", run: (v) => (act(v, toggleInline(v.state, "*")), true) },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          conflictsField,
          conflictDecorations,
          conflictHandlers.of({ resolve: (id, choice) => session.resolve(id, choice) }),
          previewHandlers.of({ openWiki: (t) => live.current.onOpenWiki(t) }),
          resolverSlot.current.of(wikiResolver.of(props.resolver)),
          livePreview,
          selectionToolbar,
          EditorView.contentAttributes.of({ "aria-label": `Editing ${path}`, spellcheck: "true" }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            if (!u.transactions.some((t) => t.annotation(externalChange))) session.userChanged();
            queueDoc();
          }),
        ],
      }),
    });
    viewRef.current = view;
    session = new NoteSession(view, { save: (p, b, t) => api.save(p, b, t), load: (p) => api.load(p) }, path, props.file, {
      onStatus: (s) => live.current.onStatus(path, s),
    });
    live.current.onStatus(path, "saved");
    live.current.register(path, { view, session });

    function act(v: EditorView, spec: ReturnType<typeof toggleInline>) {
      if (spec) v.dispatch(spec);
    }
    let raf = 0;
    function queueDoc() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => live.current.onDoc(path, view.state.doc.toString()));
    }
    live.current.onDoc(path, props.file.text);

    const unsub = props.subscribe((e) => {
      if (e.type === "changed" && e.path === path) {
        api.file(path).then((f) => session.applyExternal(f)).catch(() => {});
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
      void session.flush().finally(() => session.dispose());
      live.current.register(path, null);
      view.destroy();
      viewRef.current = null;
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

  return <div className={props.visible ? "pane" : "pane pane-hidden"} ref={host} data-path={props.file.path} />;
}
