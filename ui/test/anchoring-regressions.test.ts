import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { captureAnchor, resolveAnchor } from "../shared/anchors.ts";

const cases = JSON.parse(readFileSync(new URL("./fixtures/anchoring-wrong-attachments.json", import.meta.url), "utf8")) as
  Array<{ name: string; before: string; after: string; from: number; to: number }>;
it.each(cases)("strict search preserves identity: $name", c => {
  expect(resolveAnchor(c.after, captureAnchor(c.before, c.from, c.to))).toMatchObject({ status: "orphaned" });
});

it("does not call a one-character-different surviving sentence an edited original", () => {
  const quote = "The selected release is version 10001.";
  const before = "Unique introduction.\n\n" + quote + "\n\nThe selected release is version 10002.\n\nFinal review.";
  const after = before.replace(quote + "\n\n", "");
  expect(resolveAnchor(after, captureAnchor(before, before.indexOf(quote), before.indexOf(quote) + quote.length)).status).toBe("orphaned");
});
