// PHASE 1 CHECK
//
//   While a human types in one paragraph, a separate process edits a DIFFERENT paragraph of the same
//   note from the terminal. The typed text and the cursor must survive, the outside edit must show up
//   in the editor within one second, and the file on disk must end up byte-for-byte correct.
//
// Runs the real built UI in a real browser (Edge or Chrome), against throwaway fixture notebooks in the
// OS temp folder. Your real notebook is never touched.   Run:  npm run check:phase1
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(here, "..");
const outDir = path.join(here, "out");
mkdirSync(outDir, { recursive: true });

const LF_RUNS = Number(process.env.CHECK_RUNS ?? 20);
const CRLF_RUNS = 4;
const LIMIT_MS = 1000;

const ALPHA = "Alpha paragraph: this is the one the human is typing in.";
const BRAVO = "Bravo paragraph: untouched filler text that nobody edits.";
const CHARLIE = "Charlie paragraph: this is the one the agent edits.";
const DELTA = "Delta paragraph: more filler at the end.";
const TYPED = " Typed-by-human 0123456789 keeps going";
const baseLF = ["# Phase 1 check", "", ALPHA, "", BRAVO, "", CHARLIE, "", DELTA, ""].join("\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toDisk = (lf, eol, bom) => Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(lf.replace(/\n/g, eol), "utf8")]);

function makeFixture(eol, bom) {
  const proj = mkdtempSync(path.join(os.tmpdir(), "aitiarch-check-"));
  const root = path.join(proj, ".aitiarch");
  mkdirSync(root);
  const file = path.join(root, "check.md");
  writeFileSync(file, toDisk(baseLF, eol, bom));
  return { proj, root, file };
}

function startServer(root) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(uiDir, "server", "main.ts"), "--root", root, "--port", "0", "--no-open"], { cwd: uiDir, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d;
      const m = /AITIARCH_READY (.*)/.exec(buf);
      if (m) resolve({ url: JSON.parse(m[1]).url, proc });
    });
    proc.stderr.on("data", (d) => {
      const s = String(d);
      if (!/ExperimentalWarning|--trace-warnings/.test(s)) process.stderr.write(s);
    });
    proc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server did not start in 10s")), 10000);
  });
}

/** Spawn the terminal edit (a separate OS process). Resolves with the epoch-ms time it finished writing. */
function terminalEdit(file, needle, suffix) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(here, "external-edit.mjs"), file, needle, suffix], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("exit", (code) => {
      const m = /WROTE (\d+)/.exec(out);
      code === 0 && m ? resolve(Number(m[1])) : reject(new Error(`external edit failed (exit ${code})`));
    });
  });
}

