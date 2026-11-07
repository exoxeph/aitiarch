import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../server/store.ts";

const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "aitiarch-store-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let root: string;
let n = 0;
beforeEach(() => {
  root = path.join(tmp, `r${n++}`);
  mkdirSync(path.join(root, "decisions"), { recursive: true });
  mkdirSync(path.join(root, "runs"), { recursive: true });
  mkdirSync(path.join(root, "measurements"), { recursive: true });
  writeFileSync(path.join(root, "notebook.md"), "# Title\n\nPara A.\n\nPara B.\n");
  writeFileSync(path.join(root, "decisions", "homepage.md"), "---\nstatus: accepted\n---\n\n# D\n");
  writeFileSync(path.join(root, "runs", "answer.md"), "private");
  writeFileSync(path.join(root, "measurements", "m.json"), "{}");
  writeFileSync(path.join(root, "usage.jsonl"), "{}\n");
});

describe("tree", () => {
  it("lists only notes, hides evidence folders and non-markdown files", async () => {
    const s = await Store.open(root);
    const t = await s.tree();
    const flat = JSON.stringify(t);
    expect(flat).toContain("notebook.md");
    expect(flat).toContain("decisions/homepage.md");
    expect(flat).not.toContain("answer.md");
    expect(flat).not.toContain("usage.jsonl");
    expect(flat).not.toContain("m.json");
  });
});

describe("compare-and-write", () => {
  it("saves when the base version is current, and returns the new version", async () => {
    const s = await Store.open(root);
    const f = await s.read("notebook.md");
    const r = await s.write("notebook.md", "# Title\n\nPara A edited.\n\nPara B.\n", f.version);
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(readFileSync(path.join(root, "notebook.md"), "utf8")).toBe("# Title\n\nPara A edited.\n\nPara B.\n");
    expect((await s.read("notebook.md")).version).toBe((r as { version: string }).version);
  });

  it("refuses a stale base and leaves the other writer's bytes untouched", async () => {
    const s = await Store.open(root);
    const f = await s.read("notebook.md");
    const theirs = "# Title\n\nPara A.\n\nPara B changed by an agent.\n";
    writeFileSync(path.join(root, "notebook.md"), theirs);
    const r = await s.write("notebook.md", "# Title\n\nMine.\n", f.version);
    expect(r).toMatchObject({ ok: false, reason: "conflict" });
    expect((r as { current?: { text: string } }).current?.text).toBe(theirs);
    expect(readFileSync(path.join(root, "notebook.md"), "utf8")).toBe(theirs);
  });

  it("keeps CRLF and BOM exactly", async () => {
    const s = await Store.open(root);
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# T\r\n\r\nOne.\r\n\r\nTwo.\r\n")]);
    writeFileSync(path.join(root, "crlf.md"), bytes);
    const f = await s.read("crlf.md");
    expect(f).toMatchObject({ eol: "CRLF", bom: true });
    await s.write("crlf.md", "# T\n\nOne edited.\n\nTwo.\n\nThree.\n", f.version);
    const out = readFileSync(path.join(root, "crlf.md"));
    expect(out.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(out.subarray(3).toString()).toBe("# T\r\n\r\nOne edited.\r\n\r\nTwo.\r\n\r\nThree.\r\n");
  });

  it("an unchanged save does not touch the file", async () => {
    const s = await Store.open(root);
    const f = await s.read("notebook.md");
    const before = statSync(path.join(root, "notebook.md")).mtimeMs;
    const r = await s.write("notebook.md", f.text, f.version);
    expect(r).toMatchObject({ ok: true, changed: false, version: f.version });
    expect(statSync(path.join(root, "notebook.md")).mtimeMs).toBe(before);
  });

  it("leaves no temp files behind, success or conflict", async () => {
    const s = await Store.open(root);
    const f = await s.read("notebook.md");
    await s.write("notebook.md", "changed\n", f.version);
    await s.write("notebook.md", "again\n", f.version); // stale -> conflict
    expect(readdirSync(root).filter((x) => x.endsWith(".tmp"))).toEqual([]);
  });

  it("reports a deleted note as missing instead of recreating it", async () => {
    const s = await Store.open(root);
    const f = await s.read("notebook.md");
    rmSync(path.join(root, "notebook.md"));
    expect(await s.write("notebook.md", "x", f.version)).toMatchObject({ ok: false, reason: "missing" });
  });

  it("refuses non-UTF-8 and oversized notes", async () => {
    const s = await Store.open(root);
    writeFileSync(path.join(root, "bin.md"), Buffer.from([0x61, 0xff, 0xfe]));
    await expect(s.read("bin.md")).rejects.toMatchObject({ status: 415 });
    writeFileSync(path.join(root, "big.md"), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
    await expect(s.read("big.md")).rejects.toMatchObject({ status: 413 });
  });
});
