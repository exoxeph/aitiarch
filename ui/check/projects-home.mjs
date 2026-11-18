// PHASE 2 CHECK: projects home, Add project, and the explorer (real browser, throwaway fixtures, temp registry).
//   - the explorer is a keyboard tree; index.md is the Main note and opens by default
//   - renaming a note shows which files change, then rewrites only the link-target bytes (BOM and CRLF kept)
//   - dragging a note onto a folder moves it
//   - the home shows a card per project with its numbers and thumbnail; Add project previews Initialize and writes nothing until the click
//   - Remove forgets a project and deletes no file
// Never touches the real %APPDATA%\aitiarch (AITIARCH_CONFIG_DIR is a temp folder) or any real notebook.   Run: node check/projects-home.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url)), uiDir = path.resolve(here, "..");
const shots = process.env.PHASE2_SHOTS ?? "C:\\Users\\UseR\\Documents\\aitiarch-trial\\design-d3\\screenshots\\phase2";
mkdirSync(shots, { recursive: true }); mkdirSync(path.join(here, "out"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realConfig = path.join(process.env.APPDATA ?? os.homedir(), "aitiarch", "projects.json");
const realBefore = existsSync(realConfig) ? statSync(realConfig).mtimeMs : null;

const base = mkdtempSync(path.join(os.tmpdir(), "aitiarch-p2-"));
const mk = (name, files) => { const p = path.join(base, name); for (const [rel, body] of Object.entries(files)) { const f = path.join(p, ".aitiarch", ...rel.split("/")); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); } return p; };
const INDEX = "\uFEFF# Home\r\nSee [Plan](auth/plan.md#token) and [A](a.md).\r\n";
const A = mk("alpha", { "index.md": Buffer.from(INDEX, "utf8"), "auth/plan.md": "# Plan\n", "a.md": "# A\n", "b.md": "[home](index.md)\n" });
const B = mk("beta", { "index.md": "# Beta\n" });
const C = path.join(base, "gamma"); mkdirSync(C);
const config = path.join(base, "config");

const results = [], check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };

