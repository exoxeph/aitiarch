// Formatting remains human-only. Invoked AI freezes the selection without editing it.
import { Facet, StateField, type EditorState, type TransactionSpec } from "@codemirror/state";
import { keymap, showTooltip, tooltips, type EditorView, type Tooltip, type TooltipView, type ViewUpdate } from "@codemirror/view";
import { failedMarkAt, indentLines, markFailed, restoreFailed, setHeading, toggleCodeBlock, toggleInline, toggleList } from "./format.ts";

export type SelectedSource = { text: string; from: number; to: number };
export const invocationHandlers = Facet.define<{ invoke: (action: "think" | "ask", source: SelectedSource) => void }, { invoke: (action: "think" | "ask", source: SelectedSource) => void } | null>({ combine: values => values[0] ?? null });
function invoke(view: EditorView, action: "think" | "ask") {
  const handler = view.state.facet(invocationHandlers), range = view.state.selection.main;
  if (!handler || range.empty) return false;
  handler.invoke(action, { text: view.state.doc.toString(), from: range.from, to: range.to });
  return true;
}
export const invokedKeys = keymap.of([{ key: "Mod-Enter", run: view => invoke(view, "think") }]);
export const formattingKeys = keymap.of([
  ...([['Mod-b', '**'], ['Mod-i', '*'], ['Mod-Shift-x', '~~']] as const).map(([key, marker]) => ({
    key, run: (view: EditorView) => { const spec = toggleInline(view.state, marker); if (spec) view.dispatch(spec); return true; },
  })),
]);

function create(view: EditorView): TooltipView {
  const dom = document.createElement("div");
  dom.className = "cm-sel-toolbar";
  dom.setAttribute("role", "toolbar");
  dom.setAttribute("aria-label", "Format selection");
  let reasonMode = false;

  const apply = (spec: TransactionSpec | null) => {
    if (spec) view.dispatch(spec);
    view.focus();
  };
  const button = (label: string, title: string, fn: () => void, extra = "", disabled = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.className = extra;
    b.disabled = disabled;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor selection
    b.addEventListener("click", fn);
    return b;
  };
  const row = (...kids: HTMLElement[]) => {
    const r = document.createElement("div");
    r.className = "cm-sel-row";
    r.append(...kids);
    return r;
  };

  function renderReason() {
    dom.replaceChildren();
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 200;
    input.placeholder = "Why did this fail? (in your words)";
    input.setAttribute("aria-label", "Reason this failed");
    const err = document.createElement("div");
    err.className = "cm-sel-error";
    const submit = (reason: string | null) => {
      const r = markFailed(view.state, reason);
      if ("error" in r) {
        err.textContent = r.error;
        return;
      }
      reasonMode = false;
      apply(r.spec);
    };
    const cancel = () => {
      reasonMode = false;
      render();
      view.focus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit(input.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
      e.stopPropagation();
    });
    dom.append(
      row(input),
      row(button("Mark failed", "Strike through with this reason", () => submit(input.value), "primary"), button("Don't know yet", "Store {failed: ?} — you can add the reason later", () => submit(null)), button("Cancel", "Cancel", cancel)),
      err,
    );
    queueMicrotask(() => input.focus());
  }

  function render() {
    if (reasonMode) return renderReason();
    const sel = view.state.selection.main;
    const multiLine = view.state.doc.lineAt(sel.from).number !== view.state.doc.lineAt(sel.to).number;
    const mark = failedMarkAt(view.state, sel.from, sel.to);
    const s = mark
      ? button("Restore", "Remove the strike-through and its reason", () => apply(restoreFailed(view.state, sel.from)), "failed-btn")
      : button("Failed\u2026", multiLine ? "Select text on one line to mark it failed" : "Mark as failed (strike-through with a reason)", () => {
          reasonMode = true;
          render();
        }, "failed-btn", multiLine);
    dom.replaceChildren(
      ...(view.state.facet(invocationHandlers) ? [row(
        button("Think on this", "Think on this (Ctrl+Enter)", () => { invoke(view, "think"); }),
        button("Ask...", "Ask about the frozen selection", () => { invoke(view, "ask"); }),
      )] : []),
      row(
        button("¶", "Plain paragraph", () => apply(setHeading(view.state, 0))),
        ...[1, 2, 3, 4].map((n) => button(`H${n}`, `Heading ${n}`, () => apply(setHeading(view.state, n)))),
        button("⇥", "Indent", () => apply(indentLines(view.state))),
        button("•", "Bulleted list", () => apply(toggleList(view.state, "bullet"))),
        button("1.", "Numbered list", () => apply(toggleList(view.state, "ordered"))),
      ),
      row(
        button("B", "Bold (Ctrl+B)", () => apply(toggleInline(view.state, "**")), "b"),
        button("I", "Italic (Ctrl+I)", () => apply(toggleInline(view.state, "*")), "i"),
        button("S", "Strikethrough (Ctrl+Shift+X)", () => apply(toggleInline(view.state, "~~")), "failed-btn"),
        s,
        button("<>", "Inline code", () => apply(toggleInline(view.state, "`"))),
        button("{ }", "Code block", () => apply(toggleCodeBlock(view.state))),
      ),
    );
  }

  render();
  return {
    dom,
    update(u: ViewUpdate) {
      if (u.selectionSet || u.docChanged) {
        if (reasonMode && !u.state.selection.main.empty && !u.docChanged) return; // keep the reason box while you type in it
        reasonMode = false;
        render();
      }
    },
  };
}

function toTooltip(state: EditorState): Tooltip | null {
  const r = state.selection.main;
  return r.empty ? null : { pos: r.from, above: true, strictSide: false, arrow: false, create };
}

const toolbarField = StateField.define<Tooltip | null>({
  create: toTooltip,
  update(v, tr) {
    return tr.docChanged || tr.selection ? toTooltip(tr.state) : v;
  },
  provide: (f) => showTooltip.from(f),
});

/**
 * In narrow layouts the margin rail is a bar docked at the bottom of the page. The toolbar may float anywhere in the
 * viewport except over it, otherwise it hides the rail's buttons (for example "Re-attach to selected text").
 */
function toolbarSpace() {
  const space = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const rail = document.querySelector(".margin-rail");
  if (rail && getComputedStyle(rail).position === "static") {
    const top = rail.getBoundingClientRect().top;
    if (top > 120) space.bottom = Math.min(space.bottom, top);
  }
  return space;
}

export const selectionToolbar = [toolbarField, tooltips({ tooltipSpace: toolbarSpace })];
