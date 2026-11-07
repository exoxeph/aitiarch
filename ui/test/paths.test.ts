import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isNotePath, normalizeRel, resolveNote } from "../server/paths.ts";

const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "aitiarch-paths-")));
const root = path.join(tmp, "root");
const outside = path.join(tmp, "outside");
mkdirSync(path.join(root, "decisions"), { recursive: true });
mkdirSync(path.join(root, "runs"), { recursive: true });
mkdirSync(outside);
writeFileSync(path.join(root, "notebook.md"), "x");
writeFileSync(path.join(root, "decisions", "d.md"), "x");
writeFileSync(path.join(root, "runs", "answer.md"), "private");
writeFileSync(path.join(outside, "secret.md"), "secret");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("normalizeRel rejects hostile paths", () => {
  const bad = ["", "..", "../x.md", "a/../b.md", "/etc/x.md", "C:/x.md", "a\\b.md", "a//b.md", "x.md:stream", "con.md", "a/NUL.md", "trail. /x.md", "x.md.", "a/./b.md", "a\0b.md", "q?.md", "a<b>.md", " lead.md"];
  for (const p of bad) it(JSON.stringify(p), () => expect(() => normalizeRel(p)).toThrow());
  it("accepts ordinary nested paths", () => expect(normalizeRel("decisions/homepage-story.md")).toBe("decisions/homepage-story.md"));
});

describe("isNotePath", () => {
  it("only .md outside hidden evidence folders", () => {
    expect(isNotePath("notebook.md")).toBe(true);
    expect(isNotePath("decisions/d.md")).toBe(true);
    expect(isNotePath("notebook.txt")).toBe(false);
    expect(isNotePath("runs/x/answer.md")).toBe(false);
    expect(isNotePath("Measurements/a.md")).toBe(false);
    expect(isNotePath("backups/a.md")).toBe(false);
  });
});

describe("resolveNote", () => {
  it("resolves a note under the root", async () => {
    const r = await resolveNote(root, "decisions/d.md");
    expect(r.abs).toBe(path.join(root, "decisions", "d.md"));
  });
  it("404 for hidden folders and missing files", async () => {
    await expect(resolveNote(root, "runs/answer.md")).rejects.toMatchObject({ status: 404 });
    await expect(resolveNote(root, "nope.md")).rejects.toMatchObject({ status: 404 });
  });
  it("rejects a junction/symlink that points outside the root", async () => {
    symlinkSync(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(resolveNote(root, "escape/secret.md")).rejects.toMatchObject({ status: 403, code: "outside_root" });
  });
});
