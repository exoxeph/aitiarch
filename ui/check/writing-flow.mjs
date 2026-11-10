// Writing flow in the real app: Enter continues lists, checklists, quotes and callouts, Enter on an empty item steps out, Backspace after a
// marker removes it, Tab nests, a code block is left with Enter on its empty last line and removed with Backspace from the line under it.
// Real key presses, synthetic notes in a temp folder, fake provider only.
// Run: BATCH2A_OUTPUT=<dir outside the repo> node check/writing-flow.mjs   (after `vite build`)
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
const ui=fileURLToPath(new URL('../',import.meta.url)),repo=path.resolve(ui,'..');
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!output.toLowerCase().startsWith(repo.toLowerCase()),'Output must be outside repo');await mkdir(output,{recursive:true});
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-writing-'));execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');await writeFile(path.join(root,'n.md'),'x\n');
const store=await Store.open(root),watcher=new NoteWatcher(store,50,10);await watcher.start();
const app=createApp({store,watcher,distDir:path.join(ui,'dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{throw Error('Provider calls forbidden');}}});
const base=`http://127.0.0.1:${await app.listen(0)}`;const browser=await chromium.launch({channel:'msedge',headless:true});
const V=`window.__aitiarch['n.md'].view`;
// start: the note before typing; caret: index to start at (default end); keys: text to type or {Key} to press; want: the note afterwards.
const cases=[
 {name:'bullets continue and the second Enter leaves the list',start:'',keys:['- One','{Enter}','Two','{Enter}','{Enter}','After'],want:'- One\n- Two\nAfter'},
 {name:'numbers count up and leave on an empty item',start:'',keys:['1. A','{Enter}','B','{Enter}','{Enter}','X'],want:'1. A\n2. B\nX'},
 {name:'checklist items continue unticked and leave on an empty item',start:'',keys:['- [ ] A','{Enter}','B','{Enter}','{Enter}','X'],want:'- [ ] A\n- [ ] B\nX'},
 {name:'a ticked task continues as an unticked one',start:'- [x] Done',keys:['{Enter}','Next'],want:'- [x] Done\n- [ ] Next'},
 {name:'Tab nests an item and an empty nested item steps out one level',start:'',keys:['- A','{Enter}','{Tab}','B','{Enter}','{Enter}','C'],want:'- A\n  - B\n- C'},
 {name:'a nested item keeps its indentation on Enter',start:'- A\n  - B',keys:['{Enter}','C'],want:'- A\n  - B\n  - C'},
 {name:'a new item in the middle renumbers the rest',start:'1. A\n2. B\n3. C',caret:4,keys:['{Enter}','X'],want:'1. A\n2. X\n3. B\n4. C'},
 {name:'Enter in the middle of an item splits it',start:'- Onetwo',caret:5,keys:['{Enter}'],want:'- One\n- two'},
 {name:'a quote continues and the second Enter leaves it',start:'',keys:['> Q','{Enter}','R','{Enter}','{Enter}','X'],want:'> Q\n> R\nX'},
 {name:'a callout keeps going inside its box and the second Enter leaves it',start:'',keys:['/note','{Enter}','Body','{Enter}','More','{Enter}','{Enter}','After'],want:'> [!note]\n> Body\n> More\nAfter'},
 {name:'a tip callout continues the same way',start:'',keys:['/tip','{Enter}','T','{Enter}','U','{Enter}','{Enter}','X'],want:'> [!tip]\n> T\n> U\nX'},
 {name:'a warning callout continues the same way',start:'',keys:['/warning','{Enter}','W','{Enter}','{Enter}','X'],want:'> [!warning]\n> W\nX'},
 {name:'a list inside a quote continues with its quote prefix',start:'> - A',keys:['{Enter}','B','{Enter}','{Enter}','{Enter}','C'],want:'> - A\n> - B\nC'},
 {name:'Backspace right after a bullet removes the bullet',start:'- One',caret:2,keys:['{Backspace}'],want:'One'},
 {name:'Backspace right after a nested bullet moves it out one level',start:'  - One',caret:4,keys:['{Backspace}'],want:'- One'},
 {name:'Backspace right after a quote marker removes the quote',start:'> Hello',caret:2,keys:['{Backspace}'],want:'Hello'},
 {name:'Enter in a code block adds a line; Enter on its empty last line leaves it',start:'',keys:['/code','{Enter}','a','{Enter}','b','{Enter}','{Enter}','After'],want:'```\na\nb\n```\nAfter'},
 {name:'Backspace on the empty line under a code block removes the whole block',start:'```\ncode\n```\n',keys:['{Backspace}'],want:''},
 {name:'Backspace under a code block keeps the text before it',start:'Before\n\n```\ncode\n```\n',keys:['{Backspace}'],want:'Before\n\n'},
];
const failures=[];
try{
 const page=await browser.newPage({viewport:{width:1300,height:900}});
 await page.goto(base+'/?debug=1');await page.waitForFunction(()=>window.__aitiarch?.['n.md']);
 for(const c of cases){
  await page.evaluate(([start,caret])=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:start},selection:{anchor:caret??start.length}});v.focus();},[c.start,c.caret??null]);
  await page.waitForTimeout(120);
  for(const k of c.keys){const m=/^\{(.+)\}$/.exec(k);if(m)await page.keyboard.press(m[1]);else await page.keyboard.type(k,{delay:4});await page.waitForTimeout(40);}
  await page.waitForTimeout(80);
  const got=await page.evaluate(`${V}.state.doc.toString()`);
  if(got!==c.want)failures.push({case:c.name,want:c.want,got});
 }
 // One undo reverts a whole Enter or Backspace step.
 await page.evaluate(()=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:'- One'},selection:{anchor:5}});v.focus();});
 await page.keyboard.press('Enter');await page.keyboard.press('Control+z');
 const undone=await page.evaluate(`${V}.state.doc.toString()`);if(undone!=='- One')failures.push({case:'undo of Enter',want:'- One',got:undone});
 assert.deepEqual(failures,[],'writing flow failures:\n'+JSON.stringify(failures,null,1));
 console.log(JSON.stringify({pass:true,cases:cases.length+1,providerCalls:0}));
}finally{await browser.close();await app.close?.();await watcher.stop?.();await rm(root,{recursive:true,force:true});}
