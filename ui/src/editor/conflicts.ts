// Conflict state + the inline marker shown on a paragraph that changed on disk while you were editing it.
// While any conflict is open, autosave is paused, so nothing on disk is overwritten without your choice.
import { Facet, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

export interface ConflictInfo {
  id: string;
  from: number; // your version of the paragraph, in current document coordinates
  to: number;
  theirs: string; // what is on disk for the same paragraph
}

export const addConflicts = StateEffect.define<ConflictInfo[]>();
export const removeConflict = StateEffect.define<string>();

export const conflictsField = StateField.define<ConflictInfo[]>({
  create: () => [],
  update(value, tr) {
    let out = tr.docChanged ? value.map((c) => ({ ...c, from: tr.changes.mapPos(c.from, -1), to: tr.changes.mapPos(c.to, 1) })) : value;
    for (const e of tr.effects) {
      if (e.is(addConflicts)) out = out.concat(e.value);
      else if (e.is(removeConflict)) out = out.filter((c) => c.id !== e.value);
    }
    return out;
  },
});

export interface ConflictHandlers {
  resolve(id: string, choice: "mine" | "theirs"): void;
}
export const conflictHandlers = Facet.define<ConflictHandlers, ConflictHandlers | null>({ combine: (v) => v[0] ?? null });

export interface Piece {
  text: string;
  changed: boolean;
}

/**
 * Word-level comparison for display only: the words both versions share at the start and the end stay plain, and the
 * words in between are marked as changed. Whitespace is kept so joining the pieces gives the original text back.
 */
export function markChanged(a: string, b: string): { a: Piece[]; b: Piece[] } {
  const split = (s: string) => s.match(/\s+|\S+/g) ?? [];
  const x = split(a);
  const y = split(b);
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const build = (w: string[]): Piece[] => {
    const out: Piece[] = [];
    const push = (text: string, changed: boolean) => {
      if (!text) return;
      const last = out[out.length - 1];
      if (last && last.changed === changed) last.text += text;
      else out.push({ text, changed });
    };
    push(w.slice(0, head).join(""), false);
    push(w.slice(head, w.length - tail).join(""), true);
    push(w.slice(w.length - tail).join(""), false);
    return out;
  };
  return { a: build(x), b: build(y) };
}

class ConflictWidget extends WidgetType {
  constructor(
    private info: ConflictInfo,
    private yours: string,
  ) {
    super();
  }
  eq(o: ConflictWidget) {
    return o.info.id === this.info.id && o.info.theirs === this.info.theirs && o.yours === this.yours;
  }
  toDOM(view: EditorView) {
    const h = view.state.facet(conflictHandlers);
    const wrap = document.createElement("div");
    wrap.className = "cm-conflict";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Edit conflict");
    const msg = document.createElement("div");
    msg.className = "cm-conflict-msg";
    msg.textContent = "This paragraph changed on disk while you were editing it. Saving is paused until you choose.";

    const removed = this.info.theirs === "";
    const diff = markChanged(this.yours, this.info.theirs);
    const block = (kind: "yours" | "disk", label: string, pieces: Piece[], empty?: string) => {
      const el = document.createElement("div");
      el.className = `cm-conflict-block cm-conflict-${kind}`;
      const tag = document.createElement("span");
      tag.className = "cm-conflict-label";
      tag.textContent = label;
      const body = document.createElement("p");
      body.className = "cm-conflict-text";
      if (empty) body.textContent = empty;
      else
        for (const p of pieces) {
          if (p.changed) {
            const m = document.createElement("mark");
            m.textContent = p.text;
            body.append(m);
          } else body.append(p.text);
        }
      el.append(tag, body);
      return el;
    };
    const row = document.createElement("div");
    row.className = "cm-conflict-actions";
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", fn);
      row.appendChild(b);
    };
    mk("Keep mine", () => h?.resolve(this.info.id, "mine"));
    mk("Take theirs", () => h?.resolve(this.info.id, "theirs"));
    wrap.append(
      msg,
      block("yours", "Yours", diff.a),
      block("disk", "On disk", diff.b, removed ? "(this paragraph was removed on disk)" : undefined),
      row,
    );
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

// Both versions are always shown, so the old "View both" toggle is gone. "Yours" is a live copy of the paragraph below.
export const conflictDecorations = EditorView.decorations.compute(["doc", conflictsField], (state) => {
  const list = state.field(conflictsField);
  if (!list.length) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  for (const c of list) {
    const yours = state.sliceDoc(Math.max(0, c.from), Math.min(state.doc.length, c.to));
    ranges.push(Decoration.widget({ widget: new ConflictWidget(c, yours), block: true, side: -1 }).range(c.from));
    if (c.to > c.from) ranges.push(Decoration.mark({ class: "cm-conflict-range" }).range(c.from, c.to));
  }
  return Decoration.set(ranges, true);
});
