import {transient} from '../transient.ts';
// Formatting remains human-only. Invoked AI freezes the selection without editing it.
import { EditorSelection, Facet, Prec, type TransactionSpec } from "@codemirror/state";
import { keymap, ViewPlugin, type EditorView, type TooltipView, type ViewUpdate } from "@codemirror/view";
import {placeToolbar} from './toolbar-placement.ts';
import { failedMarkAt, markFailed, restoreFailed, setHeading, toggleInline, toggleList } from "./format.ts";

export type SelectedSource = { text: string; from: number; to: number };
export type InvokeAction = "think" | "ask" | "visualize";
export const invocationHandlers = Facet.define<{ invoke: (action: InvokeAction, source: SelectedSource) => void }, { invoke: (action: InvokeAction, source: SelectedSource) => void } | null>({ combine: values => values[0] ?? null });
/** Start Think, Ask or Visualize on the current selection (toolbar, shortcut and command palette all use this). */
export function invokeSelection(view: EditorView, action: InvokeAction) { return invoke(view, action); }
function invoke(view: EditorView, action: InvokeAction) {
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
  dom.className = "cm-tooltip cm-sel-toolbar cm-sel-toolbar-compact";
  dom.setAttribute("role", "toolbar");
  dom.dataset.tour = "selection";
  dom.setAttribute("aria-label", "Format selection");
  dom.setAttribute("aria-keyshortcuts", "Alt+F10");
  let reasonMode = false;
  const controls = () => Array.from(dom.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button:not(:disabled), select'));
  dom.addEventListener("keydown", e => {
    if (reasonMode) return;
    const items = controls(), index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); view.focus(); }
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) && !(document.activeElement instanceof HTMLSelectElement)) {
      e.preventDefault();
      const next = e.key === "Home" || (e.ctrlKey&&e.key==='ArrowLeft') ? 0 : e.key === "End" || (e.ctrlKey&&e.key==='ArrowRight') ? items.length - 1 : (index + (["ArrowRight","ArrowDown"].includes(e.key) ? 1 : -1) + items.length) % items.length;
      items.forEach((item, i) => item.tabIndex = i === next ? 0 : -1);
      items[next]?.focus();
    }
  });

  const apply = (spec: TransactionSpec | null) => {
    if (spec) view.dispatch(spec);
    view.focus();
  };
  const button = (label: string, title: string, fn: () => void, extra = "", disabled = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label',label.length>2?label:title);
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
  const menu = (title: string, choices: [string, () => void][]) => {
    const select = document.createElement("select");
    select.title = title; select.setAttribute("aria-label", title);
    select.add(new Option(title, ""));
    choices.forEach(([label], i) => select.add(new Option(label, String(i))));
    select.addEventListener("change", () => { const i = Number(select.value); select.value = ""; choices[i]?.[1](); });
    return select;
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
      : button("Mark as failed\u2026", multiLine ? "Select one line to record a failed decision and your reason" : "Record a failed decision; you write the reason", () => {
          reasonMode = true;
          render();
        }, "failed-btn", multiLine);
    dom.replaceChildren(
      row(menu("Text style", [0, 1, 2, 3].map(n => [n ? `Heading ${n}` : "Plain paragraph", () => apply(setHeading(view.state, n))]))),
      row(button('Bullets','Bulleted list',()=>apply(toggleList(view.state,'bullet'))),button('Numbers','Numbered list',()=>apply(toggleList(view.state,'ordered')))),
      row(
        button("B", "Bold (Ctrl+B)", () => apply(toggleInline(view.state, "**")), "b"),
        button("I", "Italic (Ctrl+I)", () => apply(toggleInline(view.state, "*")), "i"),
        button("S", "Strikethrough (Ctrl+Shift+X)", () => apply(toggleInline(view.state, "~~")), "strike-btn"),
        button("<>", "Inline code", () => apply(toggleInline(view.state, "`"))),
        button("Link", "Link", () => {
          const r = view.state.selection.main, text = view.state.sliceDoc(r.from, r.to);
          apply({ changes: { from: r.from, to: r.to, insert: `[${text}]()` }, selection: EditorSelection.cursor(r.to + 3), userEvent: "input.format" });
        })),
      row(s),
      ...(view.state.facet(invocationHandlers) ? [row(
        button("Think on this", "Think on this (Ctrl+Enter)", () => { invoke(view, "think"); },'primary'),
        button("Ask...", "Ask about the frozen selection", () => { invoke(view, "ask"); },'primary'),
        button("Visualize", "Ask for a diagram of the frozen selection", () => { invoke(view, "visualize"); },'primary'),
      )] : []),
    );
    controls().forEach((item, i) => item.tabIndex = i === 0 ? 0 : -1);
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

const panels=new WeakMap<EditorView,HTMLElement>();
const compactPanel=ViewPlugin.fromClass(class {
 readonly panel:TooltipView;
 readonly pane:Element|null;
 readonly onScroll=()=>this.place();
 dismissed=false;dispose:()=>void;
 constructor(readonly view:EditorView){
  this.pane=view.dom.closest(".pane");this.pane?.addEventListener("scroll",this.onScroll,{passive:true});
  this.panel=create(view);this.panel.dom.hidden=true;panels.set(view,this.panel.dom);
  const surface=view.dom.closest('.ink-surface')??view.dom;
  surface.insertBefore(this.panel.dom,surface.querySelector('.margin-rail'));this.dispose=transient(()=>this.panel.dom,()=>{const focused=this.panel.dom.contains(document.activeElement);this.dismissed=true;this.panel.dom.hidden=true;if(focused)view.focus();},60);this.place();
 }
 update(u:ViewUpdate){if(u.selectionSet||u.docChanged)this.dismissed=false;this.panel.update?.(u);this.place();}
 place(){this.view.requestMeasure({key:this,read:view=>{
  if(this.dismissed||view.state.selection.main.empty)return null;
  const first=view.coordsAtPos(view.state.selection.main.from);if(!first)return null;
  const c=view.contentDOM.getBoundingClientRect(),css=getComputedStyle(view.contentDOM),size=this.panel.dom.getBoundingClientRect();
  const space=toolbarSpace(view),rail=view.dom.closest('.ink-surface')?.querySelector('.margin-rail');
  // The thought blobs live in the same side margins. They are obstacles to slide around, not a reason to leave the margin.
  const obstacles:{left:number;right:number;top:number;bottom:number}[]=[];
  if(rail?.classList.contains('thought-rails')){
   for(const card of rail.querySelectorAll<HTMLElement>('.margin-card')){const r=card.getBoundingClientRect();obstacles.push({left:r.left,right:r.right,top:r.top,bottom:r.bottom});}
  }else if(rail?.querySelector('.margin-card')&&getComputedStyle(rail).position==='absolute')space.right=Math.min(space.right,rail.getBoundingClientRect().left);
  return placeToolbar({left:c.left+parseFloat(css.paddingLeft),right:c.right-parseFloat(css.paddingRight)},first.top,{width:size.width||268,height:size.height||240},space,obstacles);
 },write:p=>{
  const dom=this.panel.dom,wasHidden=dom.hidden;dom.hidden=this.dismissed||!p;if(dom.hidden||!p)return;
  dom.dataset.placement=p.side;
  Object.assign(dom.style,p.side==='below'?{position:'relative',left:'',top:'',margin:'8px auto'}:{position:'fixed',left:`${p.left}px`,top:`${p.top}px`,margin:'0'});
  if(wasHidden)this.place();
 }});}
 destroy(){this.dispose();this.pane?.removeEventListener("scroll",this.onScroll);this.panel.dom.remove();panels.delete(this.view);}
});

/**
 * In narrow layouts the margin rail is a bar docked at the bottom of the page. The toolbar may float anywhere in the
 * viewport except over it, otherwise it hides the rail's buttons (for example "Re-attach to selected text").
 */
function toolbarSpace(view:EditorView) {
  const area=view.dom.closest('.ink-surface')?.getBoundingClientRect();
  const space = { left: Math.max(0,area?.left??0), top: 0, right: Math.min(window.innerWidth,area?.right??window.innerWidth), bottom: window.innerHeight };
  const pane=view.dom.closest('.pane')?.getBoundingClientRect();
  if(pane){space.top=Math.max(space.top,pane.top+8);space.bottom=Math.min(space.bottom,pane.bottom-8);}
  const rail = document.querySelector(".margin-rail");
  if (rail && getComputedStyle(rail).position === "static") {
    const top = rail.getBoundingClientRect().top;
    if (top > 120) space.bottom = Math.min(space.bottom, top);
  }
  return space;
}

export const selectionToolbar = [compactPanel, Prec.highest(keymap.of([{
  key: "Alt-F10", run: view => {
    if (view.state.selection.main.empty) return false;
    panels.get(view)?.querySelector<HTMLElement>('button')?.focus();
    return true;
  },
}]))];
