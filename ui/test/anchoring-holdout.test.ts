import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import { captureAnchor } from "../shared/anchors.ts";
import { mapAnchor } from "../shared/anchor-mapping.ts";

const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "anchoring-holdout");
const names = readdirSync(folder).filter(name => name.endsWith(".json")).sort();
const totals = { mapping: { passed: 0, total: 0 } };
afterAll(() => console.log(JSON.stringify({ holdout: totals })));

it("keeps the held-out case directory available", () => {
  expect(names.length).toBeGreaterThanOrEqual(10);
});
for (const name of names) for (const mode of ["mapping"] as const) {
  it(`${mode}: ${name}`, () => {
    const c: unknown = JSON.parse(readFileSync(path.join(folder, name), "utf8"));
    if (!c || typeof c !== "object") throw new Error("Case must be an object.");
    const v = c as Record<string, unknown>;
    if (typeof v.before !== "string" || typeof v.after !== "string" || !Number.isSafeInteger(v.from) ||
        !Number.isSafeInteger(v.to) || !(v.expected === null || (typeof v.expected === "object" && v.expected !== null &&
        Number.isSafeInteger((v.expected as Record<string, unknown>).from) && Number.isSafeInteger((v.expected as Record<string, unknown>).to)))) {
      throw new Error(`Invalid holdout case: ${name}`);
    }
    const anchor = captureAnchor(v.before, v.from as number, v.to as number);
    const expected = mode === "mapping" && "expectedMapping" in v ? v.expectedMapping : v.expected;
    if (!(expected === null || (typeof expected === "object" && expected !== null &&
        Number.isSafeInteger((expected as Record<string, unknown>).from) && Number.isSafeInteger((expected as Record<string, unknown>).to)))) throw new Error("Invalid expectedMapping.");
    const result = mapAnchor(v.before, v.after, anchor);
    totals[mode].total++;
    if (expected === null ? result.status === "orphaned" : result.status === "attached" && result.from === (expected as { from: number }).from && result.to === (expected as { to: number }).to) totals[mode].passed++;
    console.log(JSON.stringify({ case: name, path: mode, expected, result }));
    if (expected === null) expect(result.status).toBe("orphaned");
    else expect(result).toMatchObject({ status: "attached", ...(expected as object) });
  });
}
