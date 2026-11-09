// Slice A: pure reveal rules, gutter markers, autolinks, rule, nested quotes, viewport-only cost, and "decorations never edit".
import { EditorState, EditorSelection, Text } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { TaskList, Strikethrough, Autolink } from "@lezer/markdown";
import { describe, it, expect } from "vitest";
import { buildInline, lineRanges, livePreview } from "../src/editor/livepreview.ts";
import { touchesSpan, touchesLines, hidesFor, quoteMarkGroups, autolinkHides } from "../src/editor/reveal.ts";

const make = (doc: string, anchor = 0, head = anchor) =>
  EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ extensions: [TaskList, Strikethrough, Autolink], addKeymap: false }), livePreview] });
const rows = (s: EditorState, ranges: [number, number][] = [[0, s.doc.length]]) => {
  const out: { from: number; to: number; spec: any }[] = [];
  buildInline(s, ranges, ensureSyntaxTree(s, s.doc.length, 10000)!).between(0, s.doc.length, (from, to, v) => void out.push({ from, to, spec: v.spec }));
  return out;
};
const cls = (s: EditorState, c: string) => rows(s).filter((r) => r.spec.class?.split(" ").includes(c));

describe("touchesSpan (table)", () => {
  const cases: [string, { from: number; to: number }[], number, number, boolean][] = [
    ["caret inside", [{ from: 5, to: 5 }], 3, 8, true],
    ["caret at start edge", [{ from: 3, to: 3 }], 3, 8, true],
    ["caret at end edge", [{ from: 8, to: 8 }], 3, 8, true],
    ["caret just before", [{ from: 2, to: 2 }], 3, 8, false],
    ["caret just after", [{ from: 9, to: 9 }], 3, 8, false],
    ["selection overlaps", [{ from: 6, to: 12 }], 3, 8, true],
    ["selection ends at the start edge", [{ from: 0, to: 3 }], 3, 8, false],
    ["selection starts at the end edge", [{ from: 8, to: 12 }], 3, 8, false],
    ["selection contains span", [{ from: 0, to: 20 }], 3, 8, true],
    ["second range touches", [{ from: 0, to: 0 }, { from: 4, to: 4 }], 3, 8, true],
    ["no ranges", [], 3, 8, false],
  ];
  it.each(cases)("%s", (_n, sel, from, to, want) => expect(touchesSpan(sel, from, to)).toBe(want));
});

describe("touchesLines", () => {
  const lineOf = (p: number) => Math.floor(p / 10) + 1;
  it("any range on any line of the node reveals it", () => {
    expect(touchesLines([{ from: 25, to: 25 }], lineOf, 20, 39)).toBe(true);
    expect(touchesLines([{ from: 5, to: 5 }], lineOf, 20, 39)).toBe(false);
    expect(touchesLines([{ from: 5, to: 45 }], lineOf, 20, 39)).toBe(true);
  });
});

describe("hidesFor", () => {
  const ctx = (at: number) => ({ sel: [{ from: at, to: at }], lineOf: (p: number) => (p < 20 ? 1 : 2), lineEnd: (p: number) => (p < 20 ? 19 : 99) });
  const h2 = { name: "ATXHeading2", from: 20, to: 40, children: [{ name: "HeaderMark", from: 20, to: 22 }, { name: "HeaderMark", from: 38, to: 40 }] };
  it("heading: the leading marker always exists as a gutter mark and says whether it is revealed", () => {
    expect(hidesFor(h2, ctx(0))).toEqual([
      { from: 20, to: 23, kind: "gutter", revealed: false },
      { from: 38, to: 40, kind: "replace", revealed: false },
    ]);
    expect(hidesFor(h2, ctx(25))).toEqual([{ from: 20, to: 23, kind: "gutter", revealed: true }]);
  });
  const strong = { name: "StrongEmphasis", from: 3, to: 12, children: [{ name: "EmphasisMark", from: 3, to: 5 }, { name: "EmphasisMark", from: 10, to: 12 }] };
  it("inline: hides both marks away, none when the caret is inside, edges included", () => {
    expect(hidesFor(strong, ctx(0)).map((h) => [h.from, h.to])).toEqual([[3, 5], [10, 12]]);
    for (const at of [3, 7, 12]) expect(hidesFor(strong, ctx(at))).toEqual([]);
  });
  it("a strike's reveal span can be extended to its {failed: ...} annotation", () => {
    const st = { name: "Strikethrough", from: 0, to: 8, children: [{ name: "StrikethroughMark", from: 0, to: 2 }] };
    expect(hidesFor(st, ctx(15), 30)).toEqual([]);
    expect(hidesFor(st, ctx(15))).toHaveLength(1);
  });
  it("unknown nodes produce nothing", () => expect(hidesFor({ name: "Paragraph", from: 0, to: 5, children: [] }, ctx(0))).toEqual([]));
});

describe("quoteMarkGroups and autolinks", () => {
  const ctx = { sel: [{ from: 100, to: 100 }], lineOf: (p: number) => Math.floor(p / 10), lineEnd: (p: number) => Math.floor(p / 10) * 10 + 9 };
  it("nested carets on one line become one group with a depth", () => {
    expect(quoteMarkGroups([{ from: 12, to: 13 }, { from: 14, to: 15 }, { from: 22, to: 23 }], ctx)).toEqual([
      { from: 12, to: 16, depth: 2, revealed: false },
      { from: 22, to: 24, depth: 1, revealed: false },
    ]);
  });
  it("autolink angle brackets hide unless the caret is in the link", () => {
    const n = { name: "Autolink", from: 0, to: 12, children: [{ name: "LinkMark", from: 0, to: 1 }, { name: "URL", from: 1, to: 11 }, { name: "LinkMark", from: 11, to: 12 }] };
    expect(autolinkHides(n, ctx)).toHaveLength(2);
    expect(autolinkHides(n, { ...ctx, sel: [{ from: 5, to: 5 }] })).toEqual([]);
  });
});

