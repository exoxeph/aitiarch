import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {initProject} from '../server/init.ts';
import {createSetupHttp} from '../server/setup-http.ts';
import {InkStore} from '../server/ink-store.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {captureAnchor} from '../shared/anchors.ts';

const output=path.resolve(process.env.BATCH2A_OUTPUT??'');
const relative=path.relative(path.resolve('..'),output);
assert(process.env.BATCH2A_OUTPUT&&(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'Use output outside the repo');
await mkdir(output,{recursive:true});
let calls=0;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const width of [1440,640]){
  const project=await mkdtemp(path.join(os.tmpdir(),'aitiarch-tour-check-'));
  await initProject({project,sharing:'private',confirmIgnore:false});
  const root=path.join(project,'.aitiarch'), note=path.join(root,'Welcome.md');
  const source='# Tour fixture\n\nA synthetic note.\n';
  const original=Buffer.from('\uFEFF'+source.replaceAll('\n','\r\n'));
  await writeFile(note,original);
  if(width===1440){
   const ink=await InkStore.open(root),seed=await ink.read('Welcome.md');
   const from=source.indexOf('A synthetic'),to=from+'A synthetic note.'.length;
   const anchor=captureAnchor(source,from,to);
   seed.document.items.push({id:'tour-thought',kind:'answer',body:'A synthetic thought.',anchor,originalAnchor:anchor,
    attachment:{status:'attached',from,to},generation:{requestId:'tour-thought',action:'think',provider:'claude',
     model:null,createdAt:new Date().toISOString(),status:'complete',evidence:[],dismissed:false}});
   await ink.write('Welcome.md',seed.document,seed.version);
  }else await new UiStateStore(root).updateTabs({v:1,tabs:['Welcome.md'],active:'Welcome.md',theme:'moss'});
  const store=await Store.open(root);
  const setup=width===1440?createSetupHttp({dir:process.env.AITIARCH_CONFIG_DIR,project,providers:[],ready:async()=>true}):undefined;
  const app=createApp({store,watcher:new NoteWatcher(store),distDir:path.resolve('dist'),setup,provider:{name:'claude',
   checkAvailability:async()=>({available:false}),invoke:async()=>{calls++;throw Error('Provider call forbidden');}}});
  const page=await browser.newPage({viewport:{width,height:800},reducedMotion:'reduce'});
  try{
   const origin='http://127.0.0.1:'+await app.listen(0);
   const requests=[];
   page.on('request',request=>requests.push([request.method(),request.url()]));
   page.setDefaultTimeout(5000);
   const bootWrite=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().endsWith('/api/ui-state'));
   await page.goto(origin+'/?debug=1');
   const tour=page.getByRole('dialog',{name:'Notebook tour'});
   if(setup){
    const setupCard=page.getByRole('dialog',{name:'Set up Aitiarch'});
    await setupCard.waitFor();
    assert.equal(await tour.count(),0);
    await setupCard.getByRole('button',{name:'Skip',exact:true}).click();
   }
   await tour.waitFor();
   const skip=tour.getByRole('button',{name:'Skip tour'}), next=tour.getByRole('button',{name:'Next'});
   await page.waitForFunction(()=>document.activeElement?.textContent==='Next');
   await bootWrite;
   requests.length=0;
   await page.keyboard.press('Tab');
   assert.equal(await skip.evaluate(el=>el===document.activeElement),true);
   await page.keyboard.press('Shift+Tab');
   assert.equal(await next.evaluate(el=>el===document.activeElement),true);
   await page.keyboard.press('Control+o');
   assert.equal(await page.getByRole('dialog').count(),1);
   const chat=page.locator('[data-tour="ai"]');
   const chatBounds=await chat.boundingBox();
   await page.mouse.click(chatBounds.x+chatBounds.width/2,chatBounds.y+chatBounds.height/2);
   assert.equal(await chat.getAttribute('aria-expanded'),'false');
   const editor=page.locator('[data-tour="editor"]').locator('.cm-content');
   await editor.evaluate(el=>el.focus());
   assert.equal(await editor.evaluate(el=>el===document.activeElement),false);
   const titles=['The slash menu','Links and attachments','Think on this and Ask','Margin threads','Constellation and Decisions','Aitiarch AI'];
   for(const [index,title] of titles.entries()){
    await tour.getByRole('heading',{name:title,exact:true}).waitFor();
    const bounds=await tour.locator('[data-tour-card]').boundingBox();
    assert(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=800);
    if(index===1||index===2||index===3&&width===640)await tour.getByText(/tour target is not visible/i).waitFor();
    else await tour.locator('[data-tour-highlight]').waitFor();
    await page.screenshot({path:path.join(output,'tour-'+width+'-'+(index+1)+'.png')});
    if(index<titles.length-1)await next.click();
   }
   await tour.getByRole('button',{name:'Back'}).click();
   await tour.getByRole('heading',{name:titles[4]}).waitFor();
   await next.click();
   const tourRequests=requests.filter(([method,url])=>method!=='GET'||!url.endsWith('/api/usage'));
   assert.deepEqual(tourRequests,[],'Tour navigation should make no requests');
   const saved=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().endsWith('/api/ui-state/tour'));
   await tour.getByRole('button',{name:'Finish'}).click();
   assert((await saved).ok());
   await tour.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.activeElement!==document.body);
   await page.reload();
   await chat.click();
   await page.locator('[data-tour="context"]').waitFor();
   await page.evaluate(()=>{
    const view=window.__aitiarch['Welcome.md'].view,from=view.state.doc.toString().indexOf('A synthetic');
    view.dispatch({selection:{anchor:from,head:from+11}});
    view.focus();
   });
   await page.locator('[data-tour="selection"]').waitFor();
   await page.keyboard.press('Control+k');
   const palette=page.getByRole('dialog',{name:'Command palette'});
   await palette.getByRole('textbox').fill('Replay tour');
   await page.keyboard.press('Enter');
   await tour.waitFor();
   await next.click();
   await tour.locator('[data-tour-highlight="context"]').waitFor();
   await next.click();
   await tour.locator('[data-tour-highlight="selection"]').waitFor();
   const skipped=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().endsWith('/api/ui-state/tour'));
   await page.keyboard.press('Escape');
   assert((await skipped).ok());
   assert.equal(await chat.getAttribute('aria-expanded'),'true');
   await tour.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Commands');
   await page.reload();
   await page.getByRole('button',{name:'Commands'}).waitFor();
   assert.equal(await tour.count(),0);
   assert.deepEqual(await readFile(note),original);
   assert.equal(JSON.parse(await readFile(path.join(root,'local','ui-state.json'),'utf8')).tour,'skipped');
   assert.equal(calls,0);
   console.log('Tour passed at '+width+'px');
  }finally{await page.close();await app.close();}
 }
}finally{await browser.close();}
