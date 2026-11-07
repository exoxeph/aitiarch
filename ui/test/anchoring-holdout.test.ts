import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { captureAnchor, resolveAnchor } from "../shared/anchors.ts";

const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "anchoring-holdout");
const names = readdirSync(folder).filter(name => name.endsWith(".json")).sort();

it("keeps the held-out case directory available", () => {
  expect(names.length).toBeLessThanOrEqual(10);
});
for (const name of names) {
  it(name, () => {
    const c: unknown = JSON.parse(readFileSync(path.join(folder, name), "utf8"));
    if (!c || typeof c !== "object") throw new Error("Case must be an object.");
    const v = c as Record<string, unknown>;
    if (typeof v.before !== "string" || typeof v.after !== "string" || !Number.isSafeInteger(v.from) ||
        !Number.isSafeInteger(v.to) || !(v.expected === null || (typeof v.expected === "object" && v.expected !== null &&
        Number.isSafeInteger((v.expected as Record<string, unknown>).from) && Number.isSafeInteger((v.expected as Record<string, unknown>).to)))) {
      throw new Error(`Invalid holdout case: ${name}`);
    }
    const anchor = captureAnchor(v.before, v.from as number, v.to as number);
    const result = resolveAnchor(v.after, anchor);
    if (v.expected === null) expect(result.status).toBe("orphaned");
    else expect(result).toMatchObject({ status: "attached", ...(v.expected as object) });
  });
}
