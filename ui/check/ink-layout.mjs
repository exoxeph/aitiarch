// Real-browser Task 2 check. All notes and sidecars are synthetic OS-temp fixtures.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { InkStore } from "../server/ink-store.ts";
import { captureAnchor } from "../shared/anchors.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(here, "..");
const out = path.join(here, "out");
mkdirSync(out, { recursive: true });
const project = mkdtempSync(path.join(os.tmpdir(), "aitiarch-ink-layout-"));
const root = path.join(project, ".aitiarch");
mkdirSync(root);
const alpha = "Alpha paragraph: the selected request needs a grounded answer.";
const beta = "Beta paragraph: the margin should stay beside this evidence.";
const repeat = "A repeated passage needs a human choice.";
const original = ["# Task 2 fixture", "", alpha, "", beta, "", repeat, "", repeat, "", "End of the focused section.", "",
  ...Array.from({ length: 50 }, (_, i) => `Filler paragraph ${i + 1}: scroll stays aligned with the editor.\n`) ].join("\n");
const note = path.join(root, "notebook.md");
writeFileSync(note, original);
let browser, proc;
try {
  const ink = await InkStore.open(root);
  const s = await ink.read("notebook.md");
  const item = (id, kind, body, text, from, status = "attached") => {
    const anchor = captureAnchor(text, from, from + (id === "orphan-candidates" ? repeat.length : id === "orphan-manual" ? "Completely absent quote.".length : id === "answer" ? alpha.length : beta.length));
    return { id, kind, body, anchor, originalAnchor: anchor,
      attachment: status === "attached" ? { status: "attached", from, to: from + anchor.quote.length } : { status: "orphaned", reason: "ambiguous" } };
  };
  s.document.items.push(item("answer", "answer", "This is a fixture answer shown inline, below its paragraph.", original, original.indexOf(alpha)));
  s.document.items.push(item("margin-1", "margin", "Fixture margin note one.", original, original.indexOf(beta)));
  s.document.items.push(item("margin-2", "margin", "Fixture margin note two, sharing the same anchor.", original, original.indexOf(beta)));
  s.document.items.push(item("orphan-candidates", "margin", "Choose one of the repeated passages.", original, original.indexOf(repeat), "orphaned"));
  const absent = "Intro\n\nCompletely absent quote.\n\nEnd";
  s.document.items.push(item("orphan-manual", "answer", "This orphan has no likely candidate.", absent, absent.indexOf("Completely absent quote."), "orphaned"));
  await ink.write("notebook.md", s.document, s.version);
  const unchanged = readFileSync(note);

  proc = spawn(process.execPath, [path.join(uiDir, "server", "main.ts"), "--root", root, "--port", "0", "--no-open"], { cwd: uiDir, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    proc.stdout.on("data", d => { output += d; const m = /AITIARCH_READY (.*)/.exec(output); if (m) resolve(JSON.parse(m[1]).url); });
    proc.on("exit", code => reject(new Error(`Server exited early (${code}).`)));
    setTimeout(() => reject(new Error("Server startup timeout.")), 10000);
  });
  for (const channel of ["msedge", "chrome"]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* try next */ }
  }
  if (!browser) throw new Error("Edge or Chrome is required.");
  const page = await browser.newPage({ viewport: { width: 2000, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url + "?debug");
  await page.locator(".thought-blob").first().waitFor({ timeout: 10000 });
  if (await page.locator(".cm-ink-block").count() !== 0) throw new Error("Wide answers must use margins, never inline widgets.");
  await page.waitForFunction(() => document.querySelectorAll(".margin-card").length === 3);
  if (await page.locator(".orphan-card").count() !== 2) throw new Error("Expected two retained orphans.");
  if (await page.getByRole("button", { name: /Attach here/i }).count() < 2) throw new Error("Candidate choices are missing.");
  if (!readFileSync(note).equals(unchanged)) throw new Error("Opening ink changed Markdown bytes.");
  const beforeScroll = await page.locator(".margin-card").count();
  await page.locator(".pane").evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
  await page.waitForTimeout(150);
  const visibleAfterScroll=await page.locator('.margin-card').evaluateAll(els=>els.filter(el=>{const b=el.getBoundingClientRect(),v=el.closest('.thought-rails').getBoundingClientRect();return b.bottom>v.top&&b.top<v.bottom;}).length);
  if(visibleAfterScroll!==0)throw new Error(`Margin ink stayed onscreen after its anchor scrolled away (${beforeScroll}).`);
  if(await page.locator('.thought-connector').count()!==0)throw new Error('Offscreen anchors must have no connector.');
  await page.locator(".pane").evaluate(el => { el.scrollTop = 0; });
  await page.locator(".margin-card").first().waitFor();
  await page.addStyleTag({ content: ".statusbar .root { visibility: hidden !important; }" });
  await page.screenshot({ path: path.join(out, "ink-layout-wide.png"), fullPage: true });
  await page.setViewportSize({ width: 780, height: 820 });
  await page.screenshot({ path: path.join(out, "ink-layout-narrow.png"), fullPage: true });
  await page.setViewportSize({ width: 620, height: 820 });
  await page.waitForFunction(()=>document.querySelectorAll(".cm-ink-block").length===3&&document.querySelectorAll(".orphan-card").length===2);
  if (await page.locator(".cm-ink-block").count() !== 3 || await page.locator(".orphan-card").count() !== 2) throw new Error("Mobile layout lost ink.");
  await page.screenshot({ path: path.join(out, "ink-layout-mobile.png"), fullPage: true });
  const external = await ink.read("notebook.md");
  external.document.items.find(i => i.id === "margin-1").body = "Margin updated outside the browser.";
  await ink.write("notebook.md", external.document, external.version);
  await page.getByText("Margin updated outside the browser.").waitFor({ timeout: 5000 });
  await page.reload();
  await page.locator(".thought-blob").first().waitFor({ timeout: 10000 });
  if (await page.locator(".orphan-card").count() !== 2) throw new Error("Orphans vanished after reload.");
  if (!readFileSync(note).equals(unchanged)) throw new Error("Reload changed Markdown bytes.");
  const firstChoice = page.getByRole("button", { name: /Attach here\? 1/i });
  await firstChoice.click();
  await page.getByRole("button", { name: "Save re-attachment" }).click();
  await page.waitForTimeout(250);
  const afterCandidate = await ink.read("notebook.md");
  const chosen = afterCandidate.document.items.find(i => i.id === "orphan-candidates");
  if (chosen.attachment.status !== "attached" || chosen.anchor.quote !== repeat || !chosen.anchorHistory?.length) throw new Error("Candidate re-attachment was not stored with its new anchor and history.");
  await page.reload();
  await page.locator(".thought-blob").first().waitFor();
  if (await page.locator(".orphan-card").count() !== 1) throw new Error("Re-attached ink did not survive reload.");
  const selectedEnd = original.indexOf("End of the focused section.");
  await page.evaluate(pos => {
    const h = window.__aitiarch?.["notebook.md"];
    h.view.dispatch({ selection: { anchor: pos, head: pos + "End of the focused section.".length }, scrollIntoView: true });
    h.view.focus();
  }, selectedEnd);
  await page.locator('.cm-sel-toolbar').waitFor();await page.waitForTimeout(200);
  const toolbarClear=await page.evaluate(()=>{const t=document.querySelector('.cm-sel-toolbar').getBoundingClientRect(),rail=document.querySelector('.margin-rail'),r=rail.getBoundingClientRect();const bottom=getComputedStyle(rail).position==='static'&&r.top>120?Math.min(innerHeight,r.top):innerHeight;return t.left>=0&&t.right<=innerWidth&&t.top>=0&&t.bottom<=bottom+1;});
  if(!toolbarClear)throw new Error('Selection toolbar exceeds the narrow viewport or overlaps the margin rail.');
  await page.screenshot({path:path.join(out,'toolbar-narrow-rail.png')});
  await page.getByRole("button", { name: "Re-attach to selected text" }).click();
  await page.getByRole("button", { name: "Save re-attachment" }).click();
  await page.waitForTimeout(250);
  const afterManual = await ink.read("notebook.md");
  const manuallyChosen = afterManual.document.items.find(i => i.id === "orphan-manual");
  if (manuallyChosen.attachment.status !== "attached" || manuallyChosen.anchor.quote !== "End of the focused section." || !manuallyChosen.anchorHistory?.length) throw new Error("Selection re-attachment was not stored.");
  await page.reload();
  await page.locator(".thought-blob").first().waitFor();
  await page.waitForTimeout(250);
  if (await page.locator(".orphan-card").count() !== 0) {
    const names = await page.locator(".orphan-card").allTextContents();
    throw new Error(`Manual re-attachment did not survive reload: ${JSON.stringify(names)}, ${JSON.stringify((await ink.read("notebook.md")).document.items.map(i => [i.id, i.attachment.status, i.anchor.quote]))}`);
  }
  if (!readFileSync(note).equals(unchanged)) throw new Error("Re-attaching ink changed Markdown bytes.");
  await page.evaluate(pos => { const h = window.__aitiarch?.["notebook.md"]; h.view.dispatch({ selection: { anchor: pos } }); h.view.focus(); }, selectedEnd);
  await page.keyboard.type(" typed", { delay: 10 });
  const expectedNote = original.replace("End of the focused section.", " typedEnd of the focused section.");
  const deadline = Date.now() + 6000;
  while (readFileSync(note, "utf8") !== expectedNote && Date.now() < deadline) await page.waitForTimeout(50);
  if (readFileSync(note, "utf8") !== expectedNote) throw new Error("Typing did not save expected Markdown text.");
  const cursor = await page.evaluate(() => window.__aitiarch?.["notebook.md"].view.state.selection.main.head);
  if (cursor !== selectedEnd + " typed".length) throw new Error("Ink changed the typing cursor.");
  // Re-attaching the candidate orphan adds a third margin card.
  await page.waitForFunction(() => document.querySelectorAll(".thought-blob").length === 5);
  console.log("TASK 2 LAYOUT PASS: initially wide inline 0/margin 3/orphans 2; after re-attachment narrow thoughts 5/orphans 0; candidates, narrow/mobile view, scroll, live sidecar refresh, reload, typing/cursor, byte-exact note except typed bytes");
  console.log(path.join(out, "ink-layout-wide.png"));
  console.log(path.join(out, "ink-layout-narrow.png"));
  console.log(path.join(out, "ink-layout-mobile.png"));
} finally {
  await browser?.close();
  proc?.kill();
  rmSync(project, { recursive: true, force: true });
}
