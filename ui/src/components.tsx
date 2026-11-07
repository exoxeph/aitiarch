import { useEffect, useMemo, useRef, useState } from "react";
import type { EolLabel, TreeNode } from "./api.ts";
import { parseProperties, wordCount } from "./frontmatter.ts";
import type { SyncStatus } from "./editor/session.ts";

export function flattenTree(t: TreeNode | null): string[] {
  if (!t) return [];
  if (t.type === "file") return [t.path];
  return (t.children ?? []).flatMap(flattenTree);
}

export function Tree({ tree, active, onOpen }: { tree: TreeNode | null; active: string | null; onOpen: (p: string) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!tree) return <div className="muted pad">Loading…</div>;
  if (!tree.children?.length) return <div className="muted pad">No notes (.md) in this folder yet.</div>;
  const node = (n: TreeNode, depth: number): React.ReactNode => {
    if (n.type === "file") {
      return (
        <li key={n.path}>
          <button className={`tree-item ${n.path === active ? "on" : ""}`} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onOpen(n.path)} title={n.path}>
            {n.name.replace(/\.md$/i, "")}
          </button>
        </li>
      );
    }
    const closed = collapsed.has(n.path);
    return (
      <li key={n.path}>
        <button
          className="tree-item tree-dir"
          style={{ paddingLeft: 10 + depth * 14 }}
          aria-expanded={!closed}
          onClick={() => setCollapsed((s) => (s.has(n.path) ? new Set([...s].filter((x) => x !== n.path)) : new Set(s).add(n.path)))}
        >
          <span className="caret">{closed ? "▸" : "▾"}</span> {n.name}
        </button>
        {!closed && <ul>{n.children!.map((c) => node(c, depth + 1))}</ul>}
      </li>
    );
  };
  return <ul className="tree">{tree.children.map((c) => node(c, 0))}</ul>;
}

const STATUS_LABEL: Record<SyncStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Conflict: saving paused",
  offline: "Offline: will retry",
  missing: "File missing on disk: saving paused",
  error: "Couldn't save",
};

export function Tabs({
  tabs,
  active,
  status,
  onSelect,
  onClose,
}: {
  tabs: string[];
  active: string | null;
  status: Record<string, SyncStatus>;
  onSelect: (p: string) => void;
  onClose: (p: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((p) => {
        const s = status[p] ?? "saved";
        return (
          <div key={p} className={`tab ${p === active ? "on" : ""}`} role="tab" aria-selected={p === active}>
            <button className="tab-name" onClick={() => onSelect(p)} title={`${p} — ${STATUS_LABEL[s]}`}>
              {p.split("/").pop()!.replace(/\.md$/i, "")}
              {s !== "saved" && <span className={`dot dot-${s}`} aria-label={STATUS_LABEL[s]} />}
            </button>
            <button className="tab-x" onClick={() => onClose(p)} aria-label={`Close ${p}`}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function PropertiesPanel({ text }: { text: string | undefined }) {
  const props = useMemo(() => (text === undefined ? null : parseProperties(text)), [text]);
  return (
    <div className="props">
      <h2>Properties</h2>
      {props === null ? (
        <p className="muted">This note has no frontmatter.</p>
      ) : props.length === 0 ? (
        <p className="muted">Frontmatter is empty.</p>
      ) : (
        <dl>
          {props.map((p, i) => (
            <div key={i} className="prop">
              <dt>{p.key}</dt>
              <dd>{p.value || <span className="muted">—</span>}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="muted small">Read-only in this version.</p>
    </div>
  );
}

export function StatusBar({
  path,
  status,
  text,
  eol,
  bom,
  online,
  rootPath,
}: {
  path: string | null;
  status: SyncStatus | undefined;
  text: string | undefined;
  eol: EolLabel | undefined;
  bom: boolean | undefined;
  online: boolean;
  rootPath: string;
}) {
  const s = status ?? "saved";
  return (
    <>
      <span className={`status status-${s}`} role="status">
        {path ? STATUS_LABEL[s] : "No note open"}
      </span>
      <span className={online ? "live" : "live off"}>{online ? "● Watching for outside edits" : "○ Reconnecting…"}</span>
      <span className="spacer" />
      {path && text !== undefined && <span>{wordCount(text).toLocaleString()} words</span>}
      {path && eol && <span title="Line endings of the file on disk; kept exactly as they are">{eol === "none" ? "" : eol}{bom ? " · BOM" : ""}</span>}
      <span className="muted root" title={rootPath}>
        {rootPath}
      </span>
    </>
  );
}

export function fuzzy(items: string[], q: string): string[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return items;
  const scored: Array<[number, string]> = [];
  for (const it of items) {
    const hay = it.toLowerCase();
    let pos = 0;
    let gaps = 0;
    let ok = true;
    for (const ch of needle) {
      const i = hay.indexOf(ch, pos);
      if (i < 0) {
        ok = false;
        break;
      }
      gaps += i - pos;
      pos = i + 1;
    }
    if (ok) scored.push([gaps + (hay.includes(needle) ? -50 : 0) + hay.length / 100, it]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

export interface OverlayItem {
  id: string;
  label: string;
  hint?: string;
}

export function Overlay({ title, placeholder, items, onPick, onClose }: { title: string; placeholder: string; items: OverlayItem[]; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const shown = useMemo(() => {
    const order = fuzzy(
      items.map((x) => x.label),
      q,
    );
    return order.map((l) => items.find((x) => x.label === l)!).filter(Boolean);
  }, [items, q]);
  useEffect(() => setI(0), [q]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="overlay-box" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setI((x) => Math.min(shown.length - 1, x + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setI((x) => Math.max(0, x - 1)));
            else if (e.key === "Enter" && shown[i]) (e.preventDefault(), onPick(shown[i].id));
            else if (e.key === "Escape") (e.preventDefault(), onClose());
          }}
        />
        <ul role="listbox">
          {shown.slice(0, 50).map((it, n) => (
            <li key={it.id} role="option" aria-selected={n === i} className={n === i ? "on" : ""} onMouseEnter={() => setI(n)} onClick={() => onPick(it.id)}>
              <span>{it.label}</span>
              {it.hint && <span className="muted small">{it.hint}</span>}
            </li>
          ))}
          {shown.length === 0 && <li className="muted">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
