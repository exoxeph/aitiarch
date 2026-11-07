import { describe, expect, it } from "vitest";
import { captureAnchor, resolveAnchor } from "../shared/anchors.ts";

const quote = "Use Redis for temporary session storage.";
const changed = "Use Redis for short-lived session storage.";
const a = "# Authentication\n\n";
const z = "\n\nKeep the signing key private.";
const base = a + quote + z;
const anchor = () => captureAnchor(base, a.length, a.length + quote.length);
const sharedPrefix = "Shared context before. ".repeat(4);
const sharedSuffix = " Shared context after.".repeat(4);
const block = sharedPrefix + quote + sharedSuffix;

// Expected ranges are derived from the fixture construction, never from the resolver.
const cases = [
  { name: "unchanged", before: base, from: a.length, text: base, expected: a.length, body: quote },
  { name: "insertion before", before: base, from: a.length, text: "Preface.\n\n" + base, expected: 10 + a.length, body: quote },
  { name: "edit inside quote", before: base, from: a.length, text: a + changed + z, expected: a.length, body: changed },
  { name: "move paragraph", before: base, from: a.length, text: "# Other\n\nUnrelated paragraph.\n\n" + quote, expected: 31, body: quote },
  { name: "deleted paragraph", before: base, from: a.length, text: a + z.trimStart(), expected: null, body: quote },
  { name: "empty note", before: base, from: a.length, text: "", expected: null, body: quote },
  { name: "complete replacement", before: base, from: a.length, text: "# New\n\nUse SQLite for invoices.", expected: null, body: quote },
  { name: "duplicate inserted after", before: base, from: a.length, text: base + "\n\n# Other\n\n" + quote, expected: a.length, body: quote },
  { name: "duplicate inserted before", before: base, from: a.length, text: quote + "\n\n" + base, expected: quote.length + 2 + a.length, body: quote },
  { name: "context wins over old position", before: base, from: a.length, text: a + quote + "\n\nWrong suffix.\n\n" + base, expected: a.length + quote.length + 17 + a.length, body: quote },
  { name: "suffix disambiguates but source quote repeated later", before: "Old.\n\n" + quote + z, from: 6, text: "New.\n\n" + quote + "\n\nDecoy.\n\n" + quote + z, expected: 6 + quote.length + 10, body: quote, conservativeOrphan: true },
  { name: "edited original versus exact decoy", before: base + "\n\n# Decoy\n\n" + quote, from: a.length, text: a + changed + z + "\n\n# Decoy\n\n" + quote, expected: a.length, body: changed, conservativeOrphan: true },
  { name: "deleted original leaves old duplicate", before: base + "\n\n# Decoy\n\n" + quote, from: a.length, text: a + "Removed entirely." + z + "\n\n# Decoy\n\n" + quote, expected: null, body: quote },
  { name: "punctuation edit", before: base, from: a.length, text: a + quote.slice(0, -1) + "!" + z, expected: a.length, body: quote.slice(0, -1) + "!" },
  { name: "two similar edited candidates", before: base, from: a.length, text: "Wrong.\n\n" + changed + "\n\nOther.\n\n" + a + changed + z, expected: 8 + changed.length + 10 + a.length, body: changed },
  { name: "short selection exact", before: "A Redis B", from: 2, text: "Prefix A Redis B", expected: 9, body: "Redis", selected: "Redis" },
  { name: "short selection deleted", before: "A Redis B", from: 2, text: "A MySQL B", expected: null, body: "Redis", selected: "Redis" },
  { name: "partial sentence edit", before: "Before: " + quote + " After.", from: 8, text: "Before: " + changed + " After.", expected: 8, body: changed },
  { name: "multi-paragraph selection", before: "Start\n\n" + quote + "\n\nSecond selected paragraph.\n\nEnd", from: 7,
    text: "New\n\nStart\n\n" + quote + "\n\nSecond selected paragraph.\n\nEnd", expected: 12,
    body: quote + "\n\nSecond selected paragraph.", selected: quote + "\n\nSecond selected paragraph." },
  { name: "Unicode before selection", before: "\u{1f680} Caf\u00e9\n\n" + quote, from: 9, text: "\u{1f680} Caf\u00e9\n\n" + changed, expected: 9, body: changed },
  { name: "boundary context disambiguates but quote originally repeated", before: quote + "\n\n" + quote, from: 0, text: quote + "\n\n" + quote + "\n\nTail.", expected: 0, body: quote, conservativeOrphan: true },
  { name: "indistinguishable new duplicates", before: quote, from: 0, text: quote + "\n\n" + quote, expected: null, body: quote },
  // A recoverable ground-truth case deliberately retained in the metric: proximity is insufficient proof.
  { name: "position alone is insufficient for identical contexts", before: block + "\n\n" + block, from: sharedPrefix.length,
    text: "Preface.\n\n" + block + "\n\n" + block, expected: 10 + sharedPrefix.length, body: quote, conservativeOrphan: true },
  { name: "equal position distances remain ambiguous", before: ".".repeat(600) + block + ".".repeat(700) + block, from: 600 + sharedPrefix.length,
    text: ".".repeat(100) + block + ".".repeat(1000 - block.length) + block, expected: null, body: quote },
  { name: "new identical contexts defeat position hint", before: block, from: sharedPrefix.length,
    text: block + "\n\n" + block, expected: null, body: quote },
  { name: "deleted identical context cannot be distinguished from surviving copy", before: block + "\n\n" + block, from: sharedPrefix.length,
    text: block, expected: null, body: quote },
  { name: "deleted original shares prefix with surviving decoy", before: sharedPrefix + quote + "\n\nOriginal tail.\n\n" + sharedPrefix + quote + "\n\nDecoy tail.",
    from: sharedPrefix.length, text: sharedPrefix + quote + "\n\nDecoy tail.", expected: null, body: quote },
  { name: "large insertion must not redirect second duplicate to first", before: block + "\n\n" + block, from: block.length + 2 + sharedPrefix.length,
    text: "x".repeat(block.length + 20) + block + "\n\n" + block, expected: block.length + 20 + block.length + 2 + sharedPrefix.length, body: quote, conservativeOrphan: true },
  { name: "editing a selected duplicate's context must not favor untouched decoy", before: block + "\n\n" + block, from: sharedPrefix.length,
    text: "Changed context before. ".repeat(4) + quote + sharedSuffix + "\n\n" + block,
    expected: "Changed context before. ".repeat(4).length, body: quote, conservativeOrphan: true },
  { name: "short original prefix uses the same context comparison as candidate ranking", before: a + quote + sharedSuffix + "\n\n" + a + quote + sharedSuffix, from: a.length,
    text: "Changed first context.\n\n" + quote + sharedSuffix + "\n\n" + a + quote + sharedSuffix,
    expected: "Changed first context.\n\n".length, body: quote, conservativeOrphan: true },
] as const;