function start() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(uiDir, "server", "main.ts"), "--root", A, "--port", "0", "--no-open"], { cwd: uiDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AITIARCH_TEST:"1", AITIARCH_CONFIG_DIR: config } });
    let buf = ""; proc.stdout.on("data", (d) => { buf += d; const m = /AITIARCH_READY (.*)/.exec(buf); if (m) resolve({ proc, ready: JSON.parse(m[1]) }); });
    proc.stderr.on("data", (d) => { const s = String(d); if (!/ExperimentalWarning|--trace-warnings/.test(s)) process.stderr.write(s); });
    proc.on("exit", (c) => reject(new Error(`server exited early (${c})`))); setTimeout(() => reject(new Error("server did not start")), 10000);
  });
}
const { proc, ready } = await start();
let browser;
for (const channel of ["msedge", "chrome"]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* next */ } }
if (!browser) throw new Error("No Edge or Chrome found");
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(), errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} ${m.location()?.url ?? ""}`.trim()));
const row = (p) => page.locator(`[role="treeitem"][data-path="${p}"]`);
const read = (p) => readFileSync(path.join(A, ".aitiarch", ...p.split("/")));
const key = async (k) => { await page.keyboard.press(k); await sleep(110); }; // focus moves a frame after the key
const focused = () => page.evaluate(() => document.activeElement?.dataset.path);
const alerts = () => page.evaluate(() => `input=[${document.querySelector("#project-path")?.value}] ` + [...document.querySelectorAll('[role="alert"], .dialog')].map((e) => e.innerText.replace(/\s+/g, " ").slice(0, 120)).join(" || ")).catch(() => "");
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; };
const openAddProject=async()=>{
  await page.click('button:has-text("Add project")');
  // Initial folder browsing populates this controlled input asynchronously. Do not
  // race Playwright's select-all/insertText with that initial value assignment.
  await page.waitForFunction(()=>{
    const input=document.querySelector('#project-path'),here=document.querySelector('.browse-here');
    return input&&here&&here.textContent!=='Loading…'&&input.value===here.textContent;
  });
};

try {
  // ---- the notebook: Main note, default tab, keyboard tree
  await page.goto(`${ready.launch}&debug=1`);
  await page.waitForSelector(".cm-content", { timeout: 10000 });
  check("opens at the project named in the launch link", /project=[0-9a-f]{12}/.test(page.url()), page.url());
  check("the root index.md opens by default", (await page.locator(".tab.on").first().textContent())?.includes("index") ?? false);
  await page.click('button[aria-label="Notes menu"]');
  await page.waitForSelector('[role="tree"] [role="treeitem"]', { state: "visible" });
  const mainBadge = await row("index.md").locator(".ex-badge").textContent();
  check("index.md carries the Main badge", mainBadge === "Main", String(mainBadge));
  const order = await page.locator('[role="treeitem"]').evaluateAll((els) => els.map((e) => e.dataset.path));
  check("folders first, then index.md, then notes", order.join() === ["auth", "index.md", "a.md", "b.md"].join(), order.join());
  await row("auth").focus();
  await key("ArrowRight");
  check("Right opens a folder", (await row("auth").getAttribute("aria-expanded")) === "true");
  await key("ArrowDown");
  check("Down moves to its first note", (await focused()) === "auth/plan.md", String(await focused()));
  await key("ArrowLeft");
  check("Left goes to the parent folder", (await focused()) === "auth", String(await focused()));
  await key("End");
  check("End goes to the last row", (await focused()) === "b.md", String(await focused()));
  await key("Home");
  check("Home goes to the first row", (await focused()) === "auth", String(await focused()));

  // ---- rename with a link-update preview, byte-exact
  await key("ArrowDown"); // auth/plan.md
  await page.keyboard.press("F2");
  await page.waitForSelector("#name-dialog-input");
  await page.keyboard.type("token plan"); await page.keyboard.press("Enter");
  await page.waitForSelector("text=Update links?");
  const listed = await page.locator(".plan-list li code").allTextContents();
  check("the preview lists the file that will change", listed.join() === "index.md", listed.join());
  check("nothing is written before confirming", read("index.md").equals(Buffer.from(INDEX, "utf8")) && existsSync(path.join(A, ".aitiarch", "auth", "plan.md")));
  await page.screenshot({ path: path.join(shots, "move-preview.png") });
  await page.click("text=Move and update links");
  await page.waitForSelector("text=Update links?", { state: "detached" });
  const want = Buffer.from(INDEX.replace("(auth/plan.md#token)", "(auth/token%20plan.md#token)"), "utf8");
  check("only the link-target bytes changed (BOM and CRLF kept)", await until(() => read("index.md").equals(want)), read("index.md").toString("utf8"));
  check("the note moved on disk", existsSync(path.join(A, ".aitiarch", "auth", "token plan.md")) && !existsSync(path.join(A, ".aitiarch", "auth", "plan.md")));
  await sleep(700);
  const shown = await page.evaluate(() => window.__aitiarch?.["index.md"]?.view.state.doc.toString() ?? "");
  check("the open editor picked up the rewritten link without a conflict", shown.includes("auth/token%20plan.md") && !(await page.locator(".cm-conflict").count()), shown.slice(0, 120));

  // ---- drag to move: index.md links to a.md, so the preview comes first
  await row("a.md").dragTo(row("auth"));
  await page.waitForSelector("text=Update links?", { timeout: 6000 });
  await page.click("text=Move and update links");
  check("dragging a note onto a folder moves it", await until(() => existsSync(path.join(A, ".aitiarch", "auth", "a.md"))), `page says: ${await alerts()}`);
  check("the link to the moved note was updated", await until(() => read("index.md").toString("utf8").includes("(auth/a.md)")), read("index.md").toString("utf8"));

  await row("auth/a.md").waitFor({ timeout: 6000 }); // the moved note is in view: its folder opened
  await page.screenshot({ path: path.join(shots, "explorer.png") }); // the explorer open, after a rename and a drag
  // ---- new note
  await page.click('.menu-actions button:has-text("New note")');
  await page.waitForSelector("#name-dialog-input"); await page.keyboard.type("Ideas"); await page.keyboard.press("Enter");
  check("New note lands beside the selected note, with its title", (await until(() => existsSync(path.join(A, ".aitiarch", "auth", "Ideas.md")))) && read("auth/Ideas.md").toString() === "# Ideas\n", `found: ${[".", "auth"].map((d) => d + "=" + readdirSync(path.join(A, ".aitiarch", d)).join("|")).join(" ")}`);

  // ---- the home
  await page.goto(`${new URL(page.url()).origin}/?home=1&debug=1`);
  await page.waitForSelector(".project-card");
  check("the home shows the project as a card", (await page.locator(".project-card").count()) === 1);
  await page.waitForSelector(".card-stats span:not(.card-loading)");
  const stats = await page.locator(".card-stats").first().textContent();
  check("the card shows its numbers", /\d+ notes?/.test(stats ?? ""), String(stats));
  check("the card draws its constellation", (await page.locator(".card-thumb circle").count()) >= 3);

  // ---- Add project: an already-notebook folder, then a plain folder with a preview
  await openAddProject();
  await page.fill("#project-path", B); await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.waitForSelector("text=already an Aitiarch notebook");
  await page.click('button:has-text("Add this project")');
  check("an existing notebook is added to the list", await until(async () => (await page.locator(".project-card").count()) === 2));
  await openAddProject();
  await page.fill("#project-path", C); await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.waitForFunction((p) => document.querySelector(".browse-here")?.textContent === p, C, { timeout: 8000 }); // the listing is for gamma
  await page.waitForSelector('.add-detail:has-text("not an Aitiarch notebook yet")');
  check("a plain folder offers no Initialize until it is chosen", (await page.locator('button:has-text("Initialize and add")').count()) === 0);
  await page.click('button:has-text("Use this folder")');
  await page.waitForSelector('.add-detail strong:text("gamma")');
  await page.waitForSelector(".plan-list li");
  const plan = await page.locator(".plan-list li code").allTextContents();
  check("Initialize previews exactly what it will create", plan.join() === ".aitiarch/index.md,.aitiarch/.gitignore", plan.join());
  check("nothing was written by the preview", readdirSync(C).length === 0);
  await page.screenshot({ path: path.join(shots, "add-project.png") });
  await page.click('button:has-text("Initialize and add")');
  check("the new project is on the list", await until(async () => (await page.locator(".project-card").count()) === 3));
  check("Initialize creates only the planned files", readdirSync(path.join(C, ".aitiarch")).sort().join() === ".gitignore,index.md");

  // ---- remove forgets, never deletes
  const gamma = page.locator('.project-card:has-text("gamma")');
  await gamma.locator('button:has-text("Remove")').click();
  await gamma.locator('button:has-text("Remove from list")').click();
  check("Remove takes it off the list", await until(async () => (await page.locator(".project-card").count()) === 2));
  check("Remove keeps its files", existsSync(path.join(C, ".aitiarch", "index.md")));

  // ---- motion
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".project-card").first().hover(); await sleep(300);
  const t = await page.locator(".project-card").first().evaluate((e) => getComputedStyle(e).transform);
  check("reduced motion removes the card lift", t === "none", t);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.mouse.move(5, 5); await page.locator(".project-card").first().hover(); await sleep(350);
  await page.screenshot({ path: path.join(shots, "home.png") });

  // ---- a card opens its project
  await page.click('.project-card:has-text("alpha") .card-name a');
  await page.locator(".cm-content:visible").first().waitFor({ timeout: 10000 });
  check("opening a card opens that project", /project=[0-9a-f]{12}/.test(page.url()));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  const realAfter = existsSync(realConfig) ? statSync(realConfig).mtimeMs : null;
  check("the real project list was not touched", realBefore === realAfter, `${realBefore} -> ${realAfter}`);
} catch (e) {
  check("check ran to the end", false, `${String(e).split("\n")[0]} | page says: ${await alerts()} | url ${page.url()}`);
  await page.screenshot({ path: path.join(here, "out", "projects-home-failure.png") }).catch(() => {});
} finally {
  await browser.close(); proc.kill(); rmSync(base, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nPHASE 2 CHECK FAILED: ${failed.length} of ${results.length}` : `\nPHASE 2 CHECK PASSED: ${results.length} of ${results.length}`);
process.exit(failed.length ? 1 : 0);
