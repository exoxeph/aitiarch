import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { failedMarkAt, findFailedMarks, indentLines, markFailed, restoreFailed, setHeading, toggleCodeBlock, toggleInline, toggleList, validateReason } from "../src/editor/format.ts";
import {keymap,type EditorView} from '@codemirror/view';
import {formattingKeys} from '../src/editor/toolbar.ts';
import {decode,encode} from '../server/codec.ts';

const mk = (doc: string, anchor: number, head = anchor) => EditorState.create({ doc, selection: { anchor, head } });
const run = (st: EditorState, spec: TransactionSpec | null) => (spec ? st.update(spec).state : st);
const sel = (doc: string, s: string) => {
  const i = doc.indexOf(s);
  return mk(doc, i, i + s.length);
};

describe("inline formatting", () => {
  it.each([['Mod-b','**'],['Mod-i','*'],['Mod-Shift-x','~~']])('shortcut %s applies and removes only markers with byte-exact CRLF/BOM/mixed endings',(key,marker)=>{
    const bytes=Buffer.from('\uFEFF# Original\r\n\r\nKeep word here.\r\nTail\nUntouched\r');const decoded=decode(bytes),from=decoded.text.indexOf('word');
    let state=EditorState.create({doc:decoded.text,selection:{anchor:from,head:from+4},extensions:[formattingKeys]});
    const host={get state(){return state;},dispatch(spec:TransactionSpec){state=state.update(spec).state;}} as EditorView;
    const binding=state.facet(keymap).flat().find(b=>b.key===key);expect(binding).toBeDefined();
    expect(binding!.run!(host)).toBe(true);expect(state.doc.toString()).toContain(marker+'word'+marker);expect(state.doc.toString()).not.toContain('{failed:');
    expect(binding!.run!(host)).toBe(true);expect(encode(state.doc.toString(),decoded)).toEqual(bytes);
  });
  it("bold wraps then unwraps (selection kept on the word)", () => {
    let st = sel("say hello there", "hello");
    st = run(st, toggleInline(st, "**"));
    expect(st.doc.toString()).toBe("say **hello** there");
    expect(st.sliceDoc(st.selection.main.from, st.selection.main.to)).toBe("hello");
    st = run(st, toggleInline(st, "**"));
    expect(st.doc.toString()).toBe("say hello there");
  });
  it("italic does not mistake bold's ** for its own marker", () => {
    let st = sel("a **bold** b", "bold");
    st = run(st, toggleInline(st, "*"));
    expect(st.doc.toString()).toBe("a ***bold*** b");
  });
  it("code and surrounding spaces in the selection are trimmed, not wrapped", () => {
    let st = mk("x  word  y", 1, 9);
    st = run(st, toggleInline(st, "`"));
    expect(st.doc.toString()).toBe("x  `word`  y");
  });
  it("does nothing with an empty selection", () => {
    expect(toggleInline(mk("abc", 1), "**")).toBeNull();
  });
});

describe("block formatting", () => {
  it("heading levels apply, switch, and toggle off", () => {
    let st = mk("Title line\nnext", 3);
    st = run(st, setHeading(st, 2));
    expect(st.doc.toString()).toBe("## Title line\nnext");
    st = run(st, setHeading(st, 3));
    expect(st.doc.toString()).toBe("### Title line\nnext");
    st = run(st, setHeading(st, 3));
    expect(st.doc.toString()).toBe("Title line\nnext");
  });
  it("bullet and numbered lists toggle across several lines and skip blank lines", () => {
    let st = mk("one\ntwo\n\nthree", 0, 14);
    st = run(st, toggleList(st, "bullet"));
    expect(st.doc.toString()).toBe("- one\n- two\n\n- three");
    st = run(st, toggleList(st, "ordered"));
    expect(st.doc.toString()).toBe("1. one\n2. two\n\n3. three");
    st = run(st, toggleList(st, "ordered"));
    expect(st.doc.toString()).toBe("one\ntwo\n\nthree");
  });
  it("indent adds two spaces to non-blank lines only", () => {
    const st = mk("a\n\nb", 0, 4);
    expect(run(st, indentLines(st)).doc.toString()).toBe("  a\n\n  b");
  });
  it("code block fences the selected lines and unfences them again", () => {
    let st = mk("before\ncode here\nafter", 8, 12);
    st = run(st, toggleCodeBlock(st));
    expect(st.doc.toString()).toBe("before\n```\ncode here\n```\nafter");
    st = mk(st.doc.toString(), 12);
    st = run(st, toggleCodeBlock(st));
    expect(st.doc.toString()).toBe("before\ncode here\nafter");
  });
  it("fuzz: no operation ever changes text outside the lines/selection it was applied to", () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const doc = "alpha beta\ngamma delta\n\nepsilon zeta\neta theta";
    for (let i = 0; i < 300; i++) {
      const a = Math.floor(rnd() * doc.length);
      const b = Math.min(doc.length, a + Math.floor(rnd() * 12));
      const st = mk(doc, a, b);
      const lineA = st.doc.lineAt(a);
      const lineB = st.doc.lineAt(b);
      const out = run(st, [toggleInline(st, "**"), setHeading(st, 2), toggleList(st, "bullet"), indentLines(st)][i % 4]).doc.toString();
      // text before the first affected line and after the last affected line is byte-identical
      expect(out.startsWith(doc.slice(0, lineA.from))).toBe(true);
      expect(out.endsWith(doc.slice(lineB.to))).toBe(true);
    }
  });
});

describe("failed marks", () => {
  it("S with a reason writes ~~text~~ {failed: reason}", () => {
    const st = sel("Use JWT in localStorage today", "JWT in localStorage");
    const r = markFailed(st, "XSS exposure");
    expect("spec" in r && run(st, r.spec).doc.toString()).toBe("Use ~~JWT in localStorage~~ {failed: XSS exposure} today");
  });
  it("“don't know yet” is stored as {failed: ?}", () => {
    const st = sel("Try Redis", "Redis");
    const r = markFailed(st, null);
    expect("spec" in r && run(st, r.spec).doc.toString()).toBe("Try ~~Redis~~ {failed: ?}");
  });
  it("rejects empty reasons, braces, line breaks, multi-line selections and nested strikes", () => {
    const st = sel("one two", "one");
    expect(markFailed(st, "   ")).toHaveProperty("error");
    expect(markFailed(st, "a } b")).toHaveProperty("error");
    expect(markFailed(st, "a\nb")).toHaveProperty("error");
    expect(markFailed(mk("a\nb", 0, 3), "r")).toHaveProperty("error");
    expect(markFailed(sel("~~x~~ y", "~~x~~"), "r")).toHaveProperty("error");
    expect(validateReason("fine, with commas")).toBeNull();
  });
  it("parses marks with a reason, with ?, and without any reason (needs a reason)", () => {
    const m = findFailedMarks("a ~~one~~ {failed: why} b ~~two~~ {failed: ?} c ~~three~~ d");
    expect(m.map((x) => [x.text, x.reason, x.hasBrace])).toEqual([
      ["one", "why", true],
      ["two", "?", true],
      ["three", null, false],
    ]);
  });
  it("restore removes the strike and the reason and keeps the text", () => {
    const doc = "Use ~~JWT~~ {failed: XSS} here";
    const st = mk(doc, doc.indexOf("JWT") + 1);
    expect(failedMarkAt(st, st.selection.main.head)).not.toBeNull();
    expect(run(st, restoreFailed(st)).doc.toString()).toBe("Use JWT here");
    expect(restoreFailed(mk("plain text", 2))).toBeNull();
  });
});
