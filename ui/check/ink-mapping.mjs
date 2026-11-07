// Real-browser mapping check; all notes are synthetic temporary fixtures.
// Run after npm run build: node check/ink-mapping.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { InkStore } from "../server/ink-store.ts";
import { Store } from "../server/store.ts";
import { NoteWatcher } from "../server/watch.ts";
import { createApp } from "../server/http.ts";
import { captureAnchor } from "../shared/anchors.ts";
const project = mkdtempSync(path.join(os.tmpdir(), "aitiarch-mapping-browser-"));
const root = path.join(project, ".aitiarch"); mkdirSync(root);
const quote = "The release keeps a verified checkpoint.";
const text = ["# Mapping fixture", "Typing paragraph.", "## First", quote, "## Second", quote, "End."].join("\n\n");
const originalIgnore = "# Existing fixture rules\n/private/\n";
writeFileSync(path.join(root, ".gitignore"), originalIgnore);
writeFileSync(path.join(root, "fixture.md"), text);
const ink = await InkStore.open(root), s = await ink.read("fixture.md");
const from = text.lastIndexOf(quote), anchor = captureAnchor(text, from, from + quote.length);
for (const kind of ["answer", "margin"]) s.document.items.push({ id: kind, kind, body: `Synthetic ${kind} ink.`, anchor, originalAnchor: anchor, attachment: { status: "attached", ...anchor.position } });
const missing = captureAnchor("Deleted fixture evidence.", 0, 25);
s.document.items.push({ id: "orphan", kind: "margin", body: "Synthetic orphan ink.", anchor: missing, originalAnchor: missing, attachment: { status: "orphaned", reason: "missing" } });
await ink.write("fixture.md", s.document, null);
const store = await Store.open(root), watcher = new NoteWatcher(store, 100, 10); await watcher.start();
const app = createApp({ store, watcher, distDir: path.resolve("dist") });
const url = `http://127.0.0.1:${await app.listen(0)}/?debug`;
let browser;
const errors = [];
try {
  for (const channel of ["msedge", "chrome"]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch {} }
  if (!browser) throw new Error("Install Edge or Chrome to run the browser check.");
  let page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__aitiarch?.["fixture.md"]);
  const enable = page.getByRole("button", { name: "Add /.cache/ to root .gitignore", exact: true });
  await enable.waitFor();
  assert.equal(readFileSync(path.join(root, ".gitignore"), "utf8"), originalIgnore);
  await enable.click();
  await page.getByText("Anchor snapshots enabled. Existing ignore rules were preserved.").waitFor();
  assert.equal(readFileSync(path.join(root, ".gitignore"), "utf8"), originalIgnore + "/.cache/\n");
  await page.locator('[data-ink-id="answer"]').waitFor();
  assert.equal(await page.locator('.orphan-card').count(), 1);
  const edit = async (kind) => page.evaluate(kind => {
    const { view } = window.__aitiarch["fixture.md"];
    const text = view.state.doc.toString();
    if (kind === "duplicate") {
      const at = text.lastIndexOf("The release keeps a verified checkpoint.");
      view.dispatch({ changes: { from: at, insert: "The release keeps a verified checkpoint.\n\n" } });
    } else {
      const at = text.lastIndexOf("verified");
      view.dispatch({ changes: { from: at, to: at + 8, insert: "reviewed" } });
    }
  }, kind);
  await edit("duplicate");
  await page.evaluate(() => window.__aitiarch["fixture.md"].session.flush());
  let saved = await ink.read("fixture.md");
  assert.equal(saved.document.items[0].anchor.position.from, from + quote.length + 2);
  await page.reload(); await page.waitForFunction(() => window.__aitiarch?.["fixture.md"]);
  await page.locator('[data-ink-id="answer"]').waitFor();
  await edit("small");
  await page.evaluate(() => window.__aitiarch["fixture.md"].session.flush());
  saved = await ink.read("fixture.md");
  assert.equal(saved.document.items[0].anchor.quote, quote.replace("verified", "reviewed"));
  assert.equal(saved.document.items[1].anchor.position.from, saved.document.items[0].anchor.position.from);
  assert.equal(saved.document.items.length, 3);
  const before = readFileSync(path.join(root, "fixture.md"), "utf8");
  const after = "An external introduction.\n\n" + before;
  writeFileSync(path.join(root, "fixture.md"), after);
  await page.waitForFunction(() => window.__aitiarch["fixture.md"].view.state.doc.toString().startsWith("An external introduction."));
  await page.waitForFunction(() => !document.body.textContent.includes("Ink mapping could not be saved"));
  await page.waitForTimeout(500);
  await page.reload(); await page.waitForFunction(() => window.__aitiarch?.["fixture.md"]);
  await page.locator('[data-ink-id="answer"]').waitFor();
  assert.equal(readFileSync(path.join(root, "fixture.md"), "utf8"), after);
  await page.close();
  const closedEdit = after.replace("reviewed checkpoint", "checked checkpoint");
  writeFileSync(path.join(root, "fixture.md"), closedEdit);
  page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__aitiarch?.["fixture.md"]);
  await page.locator('[data-ink-id="answer"]').waitFor();
  saved = await ink.read("fixture.md");
  assert.equal(saved.document.items[0].anchor.quote, quote.replace("verified", "checked"));
  assert.equal(readFileSync(path.join(root, "fixture.md"), "utf8"), closedEdit);
  const out = path.resolve("check/out"); mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, "mapping-wide.png"), fullPage: true });
  await page.setViewportSize({ width: 650, height: 850 });
  await page.locator('.pane').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.locator('.cm-ink-block').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "mapping-narrow.png"), fullPage: true });
  assert.equal(await page.locator('.orphan-card').count(), 1);
  assert.deepEqual(errors, []);
  console.log("PASS: explicit cache setup with ignore merge, browser duplicate identity, internal edit, checkpoint/reload, external edit, closed-page snapshot recovery, shared inline/margin/orphan state, narrow viewport, scroll, Markdown bytes.");
} finally { await browser?.close(); watcher.stop(); await app.close(); rmSync(project, { recursive: true, force: true }); }