describe("rendered output", () => {
  it("heading and quote carets are gutter marks, off away and on at the line, with the same character range", () => {
    const doc = "Away\n\n## Heading\n\n> quote\n";
    let s = make(doc, 0);
    const h = doc.indexOf("##"), q = doc.indexOf(">");
    expect(rows(s).filter((r) => r.from === h).map((r) => r.spec.class)).toContain("cm-gm cm-gm-off");
    expect(rows(s).filter((r) => r.from === q).map((r) => r.spec.class)).toContain("cm-gm cm-gm-off");
    s = s.update({ selection: { anchor: h + 4 } }).state;
    expect(rows(s).filter((r) => r.from === h).map((r) => r.spec.class)).toContain("cm-gm cm-gm-on");
    expect(rows(s).filter((r) => r.from === q).map((r) => r.spec.class)).toContain("cm-gm cm-gm-off");
  });
  it("nested quotes get one marker and a depth class", () => {
    const s = make("Away\n\n> > deep\n", 0);
    expect(cls(s, "cm-gm")).toHaveLength(1);
    expect(cls(s, "cm-quote-d2")).toHaveLength(1);
  });
  it("angle and bare URLs become links; URLs inside links and code do not double up", () => {
    const doc = "Away\n\nSee <https://a.test/x> and https://b.test/y and www.c.test.\n\n[t](https://d.test) and `https://e.test`\n";
    const hrefs = rows(make(doc, 0)).map((r) => r.spec.attributes?.["data-href"]).filter(Boolean);
    expect(hrefs.sort()).toEqual(["https://a.test/x", "https://b.test/y", "https://d.test", "https://www.c.test"]);
  });
  it("horizontal rule hides its source away from the line and shows it on the line", () => {
    const doc = "Away\n\n---\n\nEnd";
    expect(cls(make(doc, 0), "cm-hr-off")).toHaveLength(1);
    expect(cls(make(doc, doc.indexOf("---") + 1), "cm-hr-off")).toHaveLength(0);
    expect(cls(make(doc, doc.indexOf("---") + 1), "cm-hr")).toHaveLength(1);
  });
});

describe("viewport-only", () => {
  const big = (n: number) => Array.from({ length: n }, (_, i) => `## S${i}\n\nSome **bold** and \`code\` and ~~x~~ ${i}\n`).join("\n");
  it("decoration count follows the ranges given, not the note", () => {
    const s = make(big(5000), 0);
    const all = rows(s).length;
    const win = rows(s, lineRanges(s.doc, [{ from: 0, to: 400 }], 200)).length;
    expect(all).toBeGreaterThan(40000);
    expect(win).toBeLessThan(200);
  });
  it("a window in the middle of the note renders the same as the whole-document pass for those lines", () => {
    const s = make(big(300), 0);
    const mid = s.doc.line(400).from;
    const [a, b] = lineRanges(s.doc, [{ from: mid, to: mid + 300 }], 0)[0];
    const whole = rows(s).filter((r) => r.from >= a && r.to <= b).map((r) => [r.from, r.to, r.spec.class ?? "w"].join());
    const win = rows(s, [[a, b]]).map((r) => [r.from, r.to, r.spec.class ?? "w"].join());
    expect(win.sort()).toEqual(whole.sort());
  });
  it("lineRanges snaps to whole lines and merges overlaps", () => {
    const doc = Text.of(["aaaa", "bbbb", "cccc", "dddd"]);
    expect(lineRanges(doc, [{ from: 6, to: 7 }, { from: 8, to: 9 }], 0)).toEqual([[5, 9]]);
  });
});

describe("decorations never edit", () => {
  const fixtures: [string, string][] = [
    ["LF", "# H\n\n> q\n\n**b** ~~s~~ `c` https://x.test <https://y.test>\n\n---\n"],
    ["CRLF", "# H\r\n\r\n> q\r\n\r\n**b** ~~s~~ `c`\r\n\r\n---\r\n"],
    ["BOM+CRLF", "ï»¿# H\r\n\r\n> > q\r\n\r\n**b** [[Note]]\r\n"],
    ["mixed", "# H\n\r\n> q\r\n\n**b**\r\n"],
  ];
  it.each(fixtures)("%s: moving the cursor and selecting everywhere leaves the document identical", (_n, doc) => {
    let s = make(doc, 0);
    const want = s.doc.toString(); // CodeMirror holds line breaks as \n; session.ts re-emits the file's original CRLF/BOM (own tests)
    for (let p = 0; p <= s.doc.length; p++) {
      const tr = s.update({ selection: EditorSelection.single(p) });
      expect(tr.docChanged).toBe(false);
      s = tr.state;
      rows(s);
      expect(s.doc.toString()).toBe(want);
    }
    s = s.update({ selection: EditorSelection.single(0, s.doc.length) }).state;
    expect(s.doc.toString()).toBe(want);
  });
});
