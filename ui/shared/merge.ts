// Three-way merge planning at paragraph granularity.
//   base   = the last version of the file the editor saw (from disk)
//   mine   = what is in the editor now (base + unsaved typing)
//   theirs = the new version on disk (e.g. written by an agent)
// A change on disk is applied silently unless it lands in a paragraph the user has also touched; those
// paragraphs are reported as conflicts and nothing on disk is applied to them.
import { diffText, paragraphSpan, spansIntersect, type Hunk } from "./diff.ts";

export interface MergePlan {
  /** Hunks of base→theirs that are safe to apply (base coordinates). */
  apply: Hunk[];
  /** Conflicting paragraph groups, in base coordinates. */
  conflicts: Array<{ from: number; to: number }>;
}

type Span = [number, number];

function unionSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && spansIntersect(last, s)) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

export function planMerge(base: string, mine: string, theirs: string): MergePlan {
  const local = diffText(base, mine);
  const remote = diffText(base, theirs);
  if (local.length === 0 || remote.length === 0) return { apply: remote, conflicts: [] };

  const localSpans = local.map((h) => paragraphSpan(base, h.from, h.to));
  const remoteSpans = remote.map((h) => paragraphSpan(base, h.from, h.to));
  const conflicting = new Set<number>();
  const groupSeeds: Span[] = [];
  remoteSpans.forEach((rs, j) => {
    const hits = localSpans.filter((ls) => spansIntersect(ls, rs));
    if (hits.length) {
      conflicting.add(j);
      groupSeeds.push(rs, ...hits);
    }
  });
  let groups = unionSpans(groupSeeds);
  for (let changed = true; changed; ) {
    changed = false;
    remoteSpans.forEach((rs, j) => {
      if (!conflicting.has(j) && groups.some((g) => spansIntersect(g, rs))) {
        conflicting.add(j);
        groupSeeds.push(rs);
        changed = true;
      }
    });
    if (changed) groups = unionSpans(groupSeeds);
  }
  return {
    apply: remote.filter((_, j) => !conflicting.has(j)),
    conflicts: groups.map(([from, to]) => ({ from, to })),
  };
}
