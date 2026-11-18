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
import {compatibleDefaults,descriptorFromAdapter} from '../server/providers/registry.ts';
import {saveMachineSetup} from '../server/setup-store.ts';

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
 const page = await browser.newPage({viewport:{width:1280,height:800}});
 page.setDefaultTimeout(10000);
 const external = [], writes = [], setupRequests = [];
 await page.route('**/*',route=>{
  const request = route.request();
  if(new URL(request.url()).origin!==url){external.push(request.url());return route.abort();}
  if(new URL(request.url()).pathname==='/api/setup') setupRequests.push(request.method());
  if(request.method()!=='GET' && request.method()!=='HEAD') writes.push([request.method(),new URL(request.url()).pathname]);
  return route.continue();
 });
 const shot = (name) => page.screenshot({path:path.join(output,name)});
 const atWidths = async (name) => {
  for(const width of [1280,640]){await page.setViewportSize({width,height:800});await shot(`${name}-${width}.png`);}
  await page.setViewportSize({width:1280,height:800});
 };
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

 // First run with zero providers: one small card, AI off, no model/effort controls, no writes.
 await dialog.getByText(/AI is off/).waitFor();
 await dialog.getByText(/filesystem-private/).waitFor();
 assert.equal(await dialog.getByRole('combobox').count(),0);
 assert.equal(await dialog.getByText(/Effort|Models and effort|Save model/).count(),0);
 assert.deepEqual(await readdir(project,{recursive:true}),baseline);
 assert.equal(writes.some(([,route])=>route.startsWith('/api/setup')),false);
 await atWidths('first-run-ai-off');
 await dialog.getByRole('button',{name:'Skip',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 assert.equal((await setup.get()).seen,true);

 // A compatible Claude appears. Setup uses the metadata already loaded by the editor.
 providers.push({id:'claude',path:'C:/synthetic/claude.exe',version:'2.1.206',isolation:'metadata-compatible',
  reason:'Synthetic startup metadata',effort:true,effortCode:'help_flag_present',
  notices:[{level:'info',message:'untested version: tested 2.1.205, found 2.1.206'}]});
 providers.push({id:'codex',path:'C:/synthetic/codex.exe',version:'0.167.0',isolation:'metadata-compatible',
  reason:'Synthetic startup metadata',effort:null,effortCode:'not_applicable'});
 const defaults=compatibleDefaults(providers.map(tool=>descriptorFromAdapter({
  id:tool.id,label:tool.id,safetyLabel:'contained',async *startTurn(){throw Error('No provider should run during setup.');},
 },{detect:async()=>({available:true,reason:null}),bridges:{invoked:true,'thread-reply':true,'investigate-read':true,'skill-diagram':true}})));
 await saveMachineSetup(dir,{...defaults,setupSeen:true,defaultRoles:Object.keys(defaults.roles)});
 await page.reload();
 await page.getByRole('button',{name:'Notes menu',exact:true}).click();
 assert.equal(await dialog.count(),0);
 await page.getByRole('button',{name:'AI settings',exact:true}).click();
 const settings = page.getByRole('dialog',{name:'AI settings'});
 const usageTab = settings.getByRole('tab',{name:'Usage',exact:true});
 await usageTab.focus();
 assert.equal(await settings.getByRole('button',{name:/open setup|run first-time setup/i}).count(),0);
 await page.keyboard.press('ArrowDown');
 const setupTab = settings.getByRole('tab',{name:'Setup',exact:true});
 const setupPane = settings.getByRole('tabpanel',{name:'Setup',exact:true});
 await page.waitForFunction(()=>document.activeElement?.id==='settings-tab-setup');
 const readCount = setupRequests.length;
 await setupPane.getByText('C:/synthetic/claude.exe',{exact:true}).waitFor();
 await setupPane.getByText(/untested version: tested 2.1.205/).waitFor();
 await setupPane.getByText(/This feature uses the startup Claude configuration/).first().waitFor();
 await setupPane.getByText('Choose the model in the chat box.').waitFor();
 const normalRole=setupPane.locator('[data-role="normal-chat"]');
 assert.equal(await setupPane.getByRole('combobox',{name:'Normal chat',exact:true}).inputValue(),'claude');
 assert.equal(await setupPane.getByText('discovered',{exact:false}).count(),2);
 const council=setupPane.getByRole('group',{name:'Council participants'});
 assert.equal(await council.getByRole('checkbox',{name:'Claude'}).isChecked(),true);
 assert.equal(await council.getByRole('checkbox',{name:'Codex'}).isChecked(),true);
 for(const width of [1280,640]){
  await page.setViewportSize({width,height:800});
  assert.equal(await setupPane.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  const box=await setupTab.boundingBox();
  assert(box && box.x>=0 && box.x+box.width<=width);
  await shot(`settings-setup-${width}.png`);
 }
 await page.setViewportSize({width:1280,height:800});
 assert.equal(setupRequests.length,readCount);
 await council.getByRole('checkbox',{name:'Claude'}).uncheck();
 await council.getByRole('button',{name:'Save participants'}).click();
 await council.getByText('Council needs at least two enabled, compatible providers.').waitFor();
 assert.deepEqual((await setup.get()).roles.find(r=>r.role==='council').participants,['codex']);
 await council.getByRole('button',{name:'Reset to default'}).click();
 await council.getByText('Answers the same question independently. · default').waitFor();
 await normalRole.getByRole('button',{name:/Model: Claude/}).click();
 const settingsPicker=normalRole.getByRole('menu',{name:'Model and effort'});
 await settingsPicker.getByRole('menuitemradio',{name:'haiku',exact:true}).focus();
 await page.keyboard.press('Escape');
 await settingsPicker.waitFor({state:'hidden'});
 assert.equal(await settings.isVisible(),true);
 await normalRole.getByRole('button',{name:/Model: Claude/}).click();
 await settingsPicker.getByRole('menuitemradio',{name:'haiku',exact:true}).click();
 await normalRole.getByRole('button',{name:'Model: Claude · Haiku'}).waitFor();
 await normalRole.getByRole('button',{name:'Reset to default'}).click();
 await normalRole.getByRole('button',{name:'Model: Claude · Default'}).waitFor();

 await settings.getByRole('tab',{name:'Text size'}).click();
 await settings.getByText('Choose the model in the chat box.').waitFor();
 assert.equal(await settings.getByText(/Models and effort|Save model|Inherit provider/).count(),0);
 const font = settings.getByRole('spinbutton',{name:'Font size (px)'});
 const saveFont = settings.getByRole('button',{name:'Save font size'});
 const priorWrites = writes.length;
 await font.fill('25');
 await saveFont.click();
 await settings.getByRole('status').filter({hasText:'14 to 24 px'}).waitFor();
 assert.equal(writes.slice(priorWrites).some(([,route])=>route==='/api/setup'),false);
 await font.fill('24');
 await saveFont.click();
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.cm-scroller')).fontSize==='24px');
 await font.fill('14');
 await saveFont.click();
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.cm-scroller')).fontSize==='14px');

 // Replay of the first-run card with a provider: tools found, one default-AI select, Continue.
 await setupTab.click();
 await settings.getByRole('button',{name:'Run first-time setup again',exact:true}).press('Enter');
 await dialog.getByText('Claude').first().waitFor();
 assert.equal(await dialog.getByRole('combobox').count(),1);
 assert.equal(await dialog.getByText(/Effort|Models and effort|Save model|Custom ID/).count(),0);
 await atWidths('first-run-card');
 const customize=dialog.getByText('Customize which AI does each job',{exact:true});
 await customize.click();
 assert.equal(await dialog.getByRole('combobox',{name:'Normal chat',exact:true}).inputValue(),'claude');
 assert.equal(await dialog.getByRole('group',{name:'Council participants'}).getByRole('checkbox',{name:'Codex'}).isChecked(),true);
 await atWidths('first-run-roles');
 await customize.click();
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await dialog.waitFor({state:'detached'});

 // The composer chip: the model and effort are chosen where the person types.
 await page.getByRole('button',{name:'Chat',exact:true}).click();
 const input = page.getByRole('textbox',{name:'Message Aitiarch AI'});
 const chip = page.getByRole('button',{name:/^Model: /});
 await chip.waitFor();
 await atWidths('composer-chip');
 const menu = page.getByRole('menu',{name:'Model and effort'});
 const claude = () => menu.getByRole('group',{name:'Claude',exact:true});
 const setupWrites = () => writes.filter(([,route])=>route==='/api/setup').length;
 await chip.click();
 await menu.waitFor();
 assert.equal(await menu.getByText(/starts a fresh conversation/).count(),1);
 // Claude is the default answerer and its CLI declares --effort, so the Effort section is offered; it is the only provider group with one.
 assert.equal(await menu.getByRole('group',{name:'Effort'}).count(),1);
 assert.equal(await menu.getByRole('group').count(),3);
 await atWidths('composer-popover');

 // An invalid custom ID is refused with a notice and no write.
 const before = setupWrites();
 await claude().getByRole('textbox',{name:'Custom model ID for Claude'}).fill('--model x');
 await claude().getByRole('button',{name:'Use'}).click();
 await menu.getByRole('status').filter({hasText:'model ID'}).waitFor();
 assert.equal(setupWrites(),before);

 // Picking an alias writes the provider then the selection; the popover closes and focus returns to the input.
 await claude().getByRole('menuitemradio',{name:'sonnet',exact:true}).click();
 await menu.waitFor({state:'detached'});
 assert.equal(await input.evaluate(el=>el===document.activeElement),true);
 await page.getByRole('button',{name:'Model: Claude · Sonnet'}).waitFor();
 // Effort appears only because the CLI declares --effort; keyboard: open, arrow, Enter.
 await chip.focus();
 await page.keyboard.press('Enter');
 await menu.waitFor();
 await menu.getByRole('group',{name:'Effort'}).waitFor();
 await menu.getByRole('group',{name:'Effort'}).getByRole('menuitemradio',{name:'low',exact:true}).focus();
 await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'Model: Claude · Sonnet · Low'}).waitFor();
 assert.equal(await input.evaluate(el=>el===document.activeElement),true);
 // Escape closes and returns focus to the input.
 await chip.click();
 await menu.waitFor();
 await page.keyboard.press('Escape');
 await menu.waitFor({state:'detached'});
 assert.equal(await input.evaluate(el=>el===document.activeElement),true);

 // What the machine store now holds: provider assigned, explicit override, nothing else touched.
 const saved = await setup.get();
 assert.equal(saved.roles.find(r=>r.role==='normal-chat').provider,'claude');
 assert.deepEqual(saved.models.find(m=>m.role==='normal-chat').selection,{model:'sonnet',effort:'low'});
 assert.deepEqual(await readFile(note),original);
 assert.deepEqual(await readdir(project,{recursive:true}),baseline);
 assert.deepEqual(external,[]);
 assert.equal(writes.some(([,route])=>/\/(chat|assistance|council|investigate)\b/.test(route)),false);
 console.log('Setup passed: AI-off card, Settings Setup tab and keyboard replay, text size, composer chip and popover, unchanged project, local requests only.');
} finally {
 await browser?.close();
 watcher.stop();
 await app.close();
}
