// Slice A: pure reveal rules, gutter markers, autolinks, rule, nested quotes, viewport-only cost, and "decorations never edit".
import { EditorState, EditorSelection, Text } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { TaskList, Strikethrough, Autolink } from "@lezer/markdown";
import { describe, it, expect } from "vitest";
import { buildInline, lineRanges, livePreview } from "../src/editor/livepreview.ts";
import { taskMarkerAt, taskToggleChange } from "../src/editor/tasks.ts";
import { slashMatch, slashInsert, slashPick, slashSource, SLASH_ITEMS } from "../src/editor/slash.ts";
import { CompletionContext } from "@codemirror/autocomplete";
import { fenceLabel } from "../src/editor/codeblocks.ts";
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

describe("tasks (D1)", () => {
  const cases: [string, number | null, boolean | null][] = [
    ["- [ ] a", 2, false], ["- [x] a", 2, true], ["- [X] a", 2, true], ["  * [ ] nested", 4, false], ["1. [x] numbered", 3, true], ["10) [ ] n", 4, false],
    ["- [] nope", null, null], ["- [y] nope", null, null], ["-[ ] nope", null, null], ["text [ ] nope", null, null], ["- [ ]no space", null, null],
  ];
  it.each(cases)("taskMarkerAt %j", (line, offset, checked) => {
    const m = taskMarkerAt(line);
    if (offset === null) expect(m).toBeNull();
    else expect(m).toEqual({ offset, checked });
  });
  it("toggle changes exactly one character and toggling twice returns the original bytes", () => {
    for (const line of ["- [ ] a", "- [x] b", "  * [X] c", "1. [ ] d"]) {
      const doc = `before\n${line}\nafter\n`;
      const from = 7;
      const ch = taskToggleChange(line, from) as { from: number; to: number; insert: string };
      expect(ch.to - ch.from).toBe(1);
      let s = EditorState.create({ doc }).update({ changes: ch }).state;
      expect(s.doc.length).toBe(doc.length);
      const l2 = s.doc.lineAt(from);
      s = s.update({ changes: taskToggleChange(l2.text, l2.from) as any }).state;
      expect(s.doc.toString()).toBe(doc.replace("[X]", "[x]")); // toggling twice turns a capital X into x; Ctrl+Z restores it exactly
    }
  });
  it("away from the line, bullets and checkboxes keep their characters (no replace) and caret on the line shows source", () => {
    const doc = "Away\n\n- bullet\n- [ ] task\n- [x] done\n";
    let s = make(doc, 0);
    expect(cls(s, "cm-bullet-off")).toHaveLength(1);
    expect(cls(s, "cm-task-off")).toHaveLength(2);
    expect(cls(s, "cm-task-done")).toHaveLength(1);
    expect(rows(s).filter((r) => r.spec.widget && r.spec.widget.constructor.name !== "Chip")).toEqual([]);
    expect(rows(s).filter((r) => !r.spec.class && !r.spec.widget && r.to > r.from)).toEqual([]);
    s = s.update({ selection: { anchor: doc.indexOf("task") } }).state;
    expect(cls(s, "cm-task-off")).toHaveLength(1);
  });
});

describe("code blocks (D1)", () => {
  const doc = "Away\n\n```js\nconst a = 1;\n```\n\nEnd\n";
  it("fences keep their lines, stay hidden even in the block, and the opening fence has a labelled header", () => {
    let s = make(doc, 0);
    expect(cls(s, "cm-fence-off")).toHaveLength(2);
    expect(cls(s, "cm-fence-open")).toHaveLength(1);
    expect(cls(s, "cm-fence-close")).toHaveLength(1);
    const head = rows(s).find((r) => r.spec.widget?.constructor.name === "FenceHeader");
    expect(head?.spec.widget.label).toBe("JavaScript");
    s = s.update({ selection: { anchor: doc.indexOf("const") } }).state;
    expect(cls(s, "cm-fence-on")).toHaveLength(0);
    expect(cls(s, "cm-fence-off")).toHaveLength(2);
  });
  it("fenceLabel names known languages, keeps unknown ones, and defaults to text", () => {
    expect([fenceLabel("js"), fenceLabel("TS"), fenceLabel("py"), fenceLabel("bash"), fenceLabel("rust"), fenceLabel("")]).toEqual(["JavaScript", "TypeScript", "Python", "Shell", "rust", "text"]);
  });
});
describe("slash menu (C)", () => {
  const cases: [string, number, { offset: number; query: string } | null][] = [
    ["/", 1, { offset: 0, query: "" }], ["/he", 3, { offset: 0, query: "he" }], ["  /h", 4, { offset: 2, query: "h" }], ["/to-do", 6, { offset: 0, query: "to-do" }],
    ["text /h", 7, null], ["see https://x", 13, null], ["/he llo", 7, null], ["a/b", 3, null], ["", 0, null], ["/h", 1, { offset: 0, query: "" }],
  ];
  it.each(cases)("slashMatch %j at %i", (line, col, want) => expect(slashMatch(line, col)).toEqual(want));
  it("every item inserts plain Markdown in place of /query, and the undo returns the original bytes", () => {
    for (const item of SLASH_ITEMS) {
      const doc = "Before\n/query\nAfter\n";
      const from = doc.indexOf("/query"), to = from + 6;
      const { changes, caret } = slashInsert(item, from, to);
      const s = EditorState.create({ doc }).update({ changes, selection: { anchor: caret } }).state;
      expect(s.doc.toString()).toBe(doc.slice(0, from) + item.insert + doc.slice(to));
      expect(caret).toBe(from + (item.caret ?? item.insert.length));
      const inverse = EditorState.create({ doc }).update({ changes }).changes.invert(EditorState.create({ doc }).doc);
      expect(inverse.apply(s.doc).toString()).toBe(doc);
    }
  });
  it("offers all items at a line start, but not in code, frontmatter or mid-line", () => {
    const at = (doc: string, needle: string) => {
      const s = make(doc, 0);
      const pos = doc.indexOf(needle) + needle.length;
      const r = slashSource(new CompletionContext(s, pos, false)) as any;
      return r && r.options.map((o: any) => o.label);
    };
    expect(at("Intro\n\n/", "\n/")).toEqual(SLASH_ITEMS.map((i) => i.label));
    expect(at("```\n/\n```\n", "\n/")).toBeNull();
    expect(at("---\ntitle: x\n/\n---\n\nBody", "\n/")).toBeNull();
    expect(at("some text /", "text /")).toBeNull();
    expect(at("    code\n\n/", "\n\n/")).not.toBeNull();
  });
});

describe("slash fallback pick (C)", () => {
  it.each([["code", "Code block"], ["head", "Heading 1"], ["h2", "Heading 2"], ["todo", "To-do list"], ["to-do", "To-do list"], ["quo", "Quote"], ["div", "Divider"], ["num", "Numbered list"], ["bul", "Bulleted list"]])("/%s picks %s", (q, label) => expect(slashPick(q)?.label).toBe(label));
  it("returns null when nothing matches", () => expect(slashPick("zzz")).toBeNull());
});
