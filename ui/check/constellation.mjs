// PHASE 4 CHECK: the Constellation (real browser, throwaway fixtures, temp registry, no model calls).
//   - d3-force is not in the first page load; the view opens on the current note and two hops; Global shows every note
//   - a star's card; Path between; Use as chat context sends exactly the chosen notes (checked on the review request, nothing sent to a model)
//   - keyboard parity through the star list; Escape closes and gives focus back
//   - dragged stars stay where you put them, across reopening (ui-state.json is git-ignored in the fixture)
//   - handoff order (cited notes first) and writing handoff.md
//   - reduced motion: settled at once, instant camera; 1,000 synthetic notes draw smoothly; above that, folders cluster
// Never touches the real %APPDATA%\aitiarch or any real notebook.   Run: node check/constellation.mjs   (after vite build)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url)), uiDir = path.resolve(here, "..");
const shots = process.env.PHASE4_SHOTS ?? "C:\\Users\\UseR\\Documents\\aitiarch-trial\\design-d3\\screenshots\\phase4";
mkdirSync(shots, { recursive: true }); mkdirSync(path.join(here, "out"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realConfig = path.join(process.env.APPDATA ?? os.homedir(), "aitiarch", "projects.json");
const realBefore = existsSync(realConfig) ? statSync(realConfig).mtimeMs : null;
const results = [], check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const until = async (fn, ms = 7000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; };

// ---- fixtures
const base = mkdtempSync(path.join(os.tmpdir(), "aitiarch-p4-"));
function project(name, files, git = false) {
  const p = path.join(base, name), notes = path.join(p, ".aitiarch");
  for (const [rel, body] of Object.entries(files)) { const f = path.join(notes, ...rel.split("/")); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); }
  if (git) { execFileSync("git", ["init", "-q"], { cwd: p, stdio: "pipe" }); writeFileSync(path.join(notes, ".gitignore"), "/ui-state.json*\n"); }
  return p;
}
// An open thread (the AI has answered; no takeaway yet), attached to the note's text.
const thread = (id, quote) => ({ id, kind: "margin", body: "AI text", originalAnchor: { quote, prefix: "", suffix: "", position: { from: 0, to: quote.length } }, anchor: { quote, prefix: "", suffix: "", position: { from: 0, to: quote.length } }, attachment: { status: "attached", from: 0, to: quote.length },
  generation: { requestId: "r" + id, action: "think", provider: "claude", model: null, createdAt: "2026-11-01T00:00:00.000Z", status: "complete", evidence: [], dismissed: false } });
const A = project("alpha", {
  "index.md": "# Home\nSee [@Plan](plan.md) and [@Runbook](ops/run.md).\n",
  "plan.md": "# Plan\nBuilt on [@Base](base.md).\n",
  "base.md": "# Base\nThe foundation.\n",
  "ops/run.md": "# Runbook\nA [broken link](gone.md).\n",
  "auth/keys.md": "# Keys\nSee [@Plan](../plan.md).\n",
  "lonely.md": "# Lonely\nNo links here.\n",
  "ink/plan.ink.json": JSON.stringify({ v: 2, note: "plan.md", noteVersion: null, lastSeenTextHash: null, items: [thread("t1", "Built on")] }),
}, true);
const big = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => {
  const folder = `f${i % 12}`, links = [(i * 7 + 3) % n, (i * 13 + 5) % n].filter((j) => j !== i).map((j) => `[n${j}](../f${j % 12}/n${j}.md)`).join(" ");
  return [`${folder}/n${i}.md`, `# Note ${i}\n${links}\n`];
}));
const B = project("big", { "index.md": "# Big\n[n0](f0/n0.md)\n", ...big(999) });
const C = project("bigger", { "index.md": "# Bigger\n", ...big(1300) });

