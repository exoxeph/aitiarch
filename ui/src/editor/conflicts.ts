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

class ConflictWidget extends WidgetType {
  constructor(private info: ConflictInfo) {
    super();
  }
  eq(o: ConflictWidget) {
    return o.info.id === this.info.id && o.info.theirs === this.info.theirs;
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
    const row = document.createElement("div");
    row.className = "cm-conflict-actions";
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", fn);
      row.appendChild(b);
      return b;
    };
    const both = document.createElement("pre");
    both.className = "cm-conflict-both";
    both.hidden = true;
    both.textContent = this.info.theirs === "" ? "(on disk: this paragraph was removed)" : this.info.theirs;
    mk("Keep mine", () => h?.resolve(this.info.id, "mine"));
    mk("Take theirs", () => h?.resolve(this.info.id, "theirs"));
    const toggle = mk("View both", () => {
      both.hidden = !both.hidden;
      toggle.textContent = both.hidden ? "View both" : "Hide theirs";
    });
    const cap = document.createElement("div");
    cap.className = "cm-conflict-cap";
    cap.textContent = "On disk:";
    cap.hidden = true;
    toggle.addEventListener("click", () => (cap.hidden = both.hidden));
    wrap.append(msg, row, cap, both);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

export const conflictDecorations = EditorView.decorations.from(conflictsField, (list) => {
  const ranges: Range<Decoration>[] = [];
  for (const c of list) {
    ranges.push(Decoration.widget({ widget: new ConflictWidget(c), block: true, side: -1 }).range(c.from));
    if (c.to > c.from) ranges.push(Decoration.mark({ class: "cm-conflict-range" }).range(c.from, c.to));
  }
  return Decoration.set(ranges, true);
});
