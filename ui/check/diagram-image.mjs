// An inserted AI diagram in the note: full width with no horizontal scroll, a line-sized caret beside it, click below places the caret
// after it, and Backspace removes the whole image in one undoable step instead of leaving raw text. Synthetic note, temp folder, fake provider only.
// Run: BATCH2A_OUTPUT=<dir outside the repo> node check/diagram-image.mjs   (after `vite build`)
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
const ui=fileURLToPath(new URL('../',import.meta.url)),repo=path.resolve(ui,'..');
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!output.toLowerCase().startsWith(repo.toLowerCase()),'Output must be outside repo');await mkdir(output,{recursive:true});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520"><rect x="10" y="10" width="1180" height="500" rx="12" fill="none" stroke="#8a7a63"/><text x="40" y="80" font-size="28" fill="#efe6d3">Synthetic wide diagram</text></svg>';
const name='ai-diagram-'+createHash('sha256').update(svg).digest('hex')+'.svg';
const image='![AI diagram: Synthetic wide diagram](assets/'+name+')';
const note='# Diagram note\n\nBefore the diagram.\n\n'+image+'\n\nAfter the diagram.\n';
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-diagram-image-'));execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');await mkdir(path.join(root,'assets'),{recursive:true});await writeFile(path.join(root,'assets',name),svg);await writeFile(path.join(root,'n.md'),note);
const store=await Store.open(root),watcher=new NoteWatcher(store,50,10);await watcher.start();
const app=createApp({store,watcher,distDir:path.join(ui,'dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{throw Error('Provider calls forbidden');}}});
const base=`http://127.0.0.1:${await app.listen(0)}`;const browser=await chromium.launch({channel:'msedge',headless:true});
const V=`window.__aitiarch['n.md'].view`,report={};
try{
 const page=await browser.newPage({viewport:{width:1800,height:1000}});
 await page.goto(base+'/?debug=1');await page.waitForFunction(()=>window.__aitiarch?.['n.md']);
 const img=page.locator('.cm-image img');await img.waitFor();await page.waitForFunction(()=>{const i=document.querySelector('.cm-image img');return i&&i.complete&&i.naturalWidth>0;});
 await page.evaluate(`${V}.dispatch({selection:{anchor:0}})`);await page.waitForTimeout(300);
 // 1. Full width, no horizontal scroll.
 const fit=await page.evaluate(()=>{const fig=document.querySelector('.cm-image'),sc=document.querySelector('.cm-scroller'),c=document.querySelector('.cm-content');const f=fig.getBoundingClientRect(),s=sc.getBoundingClientRect(),cc=c.getBoundingClientRect();const cs=getComputedStyle(c),column=cc.width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);return{figWidth:f.width,contentWidth:cc.width,column,marginEach:(sc.clientWidth-column)/2,scrollerWidth:sc.clientWidth,leftGap:f.left-s.left,rightGap:s.left+sc.clientWidth-f.right,scrollX:sc.scrollWidth-sc.clientWidth,figScroll:fig.scrollWidth-fig.clientWidth};});
 assert(fit.figWidth>fit.column+20,'the diagram protrudes beyond the text column: '+JSON.stringify(fit));assert(fit.figWidth<=fit.column+fit.marginEach+2,'but only up to halfway into each margin: '+JSON.stringify(fit));
 assert(fit.scrollX<=1&&fit.figScroll<=1,'no horizontal scrolling: '+JSON.stringify(fit));
 assert(fit.leftGap>=0&&fit.rightGap>=0,'inside the page: '+JSON.stringify(fit));
 // 2. The caret after the diagram is line sized and sits below it.
 const end=note.indexOf(image)+image.length;
 await page.evaluate(([p])=>{const v=window.__aitiarch['n.md'].view;v.dispatch({selection:{anchor:p}});v.focus();},[end]);await page.waitForTimeout(250);
 const caret=await page.evaluate(()=>{const c=document.querySelector('.cm-cursor-primary')?.getBoundingClientRect(),f=document.querySelector('.cm-image').getBoundingClientRect();return c?{height:c.height,top:c.top,figBottom:f.bottom,figHeight:f.height}:null;});
 assert(caret,'a caret is drawn');assert(caret.height<60,'caret is line sized, not diagram sized: '+JSON.stringify(caret));assert(caret.top>=caret.figBottom-2,'caret sits below the diagram: '+JSON.stringify(caret));
 report.caret=caret;await page.screenshot({path:path.join(output,'diagram-image-caret.png')});
 // 3. Clicking in the space under the diagram puts the caret after it.
 await page.evaluate(`${V}.dispatch({selection:{anchor:0}})`);
 const box=await page.locator('.cm-image').boundingBox(),room=await page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('.cm-image')).marginBottom));
 await page.mouse.click(box.x+box.width/2,box.y+box.height+Math.min(24,room/2));
 const head=await page.evaluate(`${V}.state.selection.main.head`);assert.equal(head,end,'click below the diagram places the caret right after it');
 // 4. Backspace removes the whole image (no raw text left); one undo brings it back.
 await page.keyboard.press('Backspace');
 const after=await page.evaluate(`${V}.state.doc.toString()`);
 assert(!after.includes('![')&&!after.includes('ai-diagram'),'no raw image text left behind: '+JSON.stringify(after));
 assert(after.includes('Before the diagram.')&&after.includes('After the diagram.'),'neighbouring text untouched');
 assert.equal(await page.locator('.cm-image').count(),0,'the figure is gone');
 await page.keyboard.press('Control+z');assert.equal(await page.evaluate(`${V}.state.doc.toString()`),note,'one undo restores the exact note');
 // 5. Delete just before the image removes it too.
 const start=note.indexOf(image);await page.evaluate(([p])=>{const v=window.__aitiarch['n.md'].view;v.dispatch({selection:{anchor:p}});v.focus();},[start]);await page.keyboard.press('Delete');
 assert(!(await page.evaluate(`${V}.state.doc.toString()`)).includes('!['),'Delete before the image removes it');
 console.log(JSON.stringify({pass:true,...report,checks:['full width no scroll','line-sized caret below','click below','Backspace removes whole image','undo exact','Delete removes whole image'],providerCalls:0}));
}finally{await browser.close();await app.close?.();await watcher.stop?.();await rm(root,{recursive:true,force:true});}
