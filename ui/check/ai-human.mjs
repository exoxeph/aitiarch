// A2 check: AI ink must be distinguishable from the human's text without relying on colour. Synthetic fixture, no provider.
// Run: BATCH2A_OUTPUT=<dir outside the repo> node check/ai-human.mjs   (after `vite build`)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { InkStore } from "../server/ink-store.ts";
import { captureAnchor } from "../shared/anchors.ts";

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.env.BATCH2A_OUTPUT ?? "");
assert(process.env.BATCH2A_OUTPUT && !output.toLowerCase().startsWith(path.resolve(uiDir, "..").toLowerCase()), "Output must be outside repo");
mkdirSync(output, { recursive: true });
const project = mkdtempSync(path.join(os.tmpdir(), "aitiarch-ai-human-"));
const root = path.join(project, ".aitiarch");
mkdirSync(root);
const alpha = "Alpha paragraph: the human wrote this sentence themselves.";
const beta = "Beta paragraph: the margin note sits beside this evidence.";
const original = ["# AI versus human fixture", "", alpha, "", beta, "", "End of the note.", ""].join("\n");
writeFileSync(path.join(root, "notebook.md"), original);
let browser, proc;
try {
  const ink = await InkStore.open(root);
  const s = await ink.read("notebook.md");
  const item = (id, kind, body, from, len) => {
    const anchor = captureAnchor(original, from, from + len);
    return { id, kind, body, anchor, originalAnchor: anchor, attachment: { status: "attached", from, to: from + len } };
  };
  s.document.items.push(item("answer", "answer", "A fixture AI answer shown inline.", original.indexOf(alpha), alpha.length));
  s.document.items.push(item("margin-1", "margin", "A fixture AI margin note.", original.indexOf(beta), beta.length));
  await ink.write("notebook.md", s.document, s.version);
  proc = spawn(process.execPath, [path.join(uiDir, "server", "main.ts"), "--root", root, "--port", "0", "--no-open"], { cwd: uiDir, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let out = "";
    proc.stdout.on("data", (d) => { out += d; const m = /AITIARCH_READY (.*)/.exec(out); if (m) resolve(JSON.parse(m[1]).url); });
    proc.on("exit", (c) => reject(new Error(`Server exited early (${c}).`)));
    setTimeout(() => reject(new Error("Server startup timeout.")), 10000);
  });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const report = {};
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    await page.goto(url + "?debug");
    await page.locator(".cm-ink-block").first().waitFor({ timeout: 10000 });
    await page.locator(".margin-card").first().waitFor({ timeout: 10000 });
    const facts = await page.evaluate(() => {
      const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const L = (a) => 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2]);
      const ratio = (a, b) => { const x = L(a), y = L(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
      const probe = (el, labelSel) => {
        const cs = getComputedStyle(el), label = el.querySelector(labelSel), lcs = getComputedStyle(label);
        return {
          labelText: label.textContent.trim(),
          border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
          font: cs.fontFamily.split(",")[0].trim(),
          marginLeft: parseFloat(cs.marginLeft),
          bodyContrast: ratio(rgb(cs.color), rgb(cs.backgroundColor)),
          labelContrast: ratio(rgb(lcs.color), rgb(lcs.backgroundColor)),
        };
      };
      const writing = getComputedStyle(document.querySelector(".cm-content")).fontFamily.split(",")[0].trim();
      return { writingFont: writing, inline: probe(document.querySelector(".cm-ink-block"), ".cm-ink-label"), margin: probe(document.querySelector(".margin-card"), ".margin-label") };
    });
    report[theme] = facts;
    for (const [name, f] of [["inline", facts.inline], ["margin", facts.margin]]) {
      assert(/^AI\b/.test(f.labelText), `${theme} ${name}: label must start with "AI" (got ${f.labelText})`);
      assert.deepEqual(new Set(f.border), new Set(["1px"]), `${theme} ${name}: outline must be 1px on every side, no side stripe (${f.border})`);
      assert.notEqual(f.font, facts.writingFont, `${theme} ${name}: AI type must differ from the writing type`);
      assert(f.bodyContrast >= 4.5, `${theme} ${name}: body contrast ${f.bodyContrast}`);
      assert(f.labelContrast >= 4.5, `${theme} ${name}: label contrast ${f.labelContrast}`);
    }
    assert(facts.inline.marginLeft >= 24, `${theme}: inline AI block must be inset (${facts.inline.marginLeft})`);
    await page.screenshot({ path: path.join(output, `a2-${theme}.png`) });
    await page.addStyleTag({ content: "html { filter: grayscale(1); }" });
    await page.screenshot({ path: path.join(output, `a2-${theme}-grayscale.png`) });
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, report }, null, 1));
} finally {
  await browser?.close();
  proc?.kill();
  rmSync(project, { recursive: true, force: true });
}
