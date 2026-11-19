import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {createApp} from '../server/http.ts';
import {createSetupHttp} from '../server/setup-http.ts';
import {initializeDefaultRoles,saveMachineSetup} from '../server/setup-store.ts';
import {providerCapabilities} from '../server/providers/registry.ts';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {defaultMachineSetup} from '../shared/setup.ts';

const output=path.resolve(process.env.BATCH2A_OUTPUT??'');
const relative=path.relative(path.resolve('..'),output);
assert(process.env.BATCH2A_OUTPUT&&(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),
 'Set BATCH2A_OUTPUT to a folder outside the repo.');
await mkdir(output,{recursive:true});
const project=await mkdtemp(path.join(os.tmpdir(),'aitiarch-parity-status-'));
const notes=path.join(project,'.aitiarch'),dir=process.env.AITIARCH_CONFIG_DIR;
await mkdir(notes);
await writeFile(path.join(notes,'fixture.md'),'# Synthetic notebook');
const prefs=defaultMachineSetup();
prefs.setupSeen=true;
prefs.providers.codex.enabled=true;
prefs.roles['investigate-read']='codex';
await saveMachineSetup(dir,prefs);
const providers=['claude','codex'].map(id=>({
 id,path:'C:/synthetic/'+id+'.exe',version:id==='claude'?'2.1.205':'0.171.0',isolation:'metadata-compatible',
 code:'metadata_compatible',reason:'Synthetic metadata',roles:[],effort:null,effortCode:'not_applicable',
}));
await initializeDefaultRoles(dir,providers.map(tool=>({
 id:tool.id,detect:async()=>({available:true,reason:null}),capabilities:providerCapabilities(tool.id,{'investigate-read':true}),
})),['codex']);
const setup=createSetupHttp({dir,project,providers,overrides:{codex:providers[1].path},ready:async()=>true});
const store=await Store.open(notes),watcher=new NoteWatcher(store);
const app=createApp({store,watcher,setup,pipelineConfigDir:dir,distDir:path.resolve('dist'),skillRoots:[]});
let browser;
try{
 const url='http://127.0.0.1:'+await app.listen(0);
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:640,height:800}});
 const turns=[];
 page.on('request',r=>{if(/\/(?:turn|send|run)$/.test(new URL(r.url()).pathname))turns.push(r.url());});
 await page.goto(url+'/?debug=1');
 await page.locator('.cm-editor').waitFor();
 await page.getByRole('button',{name:'Notes menu',exact:true}).click();
 await page.getByRole('button',{name:'AI settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'AI settings'});
 await settings.getByRole('tab',{name:'Setup',exact:true}).click();

 const inspect=async surface=>{
  const select=surface.getByRole('combobox',{name:'Investigate',exact:true});
  await select.waitFor();
  assert(await select.isEnabled(),'Investigate remains editable');
  assert.equal(await select.inputValue(),'claude');
  assert(await select.locator('option[value="codex"]').isDisabled());
  assert.equal(await select.locator('option[value="claude"]').isDisabled(),false);
  const text=await select.locator('option[value="codex"]').textContent();
  assert.match(text,/snapshot-only reads.*pre-turn budget ceiling/);
  const row=surface.getByRole('group',{name:'Investigate',exact:true});
  await row.getByText('The saved Codex Investigate choice was replaced with the Claude default.').waitFor();
  await row.scrollIntoViewIfNeeded();
  return text;
 };
 const setupReason=await inspect(settings);
 assert(await settings.getByText(/explicit flag/).isVisible());
 await page.screenshot({path:path.join(output,'codex-investigate-setup.png')});
 await settings.getByRole('button',{name:'Close AI settings',exact:true}).click();
 await page.getByRole('button',{name:'Pipeline Studio',exact:true}).click();
 const studio=page.locator('section.studio[role=dialog]');
 await studio.locator('[data-node="investigate"] .studio-row').click();
 const pipelineReason=await inspect(studio);
 assert.equal(pipelineReason,setupReason);
 await page.screenshot({path:path.join(output,'codex-investigate-pipeline.png')});
 assert.deepEqual(turns,[]);
 console.log('PASS: Setup and Pipeline show matching Codex restrictions, selectable Claude and the migration notice.');
}finally{
 await browser?.close();
 await app.close();
}
