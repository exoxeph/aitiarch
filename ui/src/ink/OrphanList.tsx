import { suggestAnchorCandidates } from "../../shared/anchors.ts";
import type { InkItem } from "../../shared/ink.ts";

export function OrphanList({ text, items, onPick, onSelect }: {
  text: string;
  items: InkItem[];
  onPick: (item: InkItem, from: number, to: number) => void;
  onSelect: (item: InkItem) => void;
}) {
  const orphaned = items.filter(i => i.attachment.status === "orphaned");
  return <section className="orphan-list" aria-label="Orphaned ink">
    <h2>Orphaned ink <span>{orphaned.length}</span></h2>
    {orphaned.length === 0 && <p className="muted small">No orphaned ink in this note.</p>}
    {orphaned.map(item => {
      const choices = suggestAnchorCandidates(text, item.anchor);
      return <article className="orphan-card" key={item.id} data-ink-id={item.id}>
        <div className="orphan-cap">{item.kind === "answer" ? "Inline answer" : "Margin note"} · {item.attachment.status === "orphaned" ? item.attachment.reason : ""}</div>
        <div className="orphan-body">{item.body}</div>
        <blockquote>{item.anchor.quote}</blockquote>
        {choices.length ? <div className="orphan-choices">
          {choices.map((c, n) => <button key={`${c.from}-${c.to}`} onClick={() => onPick(item, c.from, c.to)}
            title={text.slice(c.from, c.to)}>{`Attach here? ${n + 1}: ${text.slice(c.from, c.to).slice(0, 45)}`}</button>)}
        </div> : <button onClick={() => onSelect(item)}>Re-attach to selected text</button>}
      </article>;
    })}
  </section>;
}
