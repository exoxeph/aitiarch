// A2 check: AI ink must be distinguishable from the human's text without relying on colour. Synthetic fixture, no provider.
// Run: BATCH2A_OUTPUT=<dir outside the repo> node check/ai-human.mjs   (after `vite build`)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
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
  s.document.items.push(item("answer", "answer", "A fixture AI answer shown as a thought.", original.indexOf(alpha), alpha.length));
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
    const page = await browser.newPage({ viewport: { width: 2200, height: 900 }, colorScheme: theme });
    await page.goto(url + "?debug");
    for (const [layout, width, selector] of [["margin",2200,".margin-card.thought-blob"],["narrow",900,".cm-ink-block.thought-blob"]]) {
      await page.setViewportSize({width,height:900});
      await page.locator(selector).first().waitFor({timeout:10000});
      const facts = await page.locator(selector).evaluateAll(elements => {
        const lin=c=>(c/=255)<=.03928?c/12.92:((c+.055)/1.055)**2.4;
        const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
        const L=a=>.2126*lin(a[0])+.7152*lin(a[1])+.0722*lin(a[2]);
        const ratio=(a,b)=>(Math.max(L(a),L(b))+.05)/(Math.min(L(a),L(b))+.05);
        return elements.map(el=>{const cs=getComputedStyle(el),label=el.querySelector('.cm-ink-label'),lcs=getComputedStyle(label);
          return {labelText:label.textContent.trim(),border:[cs.borderTopWidth,cs.borderRightWidth,cs.borderBottomWidth,cs.borderLeftWidth],shadow:cs.boxShadow,
            labelFilled:lcs.backgroundColor!=='rgba(0, 0, 0, 0)',labelWeight:Number(lcs.fontWeight),
            bodyContrast:ratio(rgb(cs.color),rgb(cs.backgroundColor)),labelContrast:ratio(rgb(lcs.color),rgb(lcs.backgroundColor))};});
      });
      assert.equal(facts.length,2,`${theme} ${layout}: both anchored AI thoughts are visible`);
      for(const f of facts){
        assert(/^AI\b/.test(f.labelText),`${theme} ${layout}: explicit AI label`);
        assert(f.labelFilled&&f.labelWeight>=600,`${theme} ${layout}: filled AI label distinguishes authorship without color`);
        assert.deepEqual(new Set(f.border),new Set(['0px']),`${theme} ${layout}: quiet blob, no heavy box or side stripe`);
        assert.equal(f.shadow,'none');
        assert(f.bodyContrast>=4.5,`${theme} ${layout}: body contrast ${f.bodyContrast}`);
        assert(f.labelContrast>=4.5,`${theme} ${layout}: label contrast ${f.labelContrast}`);
      }
      report[`${theme}-${layout}`]=facts;
      assert.equal(await page.evaluate(()=>window.__aitiarch['notebook.md'].view.state.doc.toString()),original,'AI rendering never changes Markdown');
      await page.screenshot({path:path.join(output,`a2-${theme}-${layout}.png`)});
      await page.addStyleTag({content:'html { filter: grayscale(1); }'});
      await page.screenshot({path:path.join(output,`a2-${theme}-${layout}-grayscale.png`)});
      await page.addStyleTag({content:'html { filter: none; }'});
    }
    assert.equal(readFileSync(path.join(root,'notebook.md'),'utf8'),original);
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, report }, null, 1));
} finally {
  await browser?.close();
  proc?.kill();
  rmSync(project, { recursive: true, force: true });
}