function start(root) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(uiDir, "server", "main.ts"), "--root", root, "--port", "0", "--no-open"], { cwd: uiDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AITIARCH_CONFIG_DIR: path.join(base, "config-" + path.basename(root)) } });
    let buf = ""; p.stdout.on("data", (d) => { buf += d; const m = /AITIARCH_READY (.*)/.exec(buf); if (m) resolve({ proc: p, ready: JSON.parse(m[1]) }); });
    p.stderr.on("data", (d) => { const s = String(d); if (!/ExperimentalWarning|--trace-warnings/.test(s)) process.stderr.write(s); });
    p.on("exit", (c) => reject(new Error(`server exited early (${c})`))); setTimeout(() => reject(new Error("server did not start")), 15000);
  });
}
const procs = [];
let browser;
for (const channel of ["msedge", "chrome"]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* next */ } }
if (!browser) throw new Error("No Edge or Chrome found");

async function openApp(root, reducedMotion = "no-preference") {
  const s = await start(root); procs.push(s.proc);
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, reducedMotion }), page = await ctx.newPage(), errors = [], requests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on("request", (r) => { if (/\/chat\/review$/.test(r.url())) requests.push(r.postData()); if (/\/(assistance\/invoke|chat\/send)$/.test(r.url())) requests.push("MODEL CALL " + r.url()); });
  const t0 = Date.now();
  await page.goto(`${s.ready.launch}&debug=1`);
  await page.locator(".cm-content:visible").first().waitFor({ timeout: 90000 });
  console.log(`      ${path.basename(root)}: editor ready ${Date.now() - t0} ms after opening`);
  return { ctx, page, errors, requests };
}
const snap = (page) => page.evaluate(() => window.__constellation?.snapshot() ?? null);
const openMap = async (page) => { await page.click(".map-pill"); await page.locator(".constellation canvas").waitFor(); await until(async () => (await snap(page))?.stars.length > 0, 15000); };
const star = async (page, p) => (await snap(page)).stars.find((s) => s.path === p);
/** Clicks a star on the canvas itself; fails loudly if a card or bar covers that spot instead of clicking the overlay. */
async function clickStar(page, p, shift = false) {
  await sleep(900); // let any camera glide finish
  const s = await star(page, p), on = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [s.x, s.y]);
  if (on !== "CANVAS") throw new Error(`star ${p} is under ${on}, not on the canvas`);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(s.x, s.y);
  if (shift) await page.keyboard.up("Shift");
}
const listPick = (page, title) => page.locator(".cn-list li button", { hasText: title }).first().click();
const closeCard = async (page) => { if (await page.locator(".cn-card").count()) await page.locator('.cn-card button[aria-label="Close this card"]').click(); };

