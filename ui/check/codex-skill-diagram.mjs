import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {createApp} from '../server/http.ts';
import {resolveProjectStorage} from '../server/project-storage.ts';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createCliAdapter} from '../server/providers/tool-less.ts';
import {createInvokedCodexBridge} from '../server/providers/invoked-bridge.ts';
import {roleRouting} from '../server/providers/routing.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import {saveMachineSetup} from '../server/setup-store.ts';

const repo=path.resolve(import.meta.dirname,'../..'),out=process.env.BATCH2A_OUTPUT;
const relative=path.relative(repo,path.resolve(out??'.'));
assert(out&&(path.isAbsolute(relative)||relative.startsWith('..'+path.sep)),'Set BATCH2A_OUTPUT outside the repo.');
await mkdir(out,{recursive:true});
const project=await mkdtemp(path.join(os.tmpdir(),'aitiarch-codex-diagram-ui-'));
const root=path.join(project,'.aitiarch'),fixture=path.join(project,'diagram.json'),record=path.join(project,'turn.json');
assert((await resolveProjectStorage(root,{create:true})).ok);
const quote='The queue is bounded.';
const original=Buffer.from('\uFEFF# Fixture\r\n\r\n'+quote+'\r\n\r\nEnd.\r\n');
const file=path.join(root,'fixture.md');
await writeFile(file,original);
await writeFile(fixture,JSON.stringify({drawing:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 60"><rect x="1" y="1" width="158" height="58" fill="#336650"/><text x="20" y="36" fill="#ffffff">Bounded queue</text></svg>'}));
const dir=process.env.AITIARCH_CONFIG_DIR,setup=defaultMachineSetup();
setup.providers.claude.enabled=true;
setup.providers.codex.enabled=true;
setup.roles['skill-diagram']='codex';
setup.setupSeen=true;
setup.tour.completed=true;
await saveMachineSetup(dir,setup);
const adapter=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[path.join(repo,'ui','test','fixtures','skill-codex-cli.mjs'),fixture,record]});
const claude={id:'claude',label:'Claude',safetyLabel:'fenced',async *startTurn(){throw Error('Unexpected Claude turn');}};
const adapters=[claude,adapter],checks=adapters.map(({id,label,safetyLabel})=>({id,label,safetyLabel,
 check:async()=>({available:true,reason:null,version:id==='codex'?'0.167.0':'2.1.205'})}));
const routing=roleRouting({dir,adapters,checks,legacyAnswerer:()=>'claude',claudeBridge:true,codexInvokedBridge:createInvokedCodexBridge,codexSkillDiagrams:true});
const store=await Store.open(root),watcher=new NoteWatcher(store);
const app=createApp({store,watcher,distDir:path.join(repo,'ui','dist'),council:{adapters,availabilityChecks:checks,routing},
 provider:{name:'claude',checkAvailability:async()=>({available:true}),async invoke(){throw Error('Unexpected Claude invocation');}}});
let browser;
try{
 const url='http://127.0.0.1:'+await app.listen(0)+'/?debug=1';
 for(const channel of ['msedge','chrome']){try{browser=await chromium.launch({channel,headless:true});break;}catch{/* use next installed browser */}}
 assert(browser,'Edge or Chrome must be installed.');
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.goto(url);
 await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);
 await page.evaluate(text=>{
  const {view}=window.__aitiarch['fixture.md'],from=view.state.doc.toString().indexOf(text);
  view.dispatch({selection:{anchor:from,head:from+text.length}});view.focus();
 },quote);
 await page.locator('.cm-sel-toolbar').getByRole('button',{name:'Visualize'}).click();
 const review=page.locator('.invocation-review');
 await review.getByRole('button',{name:'Send to Claude'}).waitFor();
 await review.getByRole('radio',{name:'Skill'}).check();
 const send=review.getByRole('button',{name:'Send to Codex'});
 await send.waitFor();
 await assert.rejects(readFile(record),{code:'ENOENT'});
 await send.click();
 const image=page.locator('img.skill-diagram-image');
 await image.waitFor();
 assert.match(await image.getAttribute('src'),/^\/api\/skill-diagram-preview\?/);
 assert(await image.evaluate(async element=>{await element.decode();return element.naturalWidth>0;}));
 assert.deepEqual(await readFile(file),original);
 await page.screenshot({path:path.join(out,'codex-skill-diagram.png')});
 const asset=new URL(await image.getAttribute('src'),url).searchParams.get('name');
 assert(asset);
 await assert.rejects(readFile(path.join(root,'assets',asset)),{code:'ENOENT'});
 await image.locator('xpath=ancestor::*[contains(@class,"margin-card")][1]').getByRole('button',{name:'Add to note'}).click();
 const saved=async predicate=>{
  for(let i=0;i<100;i++){
   const bytes=await readFile(file);
   if(predicate(bytes))return bytes;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('The editor did not save the expected bytes.');
 };
 const inserted=await saved(bytes=>bytes.includes(Buffer.from(asset)));
 assert(inserted.subarray(0,3).equals(original.subarray(0,3)));
 assert(!inserted.toString().replaceAll('\r\n','').includes('\n'));
 await page.evaluate(()=>window.__aitiarch['fixture.md'].view.focus());
 await page.keyboard.press('Control+z');
 await saved(bytes=>bytes.equals(original));
 console.log('Codex review, isolated fake turn, private SVG preview, insertion and byte-exact undo passed.');
}finally{await browser?.close();watcher.stop();await app.close();}
