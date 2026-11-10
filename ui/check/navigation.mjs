// Real-pointer navigation gate; synthetic BOM+CRLF fixture, no provider calls.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
const ui=fileURLToPath(new URL('../',import.meta.url)),output=process.env.BATCH2A_OUTPUT;
assert(output&&!path.resolve(output).toLowerCase().startsWith(path.resolve(ui,'..').toLowerCase()));await mkdir(output,{recursive:true});
const text='\uFEFF# Navigation heading\r\n\r\nPlain paragraph alpha bravo charlie.\r\nA second line in this paragraph.\r\n\r\nSome **bold words** followed by plain tail.\r\n\r\nSome ~~struck words~~ followed by another tail.\r\n\r\n> [!note] Callout heading\r\n> Callout paragraph alpha bravo.\r\n\r\n- List paragraph alpha bravo.\r\n\r\n| Name | Value |\r\n| :---: | ---: |\r\n| **bold *nested*** | `code` |\r\n\r\nLast paragraph alpha bravo.\r\n\r\nA wrapping paragraph with enough unique words to exercise several visual lines when the writing page becomes narrow and the pointer selects only one visual row.\r\n';
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-navigation-'));
execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');await writeFile(path.join(root,'plan.md'),text);
let calls=0;const store=await Store.open(root),watcher=new NoteWatcher(store,50,10);await watcher.start();
const app=createApp({store,watcher,distDir:path.join(ui,'dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{calls++;throw Error('Provider forbidden');}}});
const base=`http://127.0.0.1:${await app.listen(0)}`,browser=await chromium.launch({channel:'msedge',headless:true}),report={};
try{for(const theme of ['ember','moss']){
 const page=await browser.newPage({viewport:{width:1440,height:1100},});
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==base)return r.abort();if(u.pathname==='/api/usage')return r.fulfill({json:{providers:[],hourlyCap:2}});return r.continue();});
 await page.goto(base+'/?debug=1');await page.waitForFunction(()=>window.__aitiarch?.['plan.md']);await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const position=async(needle,offset=0)=>{
  await page.evaluate(([n,o])=>{const v=window.__aitiarch['plan.md'].view,p=v.state.doc.toString().indexOf(n)+o,dom=v.domAtPos(p).node;(dom.nodeType===1?dom:dom.parentElement).closest('.cm-line')?.scrollIntoView({block:'nearest'});},[needle,offset]);await settle();
  return page.evaluate(([n,o])=>{const v=window.__aitiarch['plan.md'].view,p=v.state.doc.toString().indexOf(n)+o,c=v.coordsAtPos(p);return{p,x:c.left+1,y:(c.top+c.bottom)/2};},[needle,offset]);
 };
 const select=()=>page.evaluate(()=>{const v=window.__aitiarch['plan.md'].view,r=v.state.selection.main;return{from:r.from,to:r.to,anchor:r.anchor,head:r.head,text:v.state.sliceDoc(r.from,r.to)};});
 const R={};report[theme]=R;
 R.checks={};const check=(name,ok)=>{R.checks[name]=!!ok;};
 R.geometry=await page.evaluate(()=>{const v=window.__aitiarch['plan.md'].view;return{documentTop:v.documentTop,padding:v.documentPadding,lines:[...v.contentDOM.querySelectorAll('.cm-line')].slice(0,8).map(e=>{const p=v.posAtDOM(e),b=v.lineBlockAt(p),r=e.getBoundingClientRect();return{p,top:r.top,height:r.height,modelTop:b.top,modelHeight:b.height,hit:v.posAtCoords({x:r.left+40,y:r.top+r.height/2}),text:e.textContent};}),layers:[...v.scrollDOM.querySelectorAll('.cm-layer')].map(e=>({class:e.className,top:e.getBoundingClientRect().top,cssTop:getComputedStyle(e).top} ))};});
 if(process.env.NAV_STYLE_PROBE)await page.addStyleTag({content:process.env.NAV_STYLE_PROBE});
 for(const [name,needle,offset,word] of [['plain','Plain paragraph',8,'paragraph'],['bold','bold words',2,'bold'],['strike','struck words',2,'struck'],['heading','Navigation heading',4,'Navigation'],['callout','Callout paragraph',10,'paragraph'],['list','List paragraph',8,'paragraph']]){
  const away=await position('Last paragraph',3);await page.mouse.click(away.x,away.y);await settle();
  const p=await position(needle,offset);const hit=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.className,p);
  await page.mouse.move(p.x,p.y);await page.mouse.down();await settle();const after=await position(needle,offset);await page.mouse.up();
  await page.mouse.click(p.x,p.y,{clickCount:2});await settle();const selected=await select();
  R[name]={shiftX:after.x-p.x,shiftY:after.y-p.y,hit,selected,pass:selected.text===word};
  check(`${name} stable pointer`,after.x===p.x&&after.y===p.y);
 }
 // Inspect rendered table click separately: it intentionally reveals source.
 const table=page.locator('.cm-table-widget td').first();await table.click();await settle();R.table={source:await page.locator('.cm-table-source').count()>0};
 let p=await position('nested',2);await page.mouse.dblclick(p.x,p.y);await settle();check('table source word',(await select()).text==='nested');
 const click=async(needle,offset=0,count=1)=>{const p=await position(needle,offset);for(let i=1;i<=count;i++)await page.mouse.click(p.x,p.y,{clickCount:i});await settle();return select();};
 let s=await click('Plain paragraph',8,3);check('triple click paragraph',s.text==='Plain paragraph alpha bravo charlie.\nA second line in this paragraph.');
 p=await position('Plain paragraph');await page.mouse.click(p.x-25,p.y);await settle();check('margin line',(await select()).text==='Plain paragraph alpha bravo charlie.');
 await page.mouse.click(p.x-25,p.y,{clickCount:2});await settle();check('margin paragraph',(await select()).text==='Plain paragraph alpha bravo charlie.\nA second line in this paragraph.');
 for(const label of ['near','far']){
  await click('Last paragraph',2);const e=await position('Plain paragraph alpha bravo charlie.',36);
  const x=label==='near'?e.x+25:await page.locator('.cm-editor').evaluate(e=>e.getBoundingClientRect().right-4);
  await page.mouse.click(x,e.y);await settle();check(`${label} right end`,(await select()).head===e.p);
 }
 const first=await click('Plain paragraph',6);p=await position('Plain paragraph',21);await page.keyboard.down('Shift');await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');await settle();s=await select();check('shift click',s.anchor===first.head&&s.head===p.p);
 const boldStart=await click('bold words',1);p=await position('bold words',7);await page.keyboard.down('Shift');await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');await settle();s=await select();check('shift click bold',s.anchor===boldStart.head&&s.head===p.p);
 const dragStart=await position('Plain paragraph',2),dragEnd=await position('A second line',16);
 await page.mouse.move(dragStart.x,dragStart.y);await page.mouse.down();await page.mouse.move(dragEnd.x,dragEnd.y,{steps:20});await page.mouse.up();await settle();s=await select();check('drag',s.from===dragStart.p&&s.to===dragEnd.p);
 // Word-like keys are real keyboard input, with the starting caret set by a click.
 for(const [key,needle,offset,expected,extend] of [
  ['Home','Plain paragraph',18,22,false],['End','Plain paragraph',18,58,false],
  ['Control+Home','Last paragraph',9,0,false],['Control+End','Plain paragraph',9,null,false],
  ['Control+ArrowLeft','Plain paragraph',12,28,false],['Control+ArrowRight','Plain paragraph',6,38,false],
  ['Shift+Home','Plain paragraph',18,22,true],['Shift+End','Plain paragraph',18,58,true],
  ['Control+Shift+Home','Last paragraph',9,0,true],['Control+Shift+End','Plain paragraph',9,null,true],
  ['Control+Shift+ArrowLeft','Plain paragraph',12,28,true],['Control+Shift+ArrowRight','Plain paragraph',6,38,true],
 ]){
  const before=await click(needle,offset);await page.keyboard.press(key);await settle();s=await select();
  const end=await page.evaluate(()=>window.__aitiarch['plan.md'].view.state.doc.length);
  check(key,s.head===(expected??end)&&(!extend||s.anchor===before.head));
 }
 // Navigation after explicit save and after page reload must retain hit testing.
 const editCaret=await click('Last paragraph',4);assert.equal(editCaret.from,editCaret.to,'save check must start with a caret');await page.keyboard.type('X');await page.evaluate(()=>window.__aitiarch['plan.md'].session.flush());await page.keyboard.press('Control+z');await page.evaluate(()=>window.__aitiarch['plan.md'].session.flush());
 check('after save',(await click('Plain paragraph',8,2)).text==='paragraph');
 await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['plan.md']);await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);R.afterReload=await click('Plain paragraph',8,2);check('after reload',R.afterReload.text==='paragraph');
 const a=await position('Plain paragraph',6),b=await position('Some **bold',25);
 await page.mouse.click(a.x,a.y);await settle(); // a drag beginning inside an existing selection would move text natively
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:15});await page.mouse.up();await settle();
 R.selection=await page.evaluate(()=>{const v=window.__aitiarch['plan.md'].view,c=v.contentDOM.getBoundingClientRect(),s=v.scrollDOM.getBoundingClientRect();return{content:{left:c.left,top:c.top},scroller:{left:s.left,top:s.top},rects:[...document.querySelectorAll('.cm-selectionBackground,.cm-gm-sel')].map(e=>{const r=e.getBoundingClientRect();return{element:e.className,left:r.left,top:r.top,right:r.right,bottom:r.bottom};}),toolbar:(()=>{const e=document.querySelector('.cm-sel-toolbar'),r=e?.getBoundingClientRect();return r?{left:r.left,top:r.top,bottom:r.bottom}:null;})()};});
 R.selectionProtection=await page.evaluate(()=>{const v=window.__aitiarch['plan.md'].view,r=v.state.selection.main,a=v.coordsAtPos(r.from),b=v.coordsAtPos(r.to),prev=v.coordsAtPos(Math.max(0,v.state.doc.lineAt(r.from).from-1)),t=document.querySelector('.cm-sel-toolbar').getBoundingClientRect(),layer=document.querySelector('.cm-selectionLayer'),css=getComputedStyle(layer);return{toolbarClear:t.left>=b.right+8||t.right<=a.left-8||t.bottom<=Math.min(a.top,prev.top)-2||t.top>=b.bottom+2,clip:css.clipPath,layerWidth:layer.getBoundingClientRect().width};});
 check('toolbar protects selection and preceding line',R.selectionProtection.toolbarClear);check('selection layer clipped',R.selectionProtection.clip!=='none'&&R.selectionProtection.layerWidth>0);
 await page.screenshot({path:path.join(output,`navigation-selection-${theme}.png`)});
 await page.evaluate(()=>{const v=window.__aitiarch['plan.md'].view,p=v.dom.closest('.pane');p.scrollTop+=v.coordsAtPos(5).top-p.getBoundingClientRect().top-12;});await settle();
 await click('Navigation heading',3,2);await settle();
 check('toolbar avoids text near top',await page.evaluate(()=>{const v=window.__aitiarch['plan.md'].view,r=v.state.selection.main,b=v.coordsAtPos(r.to),t=document.querySelector('.cm-sel-toolbar').getBoundingClientRect();const c=v.contentDOM.getBoundingClientRect(),css=getComputedStyle(v.contentDOM);return t.top>=b.bottom+2||t.left>=c.right-parseFloat(css.paddingRight)||t.right<=c.left+parseFloat(css.paddingLeft);}));
 // Color + vertical placement of the drawn caret, not just the underlying position.
 await click('Plain paragraph',10);await page.waitForTimeout(70);
 R.caret=await page.evaluate(()=>{const v=window.__aitiarch['plan.md'].view,a=v.coordsAtPos(v.state.selection.main.head),e=document.querySelector('.cm-cursor-primary'),r=e.getBoundingClientRect();return{color:getComputedStyle(e).borderLeftColor,dy:Math.abs(r.top-a.top),dx:Math.abs(r.left-a.left)};});
 check('caret aligned',R.caret.dy<2&&R.caret.dx<2);check('caret visible',R.caret.color===(theme==='moss'?'rgb(205, 219, 144)':'rgb(240, 171, 103)'));
 await page.screenshot({path:path.join(output,`navigation-${theme}.png`)});
 await page.setViewportSize({width:360,height:1100});await settle();
 await click('A wrapping paragraph',85);
 const edges=await page.evaluate(()=>{const v=window.__aitiarch['plan.md'].view,r=v.state.selection.main,line=v.state.doc.lineAt(r.head),c=v.coordsAtPos(r.head),positions=[];for(let p=line.from;p<=line.to;p++){const a=v.coordsAtPos(p,1),b=v.coordsAtPos(p,-1);if(Math.abs(a.top-c.top)<1||Math.abs(b.top-c.top)<1)positions.push(p);}return{from:Math.min(...positions),to:Math.max(...positions),lineFrom:line.from};});
 check('fixture wraps',edges.from>edges.lineFrom);
 await page.keyboard.press('Home');await settle();check('wrapped Home',(await select()).head===edges.from);
 await click('A wrapping paragraph',85);await page.keyboard.press('End');await settle();R.wrap={edges,end:await select()};check('wrapped End',(await select()).head===edges.to);
 await click('A wrapping paragraph',85);const row=await position('A wrapping paragraph',85),left=await page.evaluate(()=>{const v=window.__aitiarch['plan.md'].view,r=v.contentDOM.getBoundingClientRect();return r.left+8;});
 await page.mouse.click(left,row.y);await settle();s=await select();R.wrap.margin=s;check('wrapped margin selects visual line',s.from===edges.from&&s.to===edges.to);
 // Repeat a real word double-click while the narrow toolbar appears/disappears.
 for(let i=0;i<3;i++){
  await click('Last paragraph',4);const hit=await position('when the writing',1);
  await page.mouse.dblclick(hit.x,hit.y);await settle();check(`narrow repeated word ${i}`,(await select()).text==='when');
 }
 await page.screenshot({path:path.join(output,`navigation-narrow-${theme}.png`)});
 await page.evaluate(()=>window.__aitiarch['plan.md'].session.flush());await writeFile(path.join(output,'navigation.json'),JSON.stringify(report,null,2));assert.deepEqual(await readFile(path.join(root,'plan.md')),Buffer.from(text));
 await page.close();
}}finally{await browser.close();await app.close();await watcher.stop();await rm(root,{recursive:true,force:true});}
assert.equal(calls,0);await writeFile(path.join(output,'navigation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!process.env.NAV_DIAGNOSE)for(const r of Object.values(report)){for(const n of ['plain','bold','strike','heading','callout','list'])assert(r[n].pass,`${n} double-click failed`);assert.deepEqual(Object.entries(r.checks).filter(([,v])=>!v),[],'navigation checks failed');}