describe("anchoring evaluation set", () => {
  it.each(cases)("$name", (c) => {
    const selected = "selected" in c ? c.selected : quote;
    const original = captureAnchor(c.before, c.from, c.from + selected.length);
    const result = resolveAnchor(c.text, original);
    if (c.expected === null) expect(result.status).toBe("orphaned");
    else if (result.status === "attached") expect(result).toMatchObject({ from: c.expected, to: c.expected + c.body.length });
    else expect(result.status).toBe("orphaned"); // recovery is measured separately from wrong attachments
  });

  it("reports wrong attachments and unnecessary orphans separately", () => {
    let wrongAttachments = 0, unnecessaryOrphans = 0;
    for (const c of cases) {
      const selected = "selected" in c ? c.selected : quote;
      const r = resolveAnchor(c.text, captureAnchor(c.before, c.from, c.from + selected.length));
      if (r.status === "attached" && (c.expected === null || r.from !== c.expected || c.text.slice(r.from, r.to) !== c.body)) wrongAttachments++;
      if (r.status === "orphaned" && c.expected !== null) unnecessaryOrphans++;
    }
    console.log(JSON.stringify({ cases: cases.length, recoverable: cases.filter(c => c.expected !== null).length, wrongAttachments, unnecessaryOrphans }));
    expect(wrongAttachments).toBe(0);
    expect(unnecessaryOrphans).toBe(15);
  });
});

it("captures quote/context/UTF-16 positions without modifying text", () => {
  const copy = base;
  expect(anchor()).toMatchObject({ quote, prefix: a, suffix: z, position: { from: a.length, to: a.length + quote.length }, quoteCount: 1 });
  expect(base).toBe(copy);
});

it.each([[0, 0], [-1, 3], [3, 2], [0, 999]])("rejects invalid selection %s:%s", (from, to) => {
  expect(() => captureAnchor(base, from, to)).toThrow();
});

it("refuses malformed anchors rather than guessing", () => {
  expect(() => resolveAnchor(base, { ...anchor(), quote: "" })).toThrow();
  expect(() => resolveAnchor(base, { ...anchor(), position: { from: NaN, to: 5 } })).toThrow();
});

it("unique-quote invariant: a quote unique at capture and still unique always attaches", () => {
  const selected = "A singular anchored statement remains exactly here.";
  const before = "Heading\n\n" + selected + "\n\nTail";
  const a = captureAnchor(before, 9, 9 + selected.length);
  const variations = [
    selected,
    "Unrelated text inserted before.\n\n" + selected,
    selected + "\n\nCompletely different text after it.",
    "Changed heading\n\n" + selected + "\n\nChanged tail",
    "A long unrelated chapter.\n\n".repeat(100) + selected,
  ];
  for (const text of variations) {
    expect(text.split(selected)).toHaveLength(2);
    expect(resolveAnchor(text, a), text).toEqual({ status: "attached", from: text.indexOf(selected), to: text.indexOf(selected) + selected.length });
  }
});

it("keeps an originally duplicated quote orphaned when only one copy survives", () => {
  const selected = "The same quoted paragraph appears twice.";
  const before = selected + "\n\n" + selected;
  const a = captureAnchor(before, 0, selected.length);
  const after = selected; // Either original or surviving copy has these exact bytes.
  expect(after.split(selected)).toHaveLength(2);
  expect(resolveAnchor(after, a)).toEqual({ status: "orphaned", reason: "ambiguous" });
});
