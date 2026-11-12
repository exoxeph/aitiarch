// Tells the CSS how focus arrived. A contenteditable always matches :focus-visible, even after a mouse click, so the editor cannot use it to
// tell a click from Tab. <html data-input="keyboard"> is set by Tab or Shift+Tab, "pointer" by any mouse, pen or touch press; nothing is
// set until one of them happens, so focus given by the app (opening a note, selecting text from code) draws no ring either.
export function watchInputModality(doc: Document = document) {
  const set = (mode: "keyboard" | "pointer") => { if (doc.documentElement.dataset.input !== mode) doc.documentElement.dataset.input = mode; };
  doc.addEventListener("pointerdown", () => set("pointer"), true);
  doc.addEventListener("keydown", (e) => { if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) set("keyboard"); }, true);
}