async function launch() {
  let last;
  for (const channel of ["msedge", "chrome"]) {
    try {
      return { browser: await chromium.launch({ channel, headless: true }), channel };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`No Edge or Chrome found for the check: ${last}`);
}

async function waitForDisk(file, expected, ms = 7000) {
  const t0 = Date.now();
  let got = Buffer.alloc(0);
  while (Date.now() - t0 < ms) {
    got = readFileSync(file);
    if (got.equals(expected)) return { ok: true, got };
    await sleep(60);
  }
  return { ok: false, got };
}

async function openPage(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} ${m.location()?.url ?? ""}`.trim()));
  await page.goto(`${url}?debug=1`);
  await page.waitForSelector(".cm-content", { timeout: 10000 });
  await page.waitForFunction(() => window.__aitiarch && window.__aitiarch["check.md"], null, { timeout: 10000 });
  return { ctx, page, errors };
}

/** Put the cursor at the end of `needle`'s paragraph, focus the editor, and start watching for `marker`. */
async function arm(page, needle, marker) {
  await page.evaluate(
    ({ needle, marker }) => {
      const { view } = window.__aitiarch["check.md"];
      const doc = view.state.doc.toString();
      const line = doc.split("\n").find((l) => l.startsWith(needle));
      const pos = doc.indexOf(line) + line.length;
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
      window.__seenAt = null;
      const tick = () => {
        if (window.__seenAt === null && view.state.doc.toString().includes(marker)) window.__seenAt = Date.now();
        if (window.__seenAt === null) requestAnimationFrame(tick);
      };
      tick();
    },
    { needle, marker },
  );
}

const snapshot = (page) =>
  page.evaluate(() => {
    const { view, session } = window.__aitiarch["check.md"];
    const sel = view.state.selection.main;
    return { doc: view.state.doc.toString(), head: sel.head, empty: sel.empty, status: session.status, conflicts: document.querySelectorAll(".cm-conflict").length };
  });

// ---------------------------------------------------------------- scenario 1: different paragraph
async function differentParagraph(browser, { eol, bom, i, shot }) {
  const fx = makeFixture(eol, bom);
  const srv = await startServer(fx.root);
  const { ctx, page, errors } = await openPage(browser, srv.url);
  const label = `${eol === "\n" ? "LF" : "CRLF+BOM"} #${i}`;
  try {
    const marker = `AGENT-EDIT-${i}`;
    await arm(page, "Alpha paragraph", marker);
    const split = 8 + ((i * 7) % 20); // the terminal edit lands after this many typed characters
    await page.keyboard.type(TYPED.slice(0, split), { delay: 35 });
    const edit = terminalEdit(fx.file, "Charlie paragraph", marker); // runs in another process, mid-typing
    await page.keyboard.type(TYPED.slice(split), { delay: 35 });
    const wroteAt = await edit;
    await page.waitForFunction(() => window.__seenAt !== null, null, { timeout: 4000 });
    const seenAt = await page.evaluate(() => window.__seenAt);
    const latency = seenAt - wroteAt;

    const expectedLF = baseLF.replace(ALPHA, ALPHA + TYPED).replace(CHARLIE, `${CHARLIE} ${marker}`);
    const disk = await waitForDisk(fx.file, toDisk(expectedLF, eol, bom));
    const s = await snapshot(page);
    if (shot) await page.screenshot({ path: path.join(outDir, shot) });

    const wantHead = expectedLF.indexOf(ALPHA + TYPED) + (ALPHA + TYPED).length;
    const problems = [];
    if (s.doc !== expectedLF) problems.push("editor text differs from expected (typed text or agent edit missing)");
    if (s.head !== wantHead || !s.empty) problems.push(`cursor moved (at ${s.head}, expected ${wantHead})`);
    if (s.conflicts) problems.push("a conflict marker appeared for a DIFFERENT paragraph");
    if (!disk.ok) problems.push("file on disk is not byte-identical to the expected result");
    if (latency >= LIMIT_MS) problems.push(`outside edit took ${latency} ms to appear (limit ${LIMIT_MS})`);
    if (errors.length) problems.push(`browser errors: ${errors.slice(0, 2).join(" | ")}`);
    return { name: label, ok: problems.length === 0, latency, problems };
  } catch (e) {
    return { name: label, ok: false, latency: NaN, problems: [String(e)] };
  } finally {
    await ctx.close();
    srv.proc.kill();
    rmSync(fx.proj, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- scenario 2: SAME paragraph (conflict)
async function sameParagraph(browser, choice) {
  const fx = makeFixture("\n", false);
  const srv = await startServer(fx.root);
  const { ctx, page, errors } = await openPage(browser, srv.url);
  const name = `same paragraph -> ${choice}`;
  try {
    const marker = "AGENT-SAME-PARA";
    await arm(page, "Alpha paragraph", "never-matches");
    await page.keyboard.type(TYPED.slice(0, 14), { delay: 35 });
    await terminalEdit(fx.file, "Alpha paragraph", marker);
    await page.keyboard.type(TYPED.slice(14), { delay: 35 });
    await page.waitForSelector(".cm-conflict", { timeout: 4000 });
    await page.screenshot({ path: path.join(outDir, `conflict-${choice}.png`) });
    await sleep(1500); // longer than the autosave debounce: nothing may be written meanwhile

    const theirsLF = baseLF.replace(ALPHA, `${ALPHA} ${marker}`);
    const problems = [];
    if (!readFileSync(fx.file).equals(toDisk(theirsLF, "\n", false))) problems.push("autosave overwrote the agent's version while the conflict was open");
    let s = await snapshot(page);
    if (!s.doc.includes(TYPED)) problems.push("typed text was lost when the conflict appeared");
    if (s.status !== "conflict") problems.push(`status was ${s.status}, expected conflict`);

    await page.click(choice === "mine" ? ".cm-conflict button:text('Keep mine')" : ".cm-conflict button:text('Take theirs')");
    const wantLF = choice === "mine" ? baseLF.replace(ALPHA, ALPHA + TYPED) : theirsLF;
    const disk = await waitForDisk(fx.file, toDisk(wantLF, "\n", false));
    if (!disk.ok) problems.push(`after “${choice === "mine" ? "Keep mine" : "Take theirs"}” the file isn't what it should be`);
    s = await snapshot(page);
    if (s.conflicts) problems.push("conflict marker still showing after resolving");
    if (errors.length) problems.push(`browser errors: ${errors.slice(0, 2).join(" | ")}`);
    return { name, ok: problems.length === 0, latency: NaN, problems };
  } catch (e) {
    return { name, ok: false, latency: NaN, problems: [String(e)] };
  } finally {
    await ctx.close();
    srv.proc.kill();
    rmSync(fx.proj, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- scenarios 3 & 4: byte-exactness
// A nasty note: BOM, CRLF and lone-LF lines mixed, frontmatter, mermaid, failed marks, wikilinks, lists.
const MIXED =
  "﻿---\r\nstatus: practice\r\n---\r\n\r\n# Mixed endings\n\nAlpha paragraph: typing here.\r\n\r\nBravo paragraph: lone-LF paragraph.\n\n" +
  "```mermaid\r\nflowchart LR\r\n  A-->B\r\n```\r\n\r\n~~struck~~ {failed: why} [[check]] **bold** `code`\n- item one\r\n- item two\n";

async function withRawFixture(browser, content, body) {
  const proj = mkdtempSync(path.join(os.tmpdir(), "aitiarch-check-"));
  const root = path.join(proj, ".aitiarch");
  mkdirSync(root);
  const file = path.join(root, "check.md");
  writeFileSync(file, Buffer.from(content, "utf8"));
  const srv = await startServer(root);
  const opened = await openPage(browser, srv.url);
  try {
    return await body({ file, ...opened });
  } finally {
    await opened.ctx.close();
    srv.proc.kill();
    rmSync(proj, { recursive: true, force: true });
  }
}

/** Open + click around + select all in a rich, mixed-ending note: the file must not change at all. */
function untouchedOnOpen(browser) {
  const name = "open & browse changes nothing";
  return withRawFixture(browser, MIXED, async ({ file, page, errors }) => {
    try {
      const before = readFileSync(file);
      const mtime0 = (await import("node:fs")).statSync(file).mtimeMs;
      await arm(page, "Alpha paragraph", "never-matches");
      await sleep(1600); // longer than the autosave debounce
      await page.keyboard.press("Control+A");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Control+Home");
      await sleep(1300);
      const problems = [];
      if (!readFileSync(file).equals(before)) problems.push("file bytes changed without any edit");
      if ((await import("node:fs")).statSync(file).mtimeMs !== mtime0) problems.push("file was rewritten (mtime changed) without any edit");
      if (errors.length) problems.push(`browser errors: ${errors.slice(0, 2).join(" | ")}`);
      return { name, ok: problems.length === 0, latency: NaN, problems };
    } catch (e) {
      return { name, ok: false, latency: NaN, problems: [String(e)] };
    }
  });
}

/** Type in one paragraph of the mixed-ending note: only that paragraph's bytes may change. */
function mixedEndingsEdit(browser) {
  const name = "mixed endings + BOM: edit keeps other bytes";
  return withRawFixture(browser, MIXED, async ({ file, page, errors }) => {
    try {
      await arm(page, "Alpha paragraph", "never-matches");
      await page.keyboard.type(TYPED, { delay: 30 });
      const expected = Buffer.from(MIXED.replace("Alpha paragraph: typing here.", "Alpha paragraph: typing here." + TYPED), "utf8");
      const disk = await waitForDisk(file, expected);
      const problems = [];
      if (!disk.ok) problems.push(`bytes differ from expected (got ${disk.got.length} bytes, wanted ${expected.length})`);
      if (errors.length) problems.push(`browser errors: ${errors.slice(0, 2).join(" | ")}`);
      return { name, ok: problems.length === 0, latency: NaN, problems };
    } catch (e) {
      return { name, ok: false, latency: NaN, problems: [String(e)] };
    }
  });
}

// ---------------------------------------------------------------- run
const pct = (a, p) => a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
const { browser, channel } = await launch();
const results = [];
try {
  console.log(`Phase 1 check — real ${channel} browser, separate-process terminal edits, fixture notebooks in ${os.tmpdir()}\n`);
  for (let i = 1; i <= LF_RUNS; i++) results.push(await differentParagraph(browser, { eol: "\n", bom: false, i, shot: i === 1 ? "different-paragraph.png" : undefined }));
  for (let i = 1; i <= CRLF_RUNS; i++) results.push(await differentParagraph(browser, { eol: "\r\n", bom: true, i }));
  results.push(await sameParagraph(browser, "mine"));
  results.push(await sameParagraph(browser, "theirs"));
  results.push(await untouchedOnOpen(browser));
  results.push(await mixedEndingsEdit(browser));
} finally {
  await browser.close();
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(28)} ${Number.isFinite(r.latency) ? `outside edit visible after ${String(r.latency).padStart(4)} ms` : ""}${r.ok ? "" : "\n      " + r.problems.join("\n      ")}`);
const lat = results.filter((r) => Number.isFinite(r.latency)).map((r) => r.latency).sort((a, b) => a - b);
const failed = results.filter((r) => !r.ok);
if (lat.length) console.log(`\nOutside-edit latency over ${lat.length} runs: min ${lat[0]} ms · median ${pct(lat, 50)} ms · p95 ${pct(lat, 95)} ms · max ${lat[lat.length - 1]} ms (limit ${LIMIT_MS} ms)`);
console.log(failed.length ? `\nPHASE 1 CHECK FAILED: ${failed.length} of ${results.length} scenarios` : `\nPHASE 1 CHECK PASSED: ${results.length} of ${results.length} scenarios`);
writeFileSync(path.join(outDir, "phase1-report.json"), JSON.stringify({ browser: channel, limitMs: LIMIT_MS, results, latenciesMs: lat }, null, 2));
process.exit(failed.length ? 1 : 0);
