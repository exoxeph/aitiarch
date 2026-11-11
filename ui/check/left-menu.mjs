// Real-browser check for M1: the left edge menu, the removed right-hand tabs, the note menu and the chat shell.
// Real mouse and keyboard events against the built app with synthetic OS-temp notes. No provider is ever called.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const here=path.dirname(fileURLToPath(import.meta.url)),uiDir=path.resolve(here,'..');
const output=process.env.BATCH2A_OUTPUT||process.env.GROVE_OUTPUT;
if(!output)throw new Error('Set BATCH2A_OUTPUT (or GROVE_OUTPUT) to a folder outside the repository.');
mkdirSync(output,{recursive:true});
const project=mkdtempSync(path.join(os.tmpdir(),'aitiarch-left-menu-')),root=path.join(project,'.aitiarch');
mkdirSync(path.join(root,'folder'),{recursive:true});
const text=['# Menu fixture','',...Array.from({length:12},(_,i)=>`Paragraph ${i+1}: some plain text to select by dragging.`)].join('\n')+'\n';
const note=path.join(root,'notebook.md');writeFileSync(note,text);writeFileSync(path.join(root,'folder','sub.md'),'# Sub\n\nSub note.\n');
const unchanged=readFileSync(note);
let browser,proc;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 proc=spawn(process.execPath,[path.join(uiDir,'server','main.ts'),'--root',root,'--port','0','--no-open'],{cwd:uiDir,env:{...process.env,AITIARCH_CONFIG_DIR:path.join(project,'config')},stdio:['ignore','pipe','pipe']}); // a temp registry, never the user's
 const url=await new Promise((resolve,reject)=>{let o='';proc.stdout.on('data',d=>{o+=d;const m=/AITIARCH_READY (.*)/.exec(o);if(m)resolve(JSON.parse(m[1]).launch);});proc.on('exit',c=>reject(new Error('Server exited early '+c)));setTimeout(()=>reject(new Error('Server startup timeout')),10000);});
 for(const channel of ['msedge','chrome']){try{browser=await chromium.launch({channel,headless:true});break;}catch{/* next */}}
 if(!browser)throw new Error('Edge or Chrome is required.');
 const providerCalls=[];
 const open=async(options={})=>{
  const context=await browser.newContext({viewport:{width:1440,height:900},...options}),page=await context.newPage();
  page.on('request',r=>{if(/\/api\/assistance\/invoke|\/api\/chat\/send|\/api\/chatgpt-plan\/(sign-in|models)/.test(r.url()))providerCalls.push(r.url());});
  await page.goto(url+'&debug=1'); // the launch link hands this browser its session
  await page.locator('#note-tree').waitFor({state:'attached'});
  return {context,page};
 };
 const state=page=>page.locator('#note-tree').getAttribute('data-state');
 const waitState=(page,want)=>page.waitForFunction(w=>document.querySelector('#note-tree')?.getAttribute('data-state')===w,want,{timeout:3000});
 const burger=page=>page.getByRole('button',{name:'Notes menu',exact:true});

 // ---------- wide viewport, real mouse ----------
 const {context,page}=await open();
 // The notebook opens through the menu: pin it, click the note, close.
 await burger(page).click();await waitState(page,'open');
 await page.locator('.tree-item').filter({hasText:/^notebook$/}).click();
 await page.locator('.cm-content').waitFor();await waitState(page,'closed'); // choosing a note closes the menu
 assert.equal(await burger(page).getAttribute('aria-expanded'),'false');

 // Hot zone: 8 px wide, full height, flush left.
 const zone=await page.locator('.menu-edge').boundingBox();
 assert.equal(zone.x,0);assert.equal(zone.width,8);assert.ok(zone.height>=890,`hot zone should span the window, got ${zone.height}`);
 const column=await page.locator('.editor-col').boundingBox();

 // Brushing the edge does not open it; dwelling does.
 await page.mouse.move(400,400);await page.mouse.move(2,400);await sleep(40);await page.mouse.move(400,400);await sleep(350);
 assert.equal(await state(page),'closed','a brush past the edge must not open the menu');
 await page.mouse.move(2,400);await waitState(page,'open');
 await page.screenshot({path:path.join(output,'menu-open.png')});
 const after=await page.locator('.editor-col').boundingBox();
 assert.deepEqual(after,column,'the note column must not reflow when the menu opens');
 assert.ok(Number(await page.locator('.menu-scrim').evaluate(e=>getComputedStyle(e).opacity))>0,'the note is dimmed while the menu is open');
 // Staying inside the menu keeps it; leaving closes it.
 await page.mouse.move(120,300);await sleep(700);assert.equal(await state(page),'open');
 await page.mouse.move(900,300);await waitState(page,'closed');

 // A drag from the text to the edge never opens it, and neither does letting go there.
 const para=await page.locator('.cm-line').nth(4).boundingBox();
 await page.mouse.move(para.x+200,para.y+8);await page.mouse.down();await page.mouse.move(2,para.y+8,{steps:12});await sleep(500);
 assert.equal(await state(page),'closed','a drag selection must not open the menu');
 await page.mouse.up();await sleep(500);assert.equal(await state(page),'closed','releasing a drag at the edge must not open the menu');
 await page.mouse.move(900,600);await page.mouse.click(900,600);

 // Pin with the hamburger; stays after the pointer leaves; Esc closes and gives focus back.
 await burger(page).click();await waitState(page,'open');assert.equal(await burger(page).getAttribute('aria-expanded'),'true');
 await page.mouse.move(900,500);await sleep(700);assert.equal(await state(page),'open','a pinned menu stays open');
 assert.deepEqual(await page.locator('.editor-col').boundingBox(),column,'pinned menu must not reflow the note');
 await page.keyboard.press('Escape');await waitState(page,'closed');assert.equal(await burger(page).getAttribute('aria-expanded'),'false');

 // Keyboard only: Enter on the hamburger pins and moves focus in; Tab stays in order; Esc returns focus.
 await burger(page).focus();await page.keyboard.press('Enter');await waitState(page,'open');
 assert.ok(await page.evaluate(()=>document.querySelector('#note-tree').contains(document.activeElement)),'focus should move into the menu');
 const ring=await page.evaluate(()=>{const s=getComputedStyle(document.activeElement);return {style:s.outlineStyle,width:parseFloat(s.outlineWidth),shadow:s.boxShadow};});
 assert.ok(ring.style!=='none'&&ring.width>=1||ring.shadow!=='none','the focused menu item must show a visible focus ring');
 for(let i=0;i<4;i++)await page.keyboard.press('Tab');
 assert.ok(await page.evaluate(()=>document.querySelector('#note-tree').contains(document.activeElement)),'Tab moves through the menu items');
 await page.keyboard.press('Escape');await waitState(page,'closed');
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Notes menu');

 // Menu contents: search, new note and folder (not available yet), the tree with folders, usage and settings.
 await burger(page).click();await waitState(page,'open');
 const menu=page.locator('#note-tree');
 await menu.getByRole('button',{name:/^Search/}).waitFor();
 assert.equal(await menu.getByRole('button',{name:/^New note/}).getAttribute('aria-disabled'),'true');
 assert.equal(await menu.getByRole('button',{name:/^New folder/}).getAttribute('aria-disabled'),'true');
 const dir=menu.locator('.tree-dir').first();assert.equal(await dir.getAttribute('aria-expanded'),'true');await dir.click();assert.equal(await dir.getAttribute('aria-expanded'),'false');await dir.click();
 await menu.getByText('My AI calls and tokens',{exact:true}).waitFor();await menu.getByText('Settings',{exact:true}).click();
 const typing=menu.getByRole('switch',{name:/Typing help/});await typing.waitFor();
 const was=await typing.getAttribute('aria-checked');await typing.click();assert.notEqual(await typing.getAttribute('aria-checked'),was,'a settings switch must flip');await typing.click();
 await page.screenshot({path:path.join(output,'menu-pinned.png')});
 // Search closes the menu and opens the command palette (Ctrl+K); choosing a note closes it too.
 await menu.getByRole('button',{name:/^Search/}).click();await waitState(page,'closed');await page.getByRole('dialog').or(page.locator('.overlay')).first().waitFor();await page.keyboard.press('Escape');
 await burger(page).click();await waitState(page,'open');
 await menu.locator('.tree-item').filter({hasText:/^sub$/}).click();await waitState(page,'closed');
 await page.getByRole('tab',{name:/sub/}).or(page.locator('.tab',{hasText:'sub'})).first().waitFor();

 // The right-hand Details and Activity tabs are gone; nothing was lost (details live in the note menu).
 assert.equal(await page.locator('.rightpanel,.right-tabs').count(),0);
 assert.equal(await page.getByRole('button',{name:/^(Details|Activity)/}).count(),0);
 const noteMenu=page.getByRole('button',{name:/^Note menu/});assert.equal(await noteMenu.getAttribute('aria-expanded'),'false');
 await noteMenu.click();await page.getByRole('heading',{name:'Properties'}).waitFor();await page.keyboard.press('Escape');
 assert.equal(await noteMenu.getAttribute('aria-expanded'),'false');

 // Chat shell.
 const chat=page.getByRole('button',{name:/^Chat/});assert.equal(await chat.getAttribute('aria-expanded'),'false');
 await chat.click();const panel=page.locator('#chat-panel');await panel.waitFor();
 assert.match(await panel.getByRole('heading').first().innerText(),/^Aitiarch AI - On (notebook|sub)$/);
 assert.equal(await panel.getByRole('button',{name:/^This note/}).getAttribute('aria-pressed'),'true');
 assert.equal(await panel.getByRole('button',{name:/^Threads/}).getAttribute('aria-pressed'),'true');
 assert.equal(await panel.getByRole('button',{name:/^Selection/}).getAttribute('aria-pressed'),'false');
 assert.equal(await panel.locator('.chat-suggestion').count(),3);
 const send=panel.getByRole('button',{name:'Send message'});assert.equal(await send.isDisabled(),true);
 await panel.locator('.chat-suggestion').first().click();
 const composer=panel.getByRole('textbox',{name:'Message Aitiarch AI'});assert.ok((await composer.inputValue()).length>5);
 await composer.press('Enter');
 const reviewCard=panel.getByRole('region',{name:'What will be sent'});await reviewCard.waitFor(); // Enter prepares a review; nothing is sent until Send
 await reviewCard.getByRole('button',{name:'Cancel'}).click();assert.ok((await composer.inputValue()).length>5,'cancelling a review gives the question back');
 await page.screenshot({path:path.join(output,'chat-open.png')});
 await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.equal(await chat.getAttribute('aria-expanded'),'false');
 assert.equal(providerCalls.length,0,'the chat shell must not call a provider: '+providerCalls.join(','));
 await context.close();

 // ---------- reduced motion: a fade, never a slide ----------
 {const {context:c,page:p}=await open({reducedMotion:'reduce'});
  const props=await p.locator('#note-tree').evaluate(e=>({closed:getComputedStyle(e).transform,transition:getComputedStyle(e).transitionProperty}));
  assert.equal(props.closed,'none','reduced motion: the closed menu is not slid off screen');assert.ok(!/transform|all/.test(props.transition),'reduced motion: no transform transition, got '+props.transition);
  await burger(p).click();await waitState(p,'open');assert.equal(await p.locator('#note-tree').evaluate(e=>getComputedStyle(e).transform),'none');
  await sleep(300);assert.ok(Number(await p.locator('#note-tree').evaluate(e=>getComputedStyle(e).opacity))>0.9,'reduced motion: open menu is fully visible');
  await c.close();}

 // ---------- narrow and touch: the hamburger tap works; there is no edge zone ----------
 {const {context:c,page:p}=await open({viewport:{width:390,height:800},hasTouch:true,isMobile:true});
  assert.equal(await p.locator('.menu-edge').evaluate(e=>getComputedStyle(e).display),'none','no hot zone on touch');
  await burger(p).tap();await waitState(p,'open');
  const box=await p.locator('#note-tree').boundingBox();assert.ok(box.width<=390*0.9,'the menu leaves room for the note on a phone');
  await p.screenshot({path:path.join(output,'menu-narrow.png')});
  await p.keyboard.press('Escape');await waitState(p,'closed');await c.close();}

 // Tablet and phone widths: with no side panels the note column takes the window; no leftover grid column squeezes it.
 for(const w of [760,390]){const {context:c,page:p}=await open({viewport:{width:w,height:900}});
  const width=await p.locator('.editor-col').evaluate(e=>e.getBoundingClientRect().width);assert.ok(width>=w-40,`the note column should fill a ${w}px window, got ${width}px`);await c.close();}

 assert.ok(readFileSync(note).equals(unchanged),'Markdown bytes must be untouched');
 console.log(JSON.stringify({pass:true,providerCalls:providerCalls.length}));
}finally{
 await browser?.close().catch(()=>{});
 if(proc&&!proc.killed)proc.kill();
 const target=path.resolve(project);if(target.startsWith(path.resolve(os.tmpdir()))&&path.basename(target).startsWith('aitiarch-left-menu-')){console.log('CLEANUP TARGET:',target);await sleep(300);rmSync(target,{recursive:true,force:true,maxRetries:5});}
}
