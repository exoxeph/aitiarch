import { ChangeSet, Text } from "@codemirror/state";
import { expect, it } from "vitest";
import { captureAnchor } from "../shared/anchors.ts";
import { mapAnchor } from "../shared/anchor-mapping.ts";
import movedRepeated from "./fixtures/mapping-moved-repeated.json";

it("never mistakes a moved repeated sentence for a similar sentence left behind", () => {
  expect(mapAnchor(movedRepeated.before, movedRepeated.after, movedRepeated.anchor).status).toBe("orphaned");
});

const quote = "The release keeps a verified checkpoint for every deployment.";
const before = "# Deployment\n\n" + quote + "\n\nReview before publication.";
const from = before.indexOf(quote);
const a = captureAnchor(before, from, from + quote.length);

it("maps an insertion before the selected text through the existing diff", () => {
  const after = "A newly added introduction.\n\n" + before;
  expect(mapAnchor(before, after, a)).toEqual({ status: "attached", from: after.indexOf(quote), to: after.indexOf(quote) + quote.length });
});
it("maps the middle of three identical sections through an unrelated prefix insertion", () => {
  const block = "Alpha evidence.\n\n" + quote + "\n\nCharlie follow-up.";
  const old = ["# Heading", block, block, block, "End."].join("\n\n");
  const at = old.indexOf(quote, old.indexOf(quote) + 1);
  const anchor = captureAnchor(old, at, at + quote.length);
  const added = "An unrelated introduction.\n\n";
  expect(mapAnchor(old, added + old, anchor)).toEqual({ status: "attached", from: at + added.length, to: at + added.length + quote.length });
});
it("maps a small edit in the second repeated sentence rather than the surviving first copy", () => {
  const old = "# First\n\n" + quote + "\n\n# Second\n\n" + quote + "\n\nEnd.";
  const at = old.lastIndexOf(quote);
  const anchor = captureAnchor(old, at, at + quote.length);
  const changed = quote.replace("verified", "reviewed");
  const after = old.slice(0, at) + changed + old.slice(at + quote.length);
  expect(mapAnchor(old, after, anchor)).toEqual({ status: "attached", from: at, to: at + changed.length });
});
it("orphans an external insertion of an identical adjacent copy", () => {
  const after = before.replace(quote, quote + "\n\n" + quote);
  expect(mapAnchor(before, after, a).status).toBe("orphaned");
});
it("uses an explicit browser transaction to keep the original after an adjacent insertion", () => {
  const changes = ChangeSet.of({ from, insert: quote + "\n\n" }, before.length);
  const after = changes.apply(Text.of(before.split("\n"))).toString();
  expect(mapAnchor(before, after, a, changes, "browser")).toEqual({ status: "attached", from: from + quote.length + 2, to: from + quote.length * 2 + 2 });
});
it("orphans a deleted range even when a similar sentence survives at the old position", () => {
  const similar = quote.replace("verified", "reviewed");
  const old = "# Heading\n\n" + quote + "\n\n" + similar + "\n\nEnd.";
  const at = old.indexOf(quote);
  expect(mapAnchor(old, old.replace(quote + "\n\n", ""), captureAnchor(old, at, at + quote.length)).status).toBe("orphaned");
});
it("does not treat a substantial replacement as a surviving selected paragraph", () => {
  expect(mapAnchor(before, before.replace(quote, "A different implementation uses another release strategy entirely."), a).status).toBe("orphaned");
});
it("rejects a range whose previous text does not match its selector", () => {
  expect(mapAnchor("Wrong previous text.", before, a).status).toBe("attached"); // strict unique-quote fallback
});

it("does not use a missing final newline to distinguish otherwise identical copies", () => {
  const old = "Unrelated evidence.\n\n" + quote + "\n\n" + quote;
  const at = old.lastIndexOf(quote);
  const after = quote + "\n\nUnrelated evidence.\n\n" + quote;
  expect(mapAnchor(old, after, captureAnchor(old, at, at + quote.length)).status).toBe("orphaned");
});
it("orphans when the EOF-biased edit diff disagrees with unique whole-line alignment", () => {
  const old = [quote, quote, quote, quote, "Final unrelated evidence."].join("\n\n");
  const at = quote.length + 2;
  const after = ["Final unrelated evidence.", quote, quote, quote, quote].join("\n\n");
  expect(mapAnchor(old, after, captureAnchor(old, at, at + quote.length)).status).toBe("orphaned");
});
