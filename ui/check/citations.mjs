// PHASE 3 CHECK: @ citations and backlinks (real browser, throwaway fixture, temp registry).
//   - typing @ opens a note picker; choosing inserts a standard relative markdown link, byte-exact (BOM and CRLF kept), also for #heading links
//   - @ does nothing in inline code or in a URL
//   - citations render as chips; a missing note is a muted chip that says so; hovering shows a preview
//   - Ctrl+click and Enter inside a chip open the note; the note shows who links to it (Backlinks, with a count)
// Never touches the real %APPDATA%\aitiarch or any real notebook.   Run: node check/citations.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url)), uiDir = path.resolve(here, "..");
const shots = process.env.PHASE3_SHOTS ?? "C:\\Users\\UseR\\Documents\\aitiarch-trial\\design-d3\\screenshots\\phase3";
mkdirSync(shots, { recursive: true }); mkdirSync(path.join(here, "out"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realConfig = path.join(process.env.APPDATA ?? os.homedir(), "aitiarch", "projects.json");
const realBefore = existsSync(realConfig) ? statSync(realConfig).mtimeMs : null;

const base = mkdtempSync(path.join(os.tmpdir(), "aitiarch-p3-"));
const proj = path.join(base, "notes"), notes = path.join(proj, ".aitiarch");
const put = (rel, body) => { const f = path.join(notes, ...rel.split("/")); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); };
const INDEX0 = "\uFEFF# Home\r\n\r\n[@Gone](gone.md)\r\n";
put("index.md", Buffer.from(INDEX0, "utf8"));
put("auth/plan.md", "# Auth plan\n\n## Token refresh\nWe refresh tokens every fifteen minutes.\n");
put("other.md", "# Other\n");
const read = (rel) => readFileSync(path.join(notes, ...rel.split("/")));

const results = [], check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const until = async (fn, ms = 7000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; };

const { proc, ready } = await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [path.join(uiDir, "server", "main.ts"), "--root", proj, "--port", "0", "--no-open"], { cwd: uiDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AITIARCH_CONFIG_DIR: path.join(base, "config") } });
  let buf = ""; p.stdout.on("data", (d) => { buf += d; const m = /AITIARCH_READY (.*)/.exec(buf); if (m) resolve({ proc: p, ready: JSON.parse(m[1]) }); });
  p.stderr.on("data", (d) => { const s = String(d); if (!/ExperimentalWarning|--trace-warnings/.test(s)) process.stderr.write(s); });
  p.on("exit", (c) => reject(new Error(`server exited early (${c})`))); setTimeout(() => reject(new Error("server did not start")), 10000);
});
let browser;
for (const channel of ["msedge", "chrome"]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* next */ } }
if (!browser) throw new Error("No Edge or Chrome found");
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(), errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} ${m.location()?.url ?? ""}`.trim()));
const doc = (rel = "index.md") => page.evaluate((r) => window.__aitiarch?.[r]?.view.state.doc.toString() ?? "", rel);
const norm = (s) => s.replace(/^﻿/, "").replace(/\r\n/g, "\n"); // the editor holds LF text without the BOM; the file keeps both (checked on disk)
const picker = page.locator(".cm-tooltip-autocomplete");
const activeNote = () => page.locator(".editor-col").getAttribute("data-note-path");

try {
  await page.goto(`${ready.launch}&debug=1`);
  await page.locator(".cm-content:visible").first().waitFor({ timeout: 10000 });
  await sleep(1500);
  check("opening a note changes no bytes", read("index.md").equals(Buffer.from(INDEX0, "utf8")));
  check("a citation to a missing note shows as a muted chip", (await page.locator(".cm-cite-broken").count()) === 1);

  // ---- the picker, plain note
  await page.locator(".cm-content:visible").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("See @Auth", { delay: 40 });
  await picker.waitFor({ timeout: 6000 });
  const options = await picker.locator("li").allTextContents();
  check("typing @ lists matching notes with their folder", options.length === 1 && /Auth plan/.test(options[0]) && /auth/.test(options[0]), options.join(" | "));
  await page.screenshot({ path: path.join(shots, "picker.png") });
  await page.keyboard.press("Enter");
  const want1 = INDEX0 + "See [@Auth plan](auth/plan.md)";
  check("choosing inserts a standard relative link", (await doc()) === norm(want1), JSON.stringify((await doc()).slice(-60)));
  // The cursor sits right after the new link: its brackets and address must stay hidden, only the chip shows.
  const seeLine = (await page.locator(".cm-line", { hasText: "See" }).first().innerText()).replace(/\s+/g, " ");
  check("the address is not shown while the cursor is at the chip's edge", !/\]\(|auth\/plan\.md|\[/.test(seeLine) && /@Auth plan/.test(seeLine), seeLine);
  check("the file on disk is byte-exact (BOM and CRLF kept)", await until(() => read("index.md").equals(Buffer.from(want1, "utf8"))), read("index.md").toString("utf8"));

  // ---- heading link
  await page.keyboard.type(" and @Auth plan#tok", { delay: 40 });
  await picker.waitFor({ timeout: 6000 });
  check("after # the picker lists that note's headings", /Token refresh/.test((await picker.locator("li").allTextContents()).join(" ")));
  await page.keyboard.press("Enter");
  const want2 = want1 + " and [@Auth plan#Token refresh](auth/plan.md#token-refresh)";
  check("a heading link carries the slug", (await doc()) === norm(want2), JSON.stringify((await doc()).slice(-90)));
  check("and is byte-exact on disk", await until(() => read("index.md").equals(Buffer.from(want2, "utf8"))), read("index.md").toString("utf8"));

  // ---- no trigger in code or URLs
  await page.keyboard.type(" `code @Au", { delay: 40 }); await sleep(500);
  check("@ does nothing in inline code", (await picker.count()) === 0);
  await page.keyboard.type("` https://x.com/@Au", { delay: 40 }); await sleep(500);
  check("@ does nothing in a URL", (await picker.count()) === 0);
  await page.keyboard.press("Escape");
  await until(async () => norm(read("index.md").toString("utf8")) === (await doc()));

  // ---- chips, preview, opening
  await page.evaluate(() => window.__aitiarch["index.md"].view.dispatch({ selection: { anchor: 2 } })); await sleep(300);
  const chips = await page.locator(".cm-cite:not(.cm-cite-broken)").evaluateAll((els) => els.map((e) => [e.dataset.cite, e.dataset.citeHeading]));
  check("citations render as chips", chips.length === 2 && chips[0][0] === "auth/plan.md" && chips[1][1] === "token-refresh", JSON.stringify(chips));
  await page.locator(".cm-cite:not(.cm-cite-broken)").first().hover();
  await page.locator(".cm-cite-tip").waitFor({ timeout: 4000 });
  const tip = await page.locator(".cm-cite-tip").innerText();
  check("hovering a chip previews the note", /tokens every fifteen minutes/.test(tip) && /auth\/plan\.md/.test(tip), tip);
  await page.mouse.move(900, 650); await sleep(300);
  await page.locator(".cm-cite-broken").hover();
  await page.locator(".cm-cite-tip").waitFor({ timeout: 4000 });
  check("a broken chip says the note was not found", /Note not found - fix link/.test(await page.locator(".cm-cite-tip").innerText()));
  await page.mouse.move(900, 650); await sleep(300);
  await page.screenshot({ path: path.join(shots, "chips.png") });

  const beforeOpen = read("index.md");
  await page.locator(".cm-cite:not(.cm-cite-broken)").first().click({ modifiers: ["Control"] });
  check("Ctrl+click opens the cited note", await until(async () => (await activeNote()) === "auth/plan.md"), String(await activeNote()));
  await sleep(1500);
  check("opening a citation never edits the citing note", read("index.md").equals(beforeOpen));

  // ---- backlinks, on the cited note
  const pill = page.locator(".backlinks-pill");
  check("the note shows how many notes link to it", await until(async () => /1/.test((await pill.textContent().catch(() => "")) ?? "")));
  await pill.click();
  const panel = page.locator(".backlinks");
  await panel.waitFor({ timeout: 4000 });
  const bl = await panel.innerText();
  check("Backlinks lists the citing note with its line", /Home/.test(bl) && /2 links/.test(bl) && /\[@Auth plan\]/.test(bl), bl.replace(/\s+/g, " "));
  await page.screenshot({ path: path.join(shots, "backlinks.png") });
  await panel.locator("button").first().click();
  check("a backlink opens the citing note", await until(async () => (await activeNote()) === "index.md"), String(await activeNote()));

  // ---- keyboard: Enter inside a chip opens it
  const pos = (await doc()).indexOf("[@Auth plan](auth/plan.md)") + 4;
  await page.locator(".cm-content:visible").first().click();
  await page.evaluate((p) => window.__aitiarch["index.md"].view.dispatch({ selection: { anchor: p } }), pos);
  await page.keyboard.press("Enter");
  check("Enter inside a chip opens the note", await until(async () => (await activeNote()) === "auth/plan.md"), String(await activeNote()));
  check("and did not insert a newline", !(await doc("index.md")).includes("[@Au\nth"));

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  const realAfter = existsSync(realConfig) ? statSync(realConfig).mtimeMs : null;
  check("the real project list was not touched", realBefore === realAfter, `${realBefore} -> ${realAfter}`);
} catch (e) {
  check("check ran to the end", false, String(e).split("\n")[0]);
  await page.screenshot({ path: path.join(here, "out", "citations-failure.png") }).catch(() => {});
} finally {
  await browser.close(); proc.kill(); rmSync(base, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nPHASE 3 CHECK FAILED: ${failed.length} of ${results.length}` : `\nPHASE 3 CHECK PASSED: ${results.length} of ${results.length}`);
process.exit(failed.length ? 1 : 0);
