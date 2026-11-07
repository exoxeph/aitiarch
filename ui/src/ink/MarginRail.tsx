import type { InkItem } from "../../shared/ink.ts";

export interface PlacedMargin { item: InkItem; top: number }
export function MarginRail({ placed }: { placed: PlacedMargin[] }) {
  return <aside className="margin-rail" aria-label="Margin ink">
    {placed.map(({ item, top }) => <div key={item.id} className="margin-card" style={{ top }} data-ink-id={item.id}>
      <div className="margin-label">AI · margin</div>
      <div>{item.body}</div>
    </div>)}
  </aside>;
}
