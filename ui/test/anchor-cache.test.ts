import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { AnchorCache, textHash } from "../server/anchor-cache.ts";
const roots: string[] = [];
function fixture(ignored = true) {
  const root = mkdtempSync(path.join(os.tmpdir(), "aitiarch-anchor-cache-")); roots.push(root);
  if (ignored) writeFileSync(path.join(root, ".gitignore"), "/.cache/\n");
  return { root, cache: new AnchorCache(root) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it("writes a per-note ignored snapshot and verifies both its stored and expected hash", async () => {
  const { root, cache } = fixture();
  const text = "# Synthetic note\n\nPrivate fixture text.\n";
  expect(await cache.save("folder/note.md", text)).toBe(true);
  expect(await cache.load("folder/note.md", textHash(text))).toBe(text);
  expect(await cache.load("folder/note.md", textHash("Different version"))).toBe(null);
  const file = path.join(root, ".cache", "anchors", readdirSync(path.join(root, ".cache", "anchors"))[0]);
  const snapshot = JSON.parse(readFileSync(file, "utf8")); snapshot.text += "tampered";
  writeFileSync(file, JSON.stringify(snapshot));
  expect(await cache.load("folder/note.md", textHash(text))).toBe(null);
});
it("falls back when a snapshot is absent or malformed without deleting evidence", async () => {
  const { root, cache } = fixture();
  expect(await cache.load("note.md", textHash("Old"))).toBe(null);
  await cache.save("note.md", "Old");
  const file = path.join(root, ".cache", "anchors", readdirSync(path.join(root, ".cache", "anchors"))[0]);
  writeFileSync(file, "corrupt evidence");
  expect(await cache.load("note.md", textHash("Old"))).toBe(null);
  expect(readFileSync(file, "utf8")).toBe("corrupt evidence");
});
it("does not create cache or modify git files before the ignore gap is addressed", async () => {
  const { root, cache } = fixture(false);
  expect(await cache.save("note.md", "Fixture")).toBe(false);
  expect(existsSync(path.join(root, ".cache"))).toBe(false);
  expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
  expect(await cache.status()).toMatchObject({ enabled: false, ignoreLine: "/.cache/" });
  writeFileSync(path.join(root, ".gitignore"), "/.cache/\n");
  expect(await cache.save("note.md", "Fixture")).toBe(true);
});
it("does not write snapshots when later negations could expose the cache", async () => {
  const { root, cache } = fixture();
  writeFileSync(path.join(root, ".gitignore"), "/.cache/\n!/.cache/\n");
  expect(await cache.save("note.md", "Synthetic private text")).toBe(false);
  expect(existsSync(path.join(root, ".cache"))).toBe(false);
});
it("checks the actual snapshot path rather than trusting a different ignored probe", async () => {
  const { root, cache } = fixture();
  execFileSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
  writeFileSync(path.join(root, ".gitignore"), `/.cache/*\n!/.cache/anchors/\n/.cache/anchors/*\n!/.cache/anchors/${textHash("note.md")}.json\n`);
  expect(await cache.save("note.md", "Synthetic private text")).toBe(false);
  expect(existsSync(path.join(root, ".cache"))).toBe(false);
});
it("merges the ignore line only on an explicit enable call, preserving existing bytes and avoiding duplicates", async () => {
  const { root, cache } = fixture(false);
  const file = path.join(root, ".gitignore");
  const original = Buffer.from("\ufeff# Existing rules\r\n/private/", "utf8");
  writeFileSync(file, original);
  await cache.status();
  expect(readFileSync(file)).toEqual(original);
  expect(await cache.enable()).toMatchObject({ enabled: true, ignoreLine: "/.cache/" });
  const merged = readFileSync(file);
  expect(merged.subarray(0, original.length)).toEqual(original);
  expect(merged.toString("utf8")).toBe(original.toString("utf8") + "\r\n/.cache/\r\n");
  await cache.enable();
  expect(readFileSync(file)).toEqual(merged);
});