try {
  // ---- the first page load carries no d3-force
  const entry = readdirSync(path.join(uiDir, "dist", "assets")).filter((f) => /^index-.*\.js$/.test(f)).map((f) => readFileSync(path.join(uiDir, "dist", "assets", f), "utf8")).join("");
  check("d3-force is not in the first page load", !/velocityDecay|alphaDecay/.test(entry));

  const { page, errors, requests } = await openApp(A);
  await openMap(page);
  check("opens on the current note and two links out", (await snap(page)).stars.map((s) => s.path).sort().join() === "auth/keys.md,base.md,index.md,ops/run.md,plan.md", (await snap(page)).stars.map((s) => s.path).join());
  check("the layout settles", await until(async () => (await snap(page)).settled, 10000));
  await page.getByRole("button", { name: "Global", exact: true }).click();
  check("Global shows every note", await until(async () => (await snap(page)).stars.length === 6));

  // ---- a star's card: clicked on the canvas, then from the list
  await closeCard(page);
  let s;
  await clickStar(page, "plan.md");
  await page.locator(".cn-card").waitFor({ timeout: 4000 });
  const card = await page.locator(".cn-card").innerText();
  check("clicking a star shows its card", /Plan/.test(card) && /Has open threads/.test(card) && /Cited by\s*2/.test(card.replace(/\n/g, " ")), card.replace(/\s+/g, " "));
  await listPick(page, "Lonely");
  check("the card names problems in words", /No links in or out/.test(await page.locator(".cn-card").innerText()));
  await listPick(page, "Runbook");
  check("a broken link is named on the card", /1 broken link/.test(await page.locator(".cn-card").innerText()));

  // ---- path between two stars (picked on the canvas), then use them as chat context
  await closeCard(page);
  await clickStar(page, "index.md"); await closeCard(page);
  await clickStar(page, "base.md", true);
  check("Shift+click adds a second star", (await snap(page)).selected.slice().sort().join() === "base.md,index.md", JSON.stringify((await snap(page)).selected));
  await page.getByRole("button", { name: "Path between" }).click();
  check("Path between lights the chain of links", (await page.locator(".cn-path-words").innerText().catch(() => "")) === "Home → Plan → Base", await page.locator(".cn-path-words").innerText().catch(() => ""));
  await page.screenshot({ path: path.join(shots, "constellation-path.png") });
  await page.getByRole("button", { name: "Use as chat context" }).click();
  await page.locator(".chat-from-map").waitFor({ timeout: 4000 });
  check("Use as chat context hands the notes to the chat (the open note is already there)", /1 note/.test(await page.locator(".chat-from-map").innerText()), await page.locator(".chat-from-map").innerText());
  await page.locator('textarea[aria-label="Message Aitiarch AI"]').fill("How do these connect?");
  await page.keyboard.press("Enter");
  await until(async () => requests.some((r) => r && r.includes("How do these connect")), 5000);
  const review = JSON.parse(requests.find((r) => r && r.includes("How do these connect")) ?? "{}");
  const other = (review.context ?? []).find((c) => c.moduleId === "other-notes");
  check("the review request carries exactly the chosen notes (index.md is the open note, so only base.md)", JSON.stringify(other?.ids) === JSON.stringify(["base.md"]), JSON.stringify(review.context));
  check("no model was called", !requests.some((r) => String(r).startsWith("MODEL CALL")));
  if (await page.getByRole("button", { name: "Cancel", exact: true }).count()) await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.keyboard.press("Escape");

  // ---- keyboard: the star list, then Escape gives focus back
  await openMap(page);
  const first = page.locator(".cn-list li button").first();
  await first.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press(" ");
  check("Space in the star list selects a star", (await page.locator('.cn-list li button[aria-pressed="true"]').count()) === 1);
  await page.keyboard.press("Enter");
  check("Enter in the star list opens its card", await page.locator(".cn-card").isVisible());
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  check("Escape closes and gives focus back to the Constellation button", (await page.locator(".constellation").count()) === 0 && (await page.evaluate(() => document.activeElement?.className)) === "map-pill");

  // ---- drag a star; it stays put after reopening
  await openMap(page); await page.getByRole("button", { name: "Global", exact: true }).click(); await until(async () => (await snap(page)).stars.length === 6); await sleep(1500);
  await closeCard(page); await sleep(900);
  s = await star(page, "lonely.md");
  if ((await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [s.x, s.y])) !== "CANVAS") throw new Error("lonely.md is under an overlay");
  await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.mouse.move(s.x + 60, s.y + 40, { steps: 8 }); await page.mouse.move(s.x + 90, s.y + 70, { steps: 8 }); await page.mouse.up();
  check("a dragged star is pinned", (await star(page, "lonely.md")).fx !== null);
  const statePath = path.join(A, ".aitiarch", "ui-state.json");
  check("its place is saved (ui-state.json is git-ignored here)", await until(() => existsSync(statePath) && !!JSON.parse(readFileSync(statePath, "utf8")).starPositions?.["lonely.md"]), existsSync(statePath) ? readFileSync(statePath, "utf8").slice(0, 200) : "no ui-state.json");
  const saved = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")).starPositions?.["lonely.md"] : null;
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await openMap(page); await page.getByRole("button", { name: "Global", exact: true }).click(); await until(async () => (await snap(page)).stars.length === 6);
  check("and it is still there after reopening", !!saved && Math.round((await star(page, "lonely.md")).fx ?? NaN) === saved[0], `${(await star(page, "lonely.md")).fx} vs ${saved?.[0]}`);

  // ---- handoff order and handoff.md
  await page.getByRole("button", { name: "Handoff order" }).click();
  await page.locator(".cn-list ol li").first().waitFor();
  const order = (await page.locator(".cn-list ol li").allInnerTexts()).map((t) => t.trim());
  check("handoff order puts cited notes first", order.indexOf("Base") < order.indexOf("Plan") && order.indexOf("Plan") < order.indexOf("Home") && order.indexOf("Base") >= 0, order.join(" | "));
  await page.getByRole("button", { name: "Write handoff.md…" }).click(); await page.getByRole("button", { name: "Write handoff.md", exact: true }).click();
  check("Write handoff.md writes it, marked as Aitiarch's", await until(() => existsSync(path.join(A, ".aitiarch", "handoff.md")) && readFileSync(path.join(A, ".aitiarch", "handoff.md"), "utf8").startsWith("<!-- aitiarch:handoff -->")));
  await page.screenshot({ path: path.join(shots, "constellation-handoff.png") });
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.context().close();

  // ---- reduced motion: no visible settling, instant camera
  const r = await openApp(A, "reduce");
  await openMap(r.page);
  check("reduced motion: the layout is already settled when it appears", (await snap(r.page)).settled && (await snap(r.page)).reduced);
  await closeCard(r.page);
  s = await star(r.page, "plan.md"); await r.page.mouse.click(s.x, s.y); await sleep(60);
  const ps = await star(r.page, "plan.md"), mid = await r.page.evaluate(() => { const b = document.querySelector(".cn-stage").getBoundingClientRect(); return b.left + b.width / 2; });
  check("reduced motion: choosing a star moves the camera at once", Math.abs(ps.x - mid) < 2, JSON.stringify({ star: ps.x, centre: mid }));
  await r.page.context().close();

  // ---- performance: 1,000 notes drawn star by star; above 1,000, folders cluster
  const big1 = await openApp(B);
  await openMap(big1.page); await big1.page.getByRole("button", { name: "Global", exact: true }).click();
  await until(async () => (await snap(big1.page)).stars.length === 1000, 15000);
  await sleep(2500);
  const frame = (await snap(big1.page)).frameMs;
  console.log(`      1,000 notes: ${frame?.toFixed(1)} ms per frame (${frame ? (1000 / frame).toFixed(0) : "?"} fps) in headless Edge`);
  check("1,000 notes draw at 50 fps or better", frame !== null && frame <= 20, `${frame} ms`);
  await big1.page.screenshot({ path: path.join(shots, "constellation-1000.png") });
  await big1.page.context().close();
  const big2 = await openApp(C);
  await openMap(big2.page); await big2.page.getByRole("button", { name: "Global", exact: true }).click();
  check("above 1,000 notes, folders cluster into one star each", await until(async () => { const x = await snap(big2.page); return x.clustered && x.stars.length === 13; }, 15000), JSON.stringify({ n: (await snap(big2.page))?.stars.length, clustered: (await snap(big2.page))?.clustered }));
  await big2.page.context().close();

  const realAfter = existsSync(realConfig) ? statSync(realConfig).mtimeMs : null;
  check("the real project list was not touched", realBefore === realAfter);
} catch (e) {
  check("check ran to the end", false, String(e).split("\n")[0]);
} finally {
  await browser.close(); for (const p of procs) p.kill(); await sleep(300); rmSync(base, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nPHASE 4 CHECK FAILED: ${failed.length} of ${results.length}` : `\nPHASE 4 CHECK PASSED: ${results.length} of ${results.length}`);
process.exit(failed.length ? 1 : 0);
