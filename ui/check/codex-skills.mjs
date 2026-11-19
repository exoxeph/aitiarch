import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {createApp} from '../server/http.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {resolveProjectStorage} from '../server/project-storage.ts';
import {createSetupHttp} from '../server/setup-http.ts';
import {saveMachineSetup} from '../server/setup-store.ts';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {defaultMachineSetup} from '../shared/setup.ts';

assert(process.env.BATCH2A_OUTPUT,'Set BATCH2A_OUTPUT to a folder outside the repo.');
const output=path.resolve(process.env.BATCH2A_OUTPUT);
const relative=path.relative(path.resolve('..'),output);
assert(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'Output must be outside the repo.');
await mkdir(output,{recursive:true});
const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-codex-controls-'));
const root=path.join(base,'.aitiarch'),skills=path.join(base,'skills'),config=process.env.AITIARCH_CONFIG_DIR;
assert((await resolveProjectStorage(root,{create:true})).ok);
await writeFile(path.join(root,'fixture.md'),'# Synthetic skill controls');
await new UiStateStore(root).saveTour('skipped');
async function writeSkill(name,classification,text){
 const directory=path.join(skills,name);
 await mkdir(directory,{recursive:true});
 await writeFile(path.join(directory,'SKILL.md'),`---\nname: ${name}\ndescription: Synthetic fixture\nclassification: ${classification}\n---\n${text}`);
}
await writeSkill('demo','read-only','Synthetic instructions.');
await writeSkill('blocked','shell','Synthetic ineligible skill.');
const initial=defaultMachineSetup();
initial.setupSeen=true;
await saveMachineSetup(config,initial);
const setup=createSetupHttp({dir:config,project:base,providers:[],ready:async()=>true});
const store=await Store.open(root),watcher=new NoteWatcher(store);
const app=createApp({store,watcher,distDir:path.resolve('dist'),setup,pipelineConfigDir:config,codexSkillRoots:[skills],skillRoots:[]});
let browser;
try{
 const url='http://127.0.0.1:'+await app.listen(0);
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:640,height:800}});
 const providerRequests=[];
 page.on('request',request=>{if(/\/api\/(chat\/send|council\/run|assistance\/invoke|conversation\/turn)/.test(request.url()))providerRequests.push(request.url());});
 const openSetup=async()=>{
  await page.getByRole('button',{name:'Notes menu',exact:true}).click();
  await page.getByRole('button',{name:'AI settings'}).click();
  const dialog=page.getByRole('dialog',{name:'AI settings'});
  await dialog.getByRole('tab',{name:'Setup'}).click();
  return dialog;
 };
 const closeSetup=()=>page.getByRole('button',{name:'Close AI settings'}).click();
 const normal=container=>container.getByRole('checkbox',{name:'demo for Normal chat',exact:true});
 const waitChecked=(control,expected)=>control.and(page.locator(expected?'input:checked:not(:disabled)':'input:not(:checked):not(:disabled)')).waitFor();
 const change=async(control,expected)=>{
  await waitChecked(control,!expected);
  const [response]=await Promise.all([
   page.waitForResponse(r=>new URL(r.url()).pathname==='/api/codex-skills'&&r.request().method()==='PUT'),
   control.click(),
  ]);
  assert(response.ok(),await response.text());
  await waitChecked(control,expected);
 };
 await page.goto(url+'/?debug=1');
 await page.locator('.cm-editor').waitFor();
 let settings=await openSetup();
 await waitChecked(normal(settings),false);
 assert(await settings.getByRole('checkbox',{name:'blocked for Normal chat',exact:true}).isDisabled());
 assert(await settings.getByText(/Native skill and plugin execution is unavailable/).isVisible());
 const crafted=await page.evaluate(async()=>{
  const inventory=await (await fetch('/api/codex-skills',{headers:{'X-Aitiarch':'1'}})).json();
  const skill=inventory.skills.find(s=>s.name==='blocked');
  const response=await fetch('/api/codex-skills',{method:'PUT',headers:{'X-Aitiarch':'1','Content-Type':'application/json'},
   body:JSON.stringify({role:'normal-chat',enabled:true,pathHash:skill.pathHash,contentHash:skill.contentHash})});
  return response.status;
 });
 assert.equal(crafted,409);
 await change(normal(settings),true);
 await page.screenshot({path:path.join(output,'codex-skills-setup.png')});
 await closeSetup();

 await page.getByRole('button',{name:'Pipeline Studio',exact:true}).click();
 const studio=page.locator('section.studio[role=dialog]');
 await studio.locator('[data-skill-role="normal-chat"] .studio-row').click();
 const editor=studio.getByRole('region',{name:'Edit Skills: Normal chat',exact:true});
 await waitChecked(normal(editor),true);
 await page.screenshot({path:path.join(output,'codex-skills-pipeline.png')});
 await change(normal(editor),false);
 await page.keyboard.press('Escape');
 await editor.waitFor({state:'detached'});
 await page.keyboard.press('Escape');
 await studio.waitFor({state:'detached'});

 settings=await openSetup();
 await waitChecked(normal(settings),false);
 await change(normal(settings),true);
 await writeSkill('demo','read-only','Updated synthetic instructions.');
 await settings.getByRole('button',{name:'Refresh Codex skills'}).click();
 await settings.getByText('(changed, needs re-approval)',{exact:true}).waitFor();
 await waitChecked(normal(settings),false);
 assert.deepEqual(providerRequests,[]);
 console.log('PASS: Setup and Pipeline round trip without reload, crafted shell approval refused, changed skill cleared.');
}finally{
 await browser?.close();
 await app.close();
}
