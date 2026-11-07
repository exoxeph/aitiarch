import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterAll, expect, it } from "vitest";
import { resolveRoot } from "../server/root.ts";

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aitiarch-root-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
mkdirSync(path.join(tmp, ".aitiarch"));
mkdirSync(path.join(tmp, "alternate"));
it("defaults to the project's .aitiarch", async () => {
  expect(await resolveRoot({ cwd: tmp })).toBe(path.join(tmp, ".aitiarch"));
});
it("takes --root literally, without appending a second .aitiarch", async () => {
  expect(await resolveRoot({ cwd: tmp, root: "alternate" })).toBe(path.join(tmp, "alternate"));
  expect(await resolveRoot({ root: path.join(tmp, ".aitiarch") })).toBe(path.join(tmp, ".aitiarch"));
});
it("rejects a missing root, empty override or file without creating anything", async () => {
  writeFileSync(path.join(tmp, "file"), "fixture");
  await expect(resolveRoot({ root: "" })).rejects.toThrow();
  await expect(resolveRoot({ root: path.join(tmp, "absent") })).rejects.toThrow();
  await expect(resolveRoot({ root: path.join(tmp, "file") })).rejects.toThrow();
});
