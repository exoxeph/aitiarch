import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureAnchor, suggestAnchorCandidates } from "../shared/anchors.ts";
import { InkStore } from "../server/ink-store.ts";
import { Store } from "../server/store.ts";
import { NoteWatcher } from "../server/watch.ts";
import { createApp } from "../server/http.ts";
import { resolveStoredAttachment } from "../shared/ink.ts";

const project = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aitiarch-ink-view-")));
const root = path.join(project, ".aitiarch");
const note = "# Fixture\n\nAlpha selected paragraph.\n\nBeta selected paragraph.\n\nEnd.\n";
mkdirSync(root);
writeFileSync(path.join(root, "notebook.md"), note);
let watcher: NoteWatcher, app: ReturnType<typeof createApp>, base: string, cookie: string;
const url = () => `http://127.0.0.1:${base}`;
beforeAll(async () => {
  const store = await Store.open(root);
  const ink = await InkStore.open(root);
  const first = await ink.read("notebook.md");
  const from = note.indexOf("Alpha selected paragraph.");
  const a = captureAnchor(note, from, from + "Alpha selected paragraph.".length);
  first.document.items.push({ id: "answer-1", kind: "answer", body: "Fixture answer.", anchor: a, originalAnchor: a,
    attachment: { status: "attached", from, to: from + a.quote.length } });
  const missing = captureAnchor("Unrelated intro.\n\nAlpha missing quote.\n\nEnd.", 18, 38);
  first.document.items.push({ id: "orphan-1", kind: "margin", body: "Fixture orphan.", anchor: missing, originalAnchor: missing,
    attachment: { status: "orphaned", reason: "missing" } });
  await ink.write("notebook.md", first.document, first.version);
  watcher = new NoteWatcher(store, 100, 10);
  await watcher.start();
  app = createApp({ store, watcher, distDir: path.join(project, "no-dist") });
  base = String(await app.listen(0));
  const r = await fetch(url() + "/api/session");
  cookie = r.headers.get("set-cookie")!.split(";")[0];
});
afterAll(async () => { watcher.stop(); await app.close(); rmSync(project, { recursive: true, force: true }); });
const get = (p: string) => fetch(url() + p, { headers: { cookie } });
const put = (p: string, body: unknown) => fetch(url() + p, { method: "PUT", headers: { cookie, "Content-Type": "application/json", "X-Aitiarch": "1", Origin: url() }, body: JSON.stringify(body) });

it("exposes persisted fake ink to the authenticated UI without modifying Markdown", async () => {
  expect((await fetch(url() + "/api/ink?path=notebook.md")).status).toBe(401);
  const before = readFileSync(path.join(root, "notebook.md"));
  const r = await get("/api/ink?path=notebook.md");
  expect(r.status).toBe(200);
  const data = await r.json();
  expect(data.document.items.map((i: { id: string }) => i.id)).toEqual(["answer-1", "orphan-1"]);
  expect(data.version).toMatch(/^[a-f0-9]{64}$/);
  expect(readFileSync(path.join(root, "notebook.md"))).toEqual(before);
});

it("offers exact and similar orphan locations as suggestions without attaching automatically", () => {
  const old = "Intro\n\nSame quote here.\n\nEnd";
  const a = captureAnchor(old, 7, 23);
  const changed = "Different intro\n\nSame quote here.\n\nSame quote here.\n\nEnd";
  expect(suggestAnchorCandidates(changed, a).map(c => changed.slice(c.from, c.to))).toEqual(["Same quote here.", "Same quote here."]);
  expect(suggestAnchorCandidates("Everything was removed.", a)).toEqual([]);
});

it("manual re-attachment saves the new selector and history in one sidecar, never Markdown", async () => {
  const ink = await InkStore.open(root);
  const first = await ink.read("notebook.md");
  const original = structuredClone(first.document.items[1].originalAnchor);
  const beforeNote = readFileSync(path.join(root, "notebook.md"));
  const from = note.indexOf("Beta selected paragraph.");
  const r = await put("/api/ink/attach", { path: "notebook.md", id: "orphan-1", inkVersion: first.version,
    noteVersion: first.document.noteVersion, from, to: from + "Beta selected paragraph.".length });
  expect(r.status).toBe(200);
  const second = await ink.read("notebook.md");
  expect(second.document.items[0]).toEqual(first.document.items[0]);
  expect(second.document.items[1]).toMatchObject({ id: "orphan-1", anchor: { quote: "Beta selected paragraph.", position: { from } },
    originalAnchor: original, attachment: { status: "attached", from } });
  expect(second.document.items[1].anchorHistory).toContainEqual(original);
  expect(readFileSync(path.join(root, "notebook.md"))).toEqual(beforeNote);
});

it("rejects re-attachment when the note changed after selection", async () => {
  const ink = await InkStore.open(root);
  const first = await ink.read("notebook.md");
  const sidecar = readFileSync(path.join(root, "ink", "notebook.ink.json"));
  const oldVersion = first.document.noteVersion;
  writeFileSync(path.join(root, "notebook.md"), note + "Outside edit.\n");
  const r = await put("/api/ink/attach", { path: "notebook.md", id: "orphan-1", inkVersion: first.version,
    noteVersion: oldVersion, from: 0, to: 9 });
  expect(r.status).toBe(409);
  expect(readFileSync(path.join(root, "ink", "notebook.ink.json"))).toEqual(sidecar);
});

it("trusts a human-picked duplicate on reload only at the exact saved note version", () => {
  const text = "A repeated quote.\n\nA repeated quote.";
  const a = captureAnchor(text, 0, "A repeated quote.".length);
  const item = { id: "manual", kind: "margin" as const, body: "Fixture", anchor: a, originalAnchor: a, anchorHistory: [a],
    attachment: { status: "attached" as const, from: 0, to: a.quote.length } };
  expect(resolveStoredAttachment(text, item, "saved", "saved")).toEqual(item.attachment);
  expect(resolveStoredAttachment(text, item, "saved", "changed").status).toBe("orphaned");
});
