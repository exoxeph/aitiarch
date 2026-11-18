import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {createSetupHttp} from '../server/setup-http.ts';

const output = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
const relative = path.relative(path.resolve('..'), output);
assert(process.env.BATCH2A_OUTPUT && (relative.startsWith('..'+path.sep) || path.isAbsolute(relative)),
 'BATCH2A_OUTPUT must be outside the repo.');
await mkdir(output,{recursive:true});
const project = await mkdtemp(path.join(os.tmpdir(),'aitiarch-setup-check-'));
const notes = path.join(project,'.aitiarch');
// Slice 8 init creates this directory. Existing server boot also creates it,
// so start from an initialized notebook to isolate setup-screen writes.
await mkdir(path.join(notes,'ink'),{recursive:true});
const note = path.join(notes,'Synthetic plan.md');
const original = Buffer.from('\uFEFF# Synthetic plan\r\n\r\nRelease in June.\r\n');
await writeFile(note,original);
const dir = process.env.AITIARCH_CONFIG_DIR;
let ready = false;
const providers=[];
const setup = createSetupHttp({dir,project,providers,ready:async()=>ready});
const store = await Store.open(notes);
const watcher = new NoteWatcher(store);
const app = createApp({store,watcher,distDir:path.resolve('dist'),pipelineConfigDir:dir,setup});
let browser;
try {
 const url = 'http://127.0.0.1:'+await app.listen(0);
 browser = await chromium.launch({channel:'msedge',headless:true});
 const page = await browser.newPage({viewport:{width:1024,height:800}});
 page.setDefaultTimeout(10000);
 const external = [], writes = [];
 await page.route('**/*',route=>{
  const request = route.request();
  if(new URL(request.url()).origin!==url){external.push(request.url());return route.abort();}
  if(request.method()!=='GET' && request.method()!=='HEAD') writes.push([request.method(),new URL(request.url()).pathname]);
  return route.continue();
 });
 assert.equal((await fetch(url+'/api/setup')).status,401);
 // Ordinary editor boot persists the initial tab selection. Warm it up
 // before taking the baseline for opening setup.
 const firstTabSave = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/ui-state' &&
  response.request().method()==='PUT' && response.ok());
 await page.goto(url+'/?debug=1');
 await firstTabSave;
 const dialog = page.getByRole('dialog',{name:'Set up Aitiarch'});
 assert.equal(await dialog.count(),0);
 const baseline = await readdir(project,{recursive:true});
 ready = true;
 await page.reload();
 await dialog.getByText(/AI is off/).waitFor();
 await dialog.getByText(/filesystem-private/).waitFor();
 assert.equal(await dialog.getByRole('radio',{name:/Shared/}).isDisabled(),true);
 assert.deepEqual(await readdir(project,{recursive:true}),baseline);
 assert.equal(writes.some(([,route])=>route.startsWith('/api/setup')),false);
 await page.screenshot({path:path.join(output,'setup-ai-off.png')});
 const font = dialog.getByRole('spinbutton',{name:'Font size (px)'});
 const saveFont = dialog.getByRole('button',{name:'Save font size'});
 const priorWrites = writes.length;
 await font.fill('25');
 await saveFont.click();
 await dialog.getByRole('status').filter({hasText:'14 to 24 px'}).waitFor();
 assert.equal(writes.slice(priorWrites).some(([,route])=>route==='/api/setup'),false);
 await font.fill('24');
 await saveFont.click();
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.cm-scroller')).fontSize==='24px');
 await dialog.getByRole('button',{name:'Skip',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 assert.equal((await setup.get()).seen,true);
 providers.push({id:'claude',path:'C:/synthetic/claude.exe',version:'2.1.205',isolation:'metadata-compatible',
  reason:'Synthetic startup metadata',effort:true,effortCode:'help_flag_present'});
 await page.reload();
 await page.getByRole('button',{name:'Notes menu',exact:true}).click();
 assert.equal(await dialog.count(),0);
 await page.getByRole('button',{name:'AI settings',exact:true}).click();
 await page.getByRole('tab',{name:'Models and text size'}).click();
 const settings = page.getByRole('dialog',{name:'AI settings'});
 const normal = settings.getByRole('group',{name:'Normal chat · Claude',exact:true});
 await normal.getByRole('combobox').filter({has:page.getByRole('option',{name:'sonnet (CLI alias)',exact:true})}).selectOption('sonnet');
 await normal.getByRole('combobox').filter({has:page.getByRole('option',{name:'xhigh',exact:true})}).selectOption('low');
 await normal.getByRole('button',{name:'Save model and effort'}).click();
 await normal.getByText(/Requested model: sonnet.*effort: low/).waitFor();
 assert.equal(await settings.getByRole('spinbutton',{name:'Font size (px)'}).inputValue(),'24');
 await settings.getByRole('spinbutton',{name:'Font size (px)'}).fill('14');
 await settings.getByRole('button',{name:'Save font size'}).click();
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.cm-scroller')).fontSize==='14px');
 await page.getByRole('button',{name:'Open setup',exact:true}).click();
 assert.equal(await font.inputValue(),'14');
 await dialog.getByRole('group',{name:'Normal chat · Claude',exact:true}).getByText(/Requested model: sonnet.*effort: low/).waitFor();
 await dialog.getByRole('button',{name:'Looks good, continue'}).click();
 await dialog.waitFor({state:'detached'});
 await page.locator('.cm-editor').waitFor();
 assert.deepEqual(await readFile(note),original);
 assert.deepEqual(await readdir(project,{recursive:true}),baseline);
 assert.deepEqual(external,[]);
 assert.equal(writes.some(([,route])=>/\/(chat|assistance|council|investigate)\b/.test(route)),false);
 console.log('Setup passed: AI-off, private-only, Skip/reload/replay, editor reachable, unchanged project, local requests only.');
} finally {
 await browser?.close();
 watcher.stop();
 await app.close();
}
