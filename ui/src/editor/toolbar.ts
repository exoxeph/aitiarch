// Floating selection toolbar (Phase 1: format rows + the S = "failed" mark). The AI rows
// ("Think on this", "Ask…", "Make decision", "Branch") belong to later phases and are not here.
import { StateField, type EditorState, type TransactionSpec } from "@codemirror/state";
import { showTooltip, type EditorView, type Tooltip, type TooltipView, type ViewUpdate } from "@codemirror/view";
import { failedMarkAt, indentLines, markFailed, restoreFailed, setHeading, toggleCodeBlock, toggleInline, toggleList } from "./format.ts";

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
      : button("S", multiLine ? "Select text on one line to mark it failed" : "Mark as failed (strike-through with a reason)", () => {
          reasonMode = true;
          render();
        }, "failed-btn", multiLine);
    dom.replaceChildren(
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
  return r.empty ? null : { pos: r.from, above: true, strictSide: true, arrow: false, create };
}

export const selectionToolbar = StateField.define<Tooltip | null>({
  create: toTooltip,
  update(v, tr) {
    return tr.docChanged || tr.selection ? toTooltip(tr.state) : v;
  },
  provide: (f) => showTooltip.from(f),
});
