// Phase 5 check: the Skills tab opens on the REAL discovered skill count and never renders the whole list; the chat persona switch works;
// the quiet "Used:" line shows on an AI thought and on a chat reply. Synthetic note, no provider. Skills are read from your real home
// folders (read-only, counted, never copied or sent anywhere).
// Run: BATCH2A_OUTPUT=<dir outside the repo> node check/skills.mjs   (after `vite build`)
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { InkStore } from "../server/ink-store.ts";
import { ChatStore } from "../server/chat/store.ts";
import { defaultRoots, discoverSkills } from "../server/skills.ts";
import { captureAnchor } from "../shared/anchors.ts";

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.env.BATCH2A_OUTPUT ?? "");
assert(process.env.BATCH2A_OUTPUT && !output.toLowerCase().startsWith(path.resolve(uiDir, "..").toLowerCase()), "Output must be outside repo");
mkdirSync(output, { recursive: true });
const project = mkdtempSync(path.join(os.tmpdir(), "aitiarch-skills-check-"));
const root = path.join(project, ".aitiarch");
mkdirSync(root);
execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
writeFileSync(path.join(root, ".gitignore"), "/chat/\n/ui-state.json*\n");
const alpha = "Alpha paragraph: the human wrote this sentence themselves.";
const original = ["# Skills fixture", "", alpha, "", "End of the note.", ""].join("\n");
writeFileSync(path.join(root, "notebook.md"), original);
let browser, proc;
try {
  // What the app should find: the same discovery the server runs, over your real skill folders.
  const expected = (await discoverSkills(defaultRoots(os.homedir(), project))).length;
  assert(expected >= 25, `This check needs your real skill library (found ${expected}); it is not meant to run against a tiny fixture.`);

  const ink = await InkStore.open(root);
  const s = await ink.read("notebook.md");
  const anchor = captureAnchor(original, original.indexOf(alpha), original.indexOf(alpha) + alpha.length);
  s.document.items.push({ id: "g1", kind: "answer", body: "A fixture AI thought that used a skill.", anchor, originalAnchor: anchor,
    attachment: { status: "attached", from: original.indexOf(alpha), to: original.indexOf(alpha) + alpha.length },
    generation: { requestId: "g1", action: "think", provider: "claude", model: null, createdAt: new Date().toISOString(), status: "complete", evidence: [], dismissed: false, skills: ["grill-me"] } });
  await ink.write("notebook.md", s.document, s.version);
  await new ChatStore(root).append("notebook.md", { id: "m1", role: "assistant", body: "A fixture chat reply that used a skill.", at: new Date().toISOString(), provider: "claude", model: null,
    evidence: [], usage: null, insertionBlocked: false, skills: ["archify"] });

  proc = spawn(process.execPath, [path.join(uiDir, "server", "main.ts"), "--root", root, "--port", "0", "--no-open"], { cwd: uiDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AITIARCH_CONFIG_DIR: path.join(project, "config") } });
  const url = await new Promise((resolve, reject) => {
    let out = "";
    proc.stdout.on("data", (d) => { out += d; const m = /AITIARCH_READY (.*)/.exec(out); if (m) resolve(JSON.parse(m[1]).launch); });
    proc.on("exit", (c) => reject(new Error(`Server exited early (${c}).`)));
    setTimeout(() => reject(new Error("Server startup timeout.")), 10000);
  });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 2200, height: 1000 } });
  await page.goto(url + "&debug");

  // 1. The "Used:" line on an AI thought.
  const thought = page.locator(".margin-card.thought-blob");
  await thought.first().waitFor({ timeout: 10000 });
  assert.equal((await thought.locator(".used-skills").first().innerText()).replace(/\s+/g, " ").trim(), "Used: grill-me", "an AI thought names the skill it used");

  // 2. The chat: persona switch renders, works by keyboard, and the saved reply shows "Used:".
  await page.getByRole("button", { name: /^Chat/ }).first().click();
  const panel = page.locator("#chat-panel");
  await panel.waitFor();
  const sw = panel.locator(".persona-switch");
  await sw.waitFor();
  const labels = (await sw.locator(".persona-option").allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(labels, ["Plan with me", "Grill me", "Explain"], "the three personas, in order");
  assert(await sw.getByRole("radio", { name: "Plan with me" }).isChecked(), "chat defaults to Plan with me");
  assert((await sw.locator(".persona-line").first().innerText()).includes("ends on one question"), "the chosen persona has its one-line description");
  await sw.getByRole("radio", { name: "Plan with me" }).focus();
  await page.keyboard.press("ArrowRight");
  assert(await sw.getByRole("radio", { name: "Grill me" }).isChecked(), "arrow keys move the choice");
  await page.waitForFunction(async () => (await (await fetch("/api/nodes")).json()).nodes.chat.persona === "grill");
  assert((await sw.locator(".persona-line").first().innerText()).includes("one hard question"), "the description follows the choice");
  const reply = panel.locator(".chat-ai .used-skills");
  await reply.first().waitFor({ timeout: 10000 });
  assert.equal((await reply.first().innerText()).replace(/\s+/g, " ").trim(), "Used: archify", "a chat reply names the skill it used");
  await page.screenshot({ path: path.join(output, "skills-chat.png") });
  await page.getByRole("button", { name: "Close chat" }).click();

  // 3. The Skills tab: the real count, and never the whole list.
  await page.getByRole("button", { name: "Notes menu", exact: true }).click();
  await page.getByRole("button", { name: "AI settings" }).click();
  const dialog = page.getByRole("dialog", { name: "AI settings" });
  await dialog.waitFor();
  await dialog.getByRole("tab", { name: "Skills" }).click();
  const count = dialog.locator(".skills-count");
  await count.waitFor();
  await page.waitForFunction(() => /^[\d,]+ skills found/.test(document.querySelector(".skills-count")?.textContent ?? "") && !document.querySelector(".skills-count").textContent.startsWith("0 "));
  const shown = Number((await count.innerText()).match(/^([\d,]+) skills found/)[1].replace(/,/g, ""));
  assert.equal(shown, expected, `the tab reports the real discovered count (${expected})`);
  const cards = () => dialog.locator(".skill-card").count();
  const opening = await cards();
  assert(opening <= 12, `opens on a short view: ${opening} cards, not ${shown}`);
  assert(opening < shown / 2, "far fewer cards than skills");
  assert.equal(await dialog.locator(".skills-search input").evaluate((el) => el.type === "search"), true, "a search box is there");
  assert((await dialog.locator(".skills-tab h4").allInnerTexts()).includes("Recommended"), "Recommended is shown");
  assert((await dialog.locator(".skills-tab h4").allInnerTexts()).includes("Recently used"), "Recently used is shown");
  await page.screenshot({ path: path.join(output, "skills-tab-open.png") });

  // 4. Searching shows a bounded set, says how many matched, and attaching to a step works and can be undone.
  await dialog.locator(".skills-search input").fill("a");
  await page.waitForFunction(() => document.querySelectorAll(".skills-results .skill-card").length > 0);
  const searched = await cards();
  assert(searched <= 12 + 50, `a search is capped: ${searched} cards`);
  assert(searched < shown, "a search never renders the whole library");
  const first = dialog.locator(".skills-results .skill-card").first();
  await first.getByRole("button", { name: /^Think/ }).click();
  await dialog.locator("section[aria-label='Think settings'] .skill-step-count").filter({ hasText: "1 of 6 skills" }).waitFor();
  assert.equal(await first.getByRole("button", { name: /^Think/ }).getAttribute("aria-pressed"), "true", "the attach button says it is in use");
  await dialog.locator("section[aria-label='Think settings']").getByRole("button", { name: /^Remove/ }).click();
  await dialog.locator("section[aria-label='Think settings'] .skill-step-count").filter({ hasText: "0 of 6 skills" }).waitFor();
  await page.screenshot({ path: path.join(output, "skills-tab-search.png") });

  console.log(JSON.stringify({ passed: true, discoveredSkills: expected, openingCards: opening, searchCards: searched }, null, 1));
} finally {
  await browser?.close();
  proc?.kill();
  rmSync(project, { recursive: true, force: true });
}
