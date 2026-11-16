// Real-browser check: Pipeline Studio slice 4b (wording editors, "what is actually sent", Customized markers, Reset all, export and import).
// Synthetic temp notes, a temp settings folder, temp import files, fake adapters and a fake provider; no live provider is called and no real settings file is touched.
// Needs BATCH2A_OUTPUT (a folder outside the repo) for screenshots. Run from the ui folder after a build.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {DEFAULT_PIPELINE_CONFIG} from '../shared/pipeline-config.ts';
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!output.toLowerCase().startsWith(path.resolve('..').toLowerCase()),'BATCH2A_OUTPUT must be a folder outside the repo');await mkdir(output,{recursive:true});
const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-pipeline-wording-')),notes=path.join(base,'notes'),settings=path.join(base,'settings'),configFile=path.join(settings,'pipeline-config.json'),files=path.join(base,'import');await mkdir(notes);await mkdir(files);
await writeFile(path.join(notes,'plan.md'),'# Synthetic plan\n\nLaunch in June.\n');
const index=await SessionIndex.open(path.join(base,'harness'));
const adapters=['codex','kiro','claude'].map(id=>({id,label:id==='codex'?'Codex':id==='kiro'?'Kiro':'Claude',safetyLabel:id==='codex'?'contained':id==='kiro'?'host-gated':'fenced',async *startTurn(){throw new Error('A live provider call is forbidden in this check.');}}));
const provider={name:'claude',async checkAvailability(){return {available:true};},async invoke(){throw new Error('A live provider call is forbidden in this check.');}};
const store=await Store.open(notes),watcher=new NoteWatcher(store);await watcher.start();
const app=createApp({store,watcher,distDir:path.resolve('dist'),provider,pipelineConfigDir:settings,council:{index,adapters,availabilityChecks:adapters.map(a=>({...a,check:async()=>({available:true,reason:null})}))},harness:{command:process.execPath,prefixArgs:[path.resolve('test/fixtures/harness-cli.mjs')],dir:index.dir}});
const saved=async()=>existsSync(configFile)?JSON.parse(await readFile(configFile,'utf8')).overrides:null;
const DEFAULT_STYLE=DEFAULT_PIPELINE_CONFIG.prompts.chatLength,STYLE='Keep every reply to two short sentences.';
let browser;
try{
 const url='http://127.0.0.1:'+await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const boot=async()=>{await page.goto(url+'/?debug=1');await page.waitForSelector('.cm-editor');};
 const studio=page.locator('section.studio[role=dialog]'),node=id=>studio.locator(`.studio-node[data-node="${id}"]`);
 const openStudio=async()=>{await page.getByRole('button',{name:'Pipeline Studio',exact:true}).click();await studio.waitFor();await node('ledger').waitFor();};
 const edit=async id=>{await node(id).click();const ed=studio.getByRole('region',{name:/^Edit /});await ed.waitFor();return ed;};
 const closeEditor=async()=>{await studio.getByRole('button',{name:'Close editor'}).click();};
 const style=ed=>ed.locator('[data-field="prompts.chatLength"]');
 const customized=async()=>studio.locator('.studio-node[data-customized]').evaluateAll(n=>n.map(e=>e.dataset.node).sort());
 const importFile=async(name,text)=>{const file=path.join(files,name);await writeFile(file,text);await studio.locator('input[type=file]').setInputFiles(file);};
 await boot();await openStudio();
 // 1. The wording fields: five nodes own wording, locked nodes none; a counter against the 2,000-character cap.
 let ed=await edit('normal-answerer');
 assert.equal(await style(ed).inputValue(),DEFAULT_STYLE,'the field starts at the default wording');
 assert.equal((await ed.locator('[data-counter="prompts.chatLength"]').innerText()).trim(),`${DEFAULT_STYLE.length.toLocaleString('en-US')} / 2,000 characters`);
 assert.equal(await ed.locator('[data-unsaved]').count(),0,'nothing is unsaved yet');
 await page.screenshot({path:path.join(output,'wording-editor.png')});
 await closeEditor();
 const expected={'request-intake':9,'normal-answerer':1,'diagram-route':1,'investigate':1,'council':1};
 for(const [id,n] of Object.entries(expected)){ed=await edit(id);assert.equal(await ed.locator('textarea').count(),n,`${id} has ${n} wording field(s)`);assert.equal(await ed.locator('.studio-preview').count(),1,`${id} has the "what is actually sent" toggle`);await closeEditor();}
 ed=await edit('permission_gate');assert.equal(await ed.locator('textarea,input,select').count(),0,'a locked node still shows no editable fields');await closeEditor();
 // 2. Editing: counter, unsaved markers, and a stale-preview notice instead of a stale preview.
 ed=await edit('normal-answerer');await style(ed).fill(STYLE);
 assert.equal((await ed.locator('[data-counter="prompts.chatLength"]').innerText()).trim(),`${STYLE.length} / 2,000 characters`,'the counter follows the typing');
 assert.equal(await ed.locator('[data-unsaved=field]').count(),1);assert.equal(await ed.locator('[data-unsaved=node]').count(),1,'an unsaved-changes marker');
 await ed.getByRole('button',{name:'What is actually sent'}).click();
 assert.match(await ed.locator('[data-notice=stale-preview]').innerText(),/Save to refresh the preview/);assert.equal(await ed.locator('.pv-text').count(),0,'no stale preview is shown with unsaved edits');
 await page.screenshot({path:path.join(output,'wording-unsaved-stale-preview.png')});
 // 3. Saving: it reloads, the markers clear, and the preview now shows the saved wording with the three kinds of segment.
 await ed.getByRole('button',{name:'Save',exact:true}).click();await ed.getByText('Saved.').waitFor();
 assert.deepEqual(await saved(),{prompts:{chatLength:STYLE}});assert.equal(await ed.locator('[data-unsaved]').count(),0,'the unsaved markers clear after Save');
 const pv=ed.locator('.studio-preview-body');await pv.locator('.pv-text').first().waitFor();
 assert.equal(await ed.locator('[data-notice=stale-preview]').count(),0);
 assert((await pv.locator('.pv-editable').allInnerTexts()).some(t=>t.includes(STYLE)),'the editable segment shows your wording');
 const locked=pv.locator('.pv-locked');assert((await locked.count())>=1,'there are fixed rules');
 assert.equal(await locked.first().locator('.studio-lock').count(),1,'a fixed rule has a padlock');assert.match(await locked.first().locator('.pv-tag').innerText(),/fixed rule, cannot be changed/);
 const lockedStyle=await locked.first().evaluate(e=>{const c=getComputedStyle(e);return {image:c.backgroundImage,border:c.borderLeftStyle};});assert.match(lockedStyle.image,/repeating-linear-gradient/,'fixed rules are hatched');assert.equal(lockedStyle.border,'dashed');
 const chips=await pv.locator('.pv-chip').allInnerTexts();assert(chips.some(t=>t.includes('[your note]'))&&chips.some(t=>t.includes('[your question]')),'placeholders are chips: '+chips.slice(0,6));
 assert.equal(await pv.locator('.pv-text').first().evaluate(e=>getComputedStyle(e).overflowY),'auto','the preview scrolls');
 await page.screenshot({path:path.join(output,'wording-preview.png')});
 // 4. The Customized marker: on the node you changed, on the node that shares the wording, nowhere else; in the card too.
 assert.deepEqual(await customized(),['council','normal-answerer'],'only the nodes that own the changed wording are marked');
 assert.equal((await node('normal-answerer').locator('.studio-custom').innerText()).trim(),'Customized');
 await closeEditor();await node('normal-answerer').hover();const card=studio.getByRole('region',{name:'Details: Normal chat answerer'});await card.waitFor();
 assert.match(await card.locator('[data-card=customized]').innerText(),/Chat style/);assert.equal(await card.locator('[data-card=customized-tag]').count(),1);
 await page.screenshot({path:path.join(output,'customized-canvas.png')});
 // 5. Per-field Reset to default restores the default text, marks it unsaved, and saving clears Customized.
 ed=await edit('normal-answerer');await ed.locator('[data-reset-field="prompts.chatLength"]').click();
 assert.equal(await style(ed).inputValue(),DEFAULT_STYLE);assert.equal(await ed.locator('[data-unsaved=field]').count(),1,'back to default is a change until you save it');
 await ed.getByRole('button',{name:'Save',exact:true}).click();await ed.getByText('Saved.').waitFor();assert.deepEqual(await saved(),{});assert.deepEqual(await customized(),[],'the marker clears when the value is back to the default');
 // 6. Over the cap: the counter warns and the server's own sentence is shown; nothing is saved.
 await style(ed).fill('x'.repeat(2001));assert.match(await ed.locator('[data-counter="prompts.chatLength"]').innerText(),/2,001 \/ 2,000 characters \(too long\)/);assert.equal(await ed.locator('[data-counter][data-over]').count(),1);
 await ed.getByRole('button',{name:'Save',exact:true}).click();const bad=ed.locator('[data-notice=studio-error]');await bad.waitFor();
 assert.equal((await bad.innerText()).trim(),'This value is out of range or not allowed.','the server says why, in its own words');assert.deepEqual(await saved(),{},'a refused save changes nothing');
 await ed.locator('[data-reset-field="prompts.chatLength"]').click();await closeEditor();
 // 7. The other wording owners save too (a persona instruction and Investigate), and "Reset this node" removes only that node's settings.
 ed=await edit('request-intake');await ed.locator('[data-field="prompts.personas.grill.oneLine"]').fill('Asks one hard question.');await ed.getByRole('button',{name:'Save',exact:true}).click();await ed.getByText('Saved.').waitFor();
 assert.deepEqual(await saved(),{prompts:{personas:{grill:{oneLine:'Asks one hard question.'}}}});await closeEditor();
 ed=await edit('investigate');await ed.locator('[data-field="prompts.investigateStyle"]').fill('Explain it briefly, then list the files.');await ed.getByRole('button',{name:'Save',exact:true}).click();await ed.getByText('Saved.').waitFor();
 assert.deepEqual(await customized(),['investigate','request-intake']);
 await ed.getByRole('button',{name:'Reset this node'}).click();await ed.getByText('This node is back to its defaults.').waitFor();assert.deepEqual(await saved(),{prompts:{personas:{grill:{oneLine:'Asks one hard question.'}}}},'only Investigate was reset');await closeEditor();
 // 8. Reset all asks first; Keep leaves everything; confirming restores every default and removes the markers.
 ed=await edit('token-budget');await ed.locator('[data-field="chat.rollingRequestCap"]').fill('7');await ed.getByRole('button',{name:'Save',exact:true}).click();await ed.getByText('Saved.').waitFor();await closeEditor();
 const resetAll=studio.getByRole('button',{name:'Reset all',exact:true});await resetAll.click();const confirmBar=studio.locator('[data-confirm=reset]');await confirmBar.waitFor();
 await page.screenshot({path:path.join(output,'reset-all-confirm.png')});
 await confirmBar.getByRole('button',{name:'Keep my settings'}).click();assert.equal(await studio.locator('[data-confirm]').count(),0);assert.equal((await customized()).length,2,'Keep my settings changes nothing');
 await resetAll.click();await studio.locator('[data-confirm=reset]').getByRole('button',{name:'Reset all'}).click();await studio.getByText('Every setting is back to its default.').waitFor();
 assert.equal(existsSync(configFile),false,'the saved settings are gone');assert.deepEqual(await customized(),[]);assert(await resetAll.isDisabled(),'nothing left to reset');
 // 9. Export downloads one valid JSON file of the settings.
 ed=await edit('normal-answerer');await style(ed).fill(STYLE);await ed.getByRole('button',{name:'Save',exact:true}).click();await ed.getByText('Saved.').waitFor();await closeEditor();
 const [download]=await Promise.all([page.waitForEvent('download'),studio.getByRole('button',{name:'Export',exact:true}).click()]);
 assert.equal(download.suggestedFilename(),'aitiarch-pipeline-config.json');const exported=path.join(output,'exported-config.json');await download.saveAs(exported);
 const doc=JSON.parse(await readFile(exported,'utf8'));assert.deepEqual(doc,{format:'aitiarch-pipeline-config',version:1,overrides:{prompts:{chatLength:STYLE}}},'the export is one valid settings document');
 await studio.getByText(/saved to aitiarch-pipeline-config\.json/).waitFor();
 // 10. Import: a valid file is confirmed first, then replaces the settings; invalid files are refused in words and change nothing.
 await resetAll.click();await studio.locator('[data-confirm=reset]').getByRole('button',{name:'Reset all'}).click();await studio.getByText('Every setting is back to its default.').waitFor();
 await importFile('good.json',JSON.stringify({...doc,overrides:{prompts:{chatLength:'Answer in one paragraph.'}}}));
 const importBar=studio.locator('[data-confirm=import]');await importBar.waitFor();assert.match(await importBar.innerText(),/This replaces your current settings/);assert.match(await importBar.innerText(),/good\.json/);
 assert.equal(existsSync(configFile),false,'nothing is applied before you confirm');await page.screenshot({path:path.join(output,'import-confirm.png')});
 await importBar.getByRole('button',{name:'Replace my settings'}).click();await studio.getByText('Imported. Your settings were replaced.').waitFor();
 assert.deepEqual(await saved(),{prompts:{chatLength:'Answer in one paragraph.'}});assert.deepEqual(await customized(),['council','normal-answerer']);
 const before=await saved();
 await importFile('locked.json',JSON.stringify({format:'aitiarch-pipeline-config',version:1,overrides:{permission_gate:{x:1}}}));await studio.locator('[data-confirm=import]').getByRole('button',{name:'Replace my settings'}).click();
 const refused=studio.locator('[data-notice=studio-notice-error]');await refused.waitFor();assert.match(await refused.innerText(),/This setting is locked in code and cannot be changed here\./,'an attempt to change a locked rule is refused in the server’s words');assert.deepEqual(await saved(),before,'and nothing changed');
 await importFile('wrong.json',JSON.stringify({hello:'world'}));await studio.locator('[data-confirm=import]').getByRole('button',{name:'Replace my settings'}).click();await page.waitForTimeout(300);
 assert.match(await studio.locator('[data-notice=studio-notice-error]').innerText(),/not a pipeline settings file/i);assert.deepEqual(await saved(),before);
 await importFile('broken.json','{ this is not json');await studio.locator('[data-notice=studio-notice-error]').filter({hasText:'not valid JSON'}).waitFor();assert.equal(await studio.locator('[data-confirm]').count(),0,'a file that is not JSON never reaches the confirmation');assert.deepEqual(await saved(),before);
 await importFile('cancel.json',JSON.stringify(doc));await studio.locator('[data-confirm=import]').waitFor();await page.keyboard.press('Escape');assert.equal(await studio.locator('[data-confirm]').count(),0,'Escape closes the confirmation, not the Studio');assert.equal(await studio.count(),1);assert.deepEqual(await saved(),before);
 // 11. Everything survives a reload, and the Studio's other behaviours still work (the full set is in pipeline-studio.mjs).
 await boot();await openStudio();assert.deepEqual(await customized(),['council','normal-answerer'],'Customized survives a reload');
 // 12. Phone width: the list, the wording field, the preview and the header buttons all fit.
 await page.setViewportSize({width:360,height:740});await studio.locator('[data-list=true]').waitFor();
 assert.equal(await studio.locator('[data-node="normal-answerer"] .studio-custom-tag').count(),1,'the list marks customized rows too');
 for(const act of ['export','import','reset-all']){const b=await studio.locator(`[data-act="${act}"]`).boundingBox();assert(b&&b.x>=0&&b.x+b.width<=360.5,`${act} fits at 360px`);}
 const row=studio.locator('[data-node="normal-answerer"] .studio-row');await row.scrollIntoViewIfNeeded();await row.click();
 const open=studio.locator('[data-node="normal-answerer"]'),field=open.locator('[data-field="prompts.chatLength"]');await field.scrollIntoViewIfNeeded();
 const fb=await field.boundingBox();assert(fb&&fb.x>=0&&fb.x+fb.width<=360.5,'the wording field fits at 360px');
 await open.getByRole('button',{name:'What is actually sent'}).click();await open.locator('.pv-text').first().waitFor();await open.locator('.pv-text').first().scrollIntoViewIfNeeded();
 assert.equal(await studio.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'no sideways scroll with the preview open at 360px');
 const tb=await open.locator('.pv-text').first().boundingBox();assert(tb&&tb.x>=0&&tb.x+tb.width<=360.5,'the preview fits at 360px: '+JSON.stringify({tb,studio:await studio.evaluate(e=>({sw:e.scrollWidth,cw:e.clientWidth})),wide:await open.evaluate(e=>[...e.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>361).slice(0,4).map(x=>x.tagName+'.'+String(x.className).slice(0,30)+':'+Math.round(x.getBoundingClientRect().right)))}));await page.screenshot({path:path.join(output,'wording-360.png')});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,screenshots:output}));
}finally{await browser?.close();await app.close();watcher.stop();console.log('Cleanup target:',base);await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
