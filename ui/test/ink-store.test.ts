import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InkStore } from "../server/ink-store.ts";
import { captureAnchor } from "../shared/anchors.ts";
import { Store } from "../server/store.ts";
vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

let root: string;
let store: InkStore;
const text = "# Fixture\n\nUse Redis for temporary session storage.\n\nEnd.";
const quote = "Use Redis for temporary session storage.";
beforeEach(async () => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aitiarch-ink-")));
  writeFileSync(path.join(root, "fixture.md"), text);
  writeFileSync(path.join(root, ".gitignore"), "/.cache/\n");
  store = await InkStore.open(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const file = () => path.join(root, "ink", "fixture.ink.json");
async function seed(note = "fixture.md") {
  const initial = await store.read(note);
  const anchor = captureAnchor(text, text.indexOf(quote), text.indexOf(quote) + quote.length);
  initial.document.items.push({ id: "answer-1", kind: "answer", body: "Synthetic ink only.", anchor, originalAnchor: structuredClone(anchor),
    attachment: { status: "attached", from: anchor.position.from, to: anchor.position.to } });
  await store.write(note, initial.document, initial.version);
  return store.read(note);
}

describe("ink sidecars", () => {
  it("stores stable pretty JSON under one ink directory without changing Markdown", async () => {
    const before = readFileSync(path.join(root, "fixture.md"));
    const first = await seed();
    const bytes = readFileSync(file(), "utf8");
    expect(bytes).toBe(JSON.stringify(JSON.parse(bytes), null, 2) + "\n");
    const reordered = { ...first.document, items: first.document.items.map(i => ({ ...i, anchor: { ...i.anchor } })) };
    await store.write("fixture.md", reordered, first.version);
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(readFileSync(path.join(root, "fixture.md"))).toEqual(before);
    expect(existsSync(path.join(root, ".aitiarch"))).toBe(false);
    const publicNotes = await (await Store.open(root)).listNotes();
    expect(publicNotes.map(n => n.path)).toEqual(["fixture.md"]);
  });

  it("isolates equal basenames and keeps ink out of the note tree", async () => {
    mkdirSync(path.join(root, "decisions"));
    writeFileSync(path.join(root, "decisions", "fixture.md"), text);
    await seed();
    await seed("decisions/fixture.md");
    writeFileSync(path.join(root, "ink", "internal.md"), "private sidecar material");
    expect(existsSync(path.join(root, "ink", "decisions", "fixture.ink.json"))).toBe(true);
    expect((await (await Store.open(root)).listNotes()).map(n => n.path).sort()).toEqual(["decisions/fixture.md", "fixture.md"]);
  });

  it.skipIf(process.platform !== "win32")("keeps ink accessible through case aliases and case-only note renames on Windows", async () => {
    const saved = await seed();
    expect((await store.read("FIXTURE.MD")).document.items).toEqual(saved.document.items);
    renameSync(path.join(root, "fixture.md"), path.join(root, "FIXTURE.md"));
    const current = await store.read("FIXTURE.md");
    expect(current.document.note).toBe("FIXTURE.md");
    await store.reanchor("FIXTURE.md", current.version);
    expect((await store.read("fixture.md")).document.items).toEqual(saved.document.items);
    expect(readdirSync(path.join(root, "ink"))).toHaveLength(1);
  });

  it("rejects stale versions across independent writers", async () => {
    const first = await seed();
    const other = await InkStore.open(root);
    const second = structuredClone(first.document);
    second.items[0].body = "Newer ink.";
    await other.write("fixture.md", second, first.version);
    await expect(store.write("fixture.md", first.document, first.version)).rejects.toThrow(/conflict/i);
    expect((await store.read("fixture.md")).document.items[0].body).toBe("Newer ink.");
  });

  it("retains old data and releases its own lock after replacement fails", async () => {
    const first = await seed();
    const old = readFileSync(file());
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("Injected disk error"), { code: "EIO" }));
    await expect(store.write("fixture.md", { ...first.document, items: [] }, first.version)).rejects.toThrow("Injected disk error");
    expect(readFileSync(file())).toEqual(old);
    expect(readdirSync(path.join(root, "ink"))).toEqual(["fixture.ink.json"]);
    await expect(store.write("fixture.md", first.document, first.version)).resolves.toBeTypeOf("string");
  });

  it("rejects a changed note and fabricated current attachments", async () => {
    const first = await seed();
    const forged = captureAnchor("Invented selected quote that is not in this note.", 0, 48);
    const bad = structuredClone(first.document);
    bad.items[0].anchor = forged;
    bad.items[0].attachment = { status: "attached", from: 0, to: 48 };
    await expect(store.write("fixture.md", bad, first.version)).rejects.toThrow();
    writeFileSync(path.join(root, "fixture.md"), "External edit.");
    await expect(store.write("fixture.md", first.document, first.version)).rejects.toThrow(/conflict/i);
    expect((await store.read("fixture.md")).version).toBe(first.version);
  });

  it("serializes simultaneous writers so one loses with a conflict", async () => {
    const first = await seed();
    const results = await Promise.allSettled([store.write("fixture.md", first.document, first.version),
      store.write("fixture.md", { ...first.document, items: [] }, first.version)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(JSON.parse(readFileSync(file(), "utf8"))).toHaveProperty("v", 2);
  });

  it("refuses a busy lock without removing evidence or changing saved ink", async () => {
    await seed();
    const old = readFileSync(file());
    writeFileSync(file() + ".lock", "other writer");
    const snapshot = await store.read("fixture.md");
    await expect(store.write("fixture.md", snapshot.document, snapshot.version)).rejects.toThrow(/busy/i);
    expect(readFileSync(file())).toEqual(old);
    expect(readFileSync(file() + ".lock", "utf8")).toBe("other writer");
  });

  it.each(["{bad", '{"v":2,"note":"fixture.md","noteVersion":null,"items":[]}'])("does not discard corrupt or future data: %s", async raw => {
    mkdirSync(path.join(root, "ink"));
    writeFileSync(file(), raw);
    await expect(store.read("fixture.md")).rejects.toThrow();
    expect(readFileSync(file(), "utf8")).toBe(raw);
  });

  it("rejects duplicate IDs, invalid anchors and mismatched note names without altering ink", async () => {
    const s = await seed();
    const old = readFileSync(file());
    for (const bad of [ { ...s.document, note: "other.md" }, { ...s.document, items: [...s.document.items, s.document.items[0]] },
      { ...s.document, items: [{ ...s.document.items[0], anchor: { ...s.document.items[0].anchor, quote: "" } }] } ]) {
      await expect(store.write("fixture.md", bad, s.version)).rejects.toThrow();
    }
    expect(readFileSync(file())).toEqual(old);
  });

  it.each(["../escape.md", "runs/private.md", "ink/private.md", "C:/escape.md", "fixture.md:stream", "file.json"])("rejects unsafe note path %s", async note => {
    await expect(store.read(note)).rejects.toThrow();
  });

  it("rejects linked sidecar directories and linked notes", async () => {
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aitiarch-outside-")));
    try {
      symlinkSync(outside, path.join(root, "ink"), "junction");
      await expect(store.read("fixture.md")).rejects.toThrow();
      rmSync(path.join(root, "ink"));
      symlinkSync(outside, path.join(root, "linked"), "junction");
      writeFileSync(path.join(outside, "fixture.md"), text);
      await expect(store.read("linked/fixture.md")).rejects.toThrow();
      expect(existsSync(path.join(outside, "fixture.ink.json"))).toBe(false);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
});

describe("persisted re-anchoring", () => {
  it("checkpoints browser identity through reload and rejects stale versions without changing human fields", async () => {
    const s = await seed();
    const at = text.indexOf(quote), after = text.slice(0, at) + quote + "\n\n" + text.slice(at);
    writeFileSync(path.join(root, "fixture.md"), after);
    const fresh = await (await Store.open(root)).read("fixture.md");
    const anchor = captureAnchor(after, at + quote.length + 2, at + quote.length * 2 + 2);
    const update = { id: "answer-1", anchor, attachment: { status: "attached" as const, ...anchor.position } };
    const saved = await store.checkpoint("fixture.md", s.version, fresh.version, [update]);
    const reopened = await (await InkStore.open(root)).reanchor("fixture.md", saved.version);
    expect(reopened.document.items[0].attachment).toEqual(update.attachment);
    expect(reopened.document.items[0].body).toBe(s.document.items[0].body);
    expect(reopened.document.items[0].originalAnchor).toEqual(s.document.items[0].originalAnchor);
    const bytes = readFileSync(file());
    await expect(store.checkpoint("fixture.md", s.version, fresh.version, [update])).rejects.toThrow(/conflict/);
    expect(readFileSync(file())).toEqual(bytes);
    expect(readFileSync(path.join(root, "fixture.md"), "utf8")).toBe(after);
  });
  it("writes v2 with a normalized-text hash and rejects v1 without changing it", async () => {
    const s = await seed();
    expect(s.document.v).toBe(2);
    expect(s.document).toHaveProperty("lastSeenTextHash");
    const old = JSON.stringify({ ...s.document, v: 1 });
    writeFileSync(file(), old);
    await expect(store.read("fixture.md")).rejects.toThrow(/unsupported/);
    expect(readFileSync(file(), "utf8")).toBe(old);
  });
  it("falls back to strict search after restart when the private snapshot is missing", async () => {
    const s = await seed();
    const cache = path.join(root, ".cache");
    if (existsSync(cache)) rmSync(cache, { recursive: true });
    writeFileSync(path.join(root, "fixture.md"), text.replace(quote, quote.replace("Redis", "Valkey")));
    const reopened = await InkStore.open(root);
    const result = await reopened.reanchor("fixture.md", s.version);
    expect(result.document.items[0].attachment.status).toBe("orphaned");
  });
  it("follows successive edits, retaining the original selector and every item", async () => {
    let saved = await seed();
    const original = saved.document.items[0].originalAnchor;
    for (const replacement of ["Use Redis for short-lived session storage.", "Use Redis for short-lived session storage!"]) {
      writeFileSync(path.join(root, "fixture.md"), text.replace(quote, replacement));
      saved = await store.reanchor("fixture.md", saved.version);
      expect(saved.document.items).toHaveLength(1);
      expect(saved.document.items[0]).toMatchObject({ id: "answer-1", body: "Synthetic ink only.", anchor: { quote: replacement }, originalAnchor: original,
        attachment: { status: "attached", from: text.indexOf(quote), to: text.indexOf(quote) + replacement.length } });
    }
  });

  it("retains deletions and missing notes as orphans and recovers when text returns", async () => {
    let saved = await seed();
    writeFileSync(path.join(root, "fixture.md"), "# Fixture\n\nEnd.");
    saved = await store.reanchor("fixture.md", saved.version);
    expect(saved.document.items[0].attachment.status).toBe("orphaned");
    rmSync(path.join(root, "fixture.md"));
    saved = await store.reanchor("fixture.md", saved.version);
    expect(saved.document.items[0].attachment).toEqual({ status: "orphaned", reason: "note-missing" });
    expect(saved.document.noteVersion).toBeNull();
    writeFileSync(path.join(root, "fixture.md"), text);
    saved = await store.reanchor("fixture.md", saved.version);
    expect(saved.document.items).toHaveLength(1);
    expect(saved.document.items[0].attachment.status).toBe("attached");
  });

  it.each([Buffer.from(text), Buffer.from("\ufeff" + text.replaceAll("\n", "\r\n")), Buffer.from(text.replace("\n", "\r\n"))])("preserves original note bytes, including BOM and mixed endings", async bytes => {
    writeFileSync(path.join(root, "fixture.md"), bytes);
    const s = await seed();
    await store.reanchor("fixture.md", s.version);
    expect(readFileSync(path.join(root, "fixture.md"))).toEqual(bytes);
  });

  it("keeps saved ink intact when the note cannot be decoded", async () => {
    const s = await seed();
    const old = readFileSync(file());
    const bad = Buffer.from([0xff, 0xfe]);
    writeFileSync(path.join(root, "fixture.md"), bad);
    await expect(store.reanchor("fixture.md", s.version)).rejects.toThrow();
    expect(readFileSync(file())).toEqual(old);
    expect(readFileSync(path.join(root, "fixture.md"))).toEqual(bad);
  });
});
