// Real-browser check: the Pipeline Studio canvas (slice 4a). Synthetic temp notes, a temp settings folder, fake adapters and a fake provider; no live provider is called.
// Needs BATCH2A_OUTPUT (a folder outside the repo) for screenshots. Run from the ui folder after a build.
import './config-isolation.mjs'; // first: an empty temp config folder, never the machine's real one
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {ProviderError} from '../server/providers/index.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {locked} from '../shared/pipeline-config.ts';
import {ROLE_REGISTRY,defaultMachineSetup} from '../shared/setup.ts';
import {createSetupHttp} from '../server/setup-http.ts';
import {saveMachineSetup} from '../server/setup-store.ts';
import {PIPELINE_NODES,edgesOf,nodeById} from '../shared/pipeline-nodes.ts';
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!output.toLowerCase().startsWith(path.resolve('..').toLowerCase()),'BATCH2A_OUTPUT must be a folder outside the repo');await mkdir(output,{recursive:true});
const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-pipeline-studio-')),notes=path.join(base,'notes'),settings=path.join(base,'settings'),configFile=path.join(settings,'pipeline-config.json');await mkdir(notes);
await writeFile(path.join(notes,'plan.md'),'# Synthetic plan\n\nLaunch in June.\n');
const index=await SessionIndex.open(path.join(base,'harness'));
const adapters=['codex','kiro','claude'].map(id=>({id,label:id==='codex'?'Codex':id==='kiro'?'Kiro':'Claude',safetyLabel:id==='codex'?'contained':id==='kiro'?'host-gated':'fenced',async *startTurn(){throw new Error('A live provider call is forbidden in this check.');}}));
const provider={name:'claude',async checkAvailability(){return {available:true};},async invoke(){throw new ProviderError('timeout');}};
const store=await Store.open(notes),watcher=new NoteWatcher(store);await watcher.start();
const initialSetup=defaultMachineSetup();
initialSetup.providers.codex.enabled=true;
initialSetup.providers.kiro.enabled=true;
initialSetup.setupSeen=true;initialSetup.defaultRoles=ROLE_REGISTRY.map(role=>role.id);
for(const role of ROLE_REGISTRY)initialSetup.roles[role.id]='claude';
await saveMachineSetup(process.env.AITIARCH_CONFIG_DIR,initialSetup);
const setup=createSetupHttp({dir:process.env.AITIARCH_CONFIG_DIR,project:notes,ready:async()=>true,
 providers:adapters.map(({id})=>({id,path:null,version:'99.0.0',isolation:'metadata-compatible',code:'ok',reason:'Fake metadata check passed.',roles:[],effort:id==='claude'?true:null,effortCode:id==='claude'?'help_flag_present':'not_applicable'}))});
const app=createApp({setup,store,watcher,distDir:path.resolve('dist'),provider,pipelineConfigDir:settings,council:{index,adapters,availabilityChecks:adapters.map(a=>({...a,check:async()=>({available:true,reason:null})}))},harness:{command:process.execPath,prefixArgs:[path.resolve('test/fixtures/harness-cli.mjs')],dir:index.dir}});
const saved=async()=>JSON.parse(await readFile(configFile,'utf8')).overrides;
let browser;
try{
 const url='http://127.0.0.1:'+await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const boot=async()=>{await page.goto(url+'/?debug=1');await page.waitForSelector('.cm-editor');};
 const studio=page.locator('section.studio[role=dialog]'),node=id=>studio.locator(`.studio-node[data-node="${id}"]`);
 const openStudio=async()=>{await page.getByRole('button',{name:'Pipeline Studio',exact:true}).click();await studio.waitFor();await node('ledger').waitFor();};
 const card=title=>studio.getByRole('region',{name:`Details: ${title}`});
 await boot();await openStudio();
 // 1. Every node comes from the data module, and the ids line up with the config's locked rules.
 const shown=await studio.locator('.studio-node').evaluateAll(els=>els.map(e=>e.getAttribute('data-node')));
 assert.deepEqual([...shown].sort(),PIPELINE_NODES.map(n=>n.id).sort(),'the canvas shows exactly the nodes of the data module');
 for(const rule of locked)assert(shown.includes(rule.id),`the locked rule ${rule.id} is a node`);
 assert((await studio.locator('.studio-edges path').count())>=30,'edges show the flow');
 await page.screenshot({path:path.join(output,'studio-canvas.png')});
 // 1b. Polish: groups read as groups, editable and locked differ at a glance, the Council is stitched from three labelled limbs, the main path stands out, the Ledger trunk is faint.
 assert.deepEqual(await studio.locator('.studio-region-label').allInnerTexts(),['YOUR REQUEST','GUARDS','ANSWER','CHECKS ON THE REPLY','INVESTIGATE','COUNCIL','RECORDS','AI ROLES'].map(s=>s),'one labelled lane per group, in order');
 for(const n of PIPELINE_NODES){const kind=node(n.id).locator('.studio-kind');assert.equal((await kind.innerText()).trim(),n.kind==='editable'?'Editable':'Locked',`${n.id} says what it is in words`);
  assert.equal(await node(n.id).locator('.studio-dot').count(),n.kind==='editable'?1:0,`${n.id}: the editable mark is only on editable nodes`);
  assert.equal(await node(n.id).evaluate(e=>getComputedStyle(e).borderTopStyle),n.kind==='locked'?'dashed':'solid',`${n.id}: locked is dashed, editable is solid`);}
 for(const [id,label] of [['council-claude','fenced'],['council-codex','contained'],['council-kiro','host-gated']])assert.equal((await node(id).locator('.council-badge').innerText()).trim(),label,`${id} carries its safety badge`);
 assert.equal(await studio.locator('g[data-stitch]').count(),3,'three stitched joins into the Council');assert.deepEqual(await studio.locator('g[data-stitch]').evaluateAll(g=>g.map(e=>e.getAttribute('data-limb')).sort()),['council-claude','council-codex','council-kiro']);
 assert.equal(await studio.locator('.studio-node[data-main]').count(),7,'the seven nodes of the main path are set apart');
 assert.equal(await studio.locator('.studio-edges path[data-trunk]').count(),edgesOf().filter(e=>e.to==='ledger').length,'every edge into the Ledger is part of the trunk');
 assert(await studio.locator('.studio-edges path[data-trunk]').first().evaluate(e=>parseFloat(getComputedStyle(e).strokeWidth))<=2.2,'edges are thin and calm until you point at a node');
 assert.equal(await studio.locator('.studio-edges path[data-edge]:not([data-active]):not([data-dim])').count(),await studio.locator('.studio-edges path[data-edge]').count(),'nothing is lit or dimmed before you hover');
 // 1a. Layout: spread out, readable at the default fit, edges clear of unrelated nodes, and dashed means locked only.
 const measure=async()=>page.evaluate(({nodes,margin})=>{
  const k=document.querySelector('.studio-node').getBoundingClientRect().width/document.querySelector('.studio-node').offsetWidth;
  const titles=[...document.querySelectorAll('.studio-node-title')].map(e=>parseFloat(getComputedStyle(e).fontSize)*k),meta=[...document.querySelectorAll('.studio-kind')].map(e=>parseFloat(getComputedStyle(e).fontSize)*k);
  const rects=Object.fromEntries([...document.querySelectorAll('.studio-node')].map(e=>[e.dataset.node,e.getBoundingClientRect()])),lanes=[...document.querySelectorAll('.studio-region')].map(e=>({g:e.dataset.group,r:e.getBoundingClientRect()}));
  const gap=(a,b)=>Math.max(a.left-b.right,b.left-a.right,a.top-b.bottom,b.top-a.bottom);
  const problems=[],ids=Object.keys(rects);
  for(const a of ids)for(const b of ids)if(a<b&&gap(rects[a],rects[b])<20*k)problems.push(`nodes ${a} / ${b} are too close`);
  for(const x of lanes)for(const y of lanes)if(x.g<y.g&&gap(x.r,y.r)<36*k)problems.push(`lanes ${x.g} / ${y.g} touch`);
  for(const n of nodes){const r=rects[n.id],own=lanes.find(l=>l.g===n.group).r;
   if(r.left-own.left<14*k||own.right-r.right<14*k||r.top-own.top<14*k||own.bottom-r.bottom<14*k)problems.push(`${n.id} sits against its lane border`);
   for(const l of lanes)if(l.g!==n.group&&gap(r,l.r)<20*k)problems.push(`${n.id} is next to the ${l.g} lane`);
   if(Math.abs(r.height/k-n.h)>1.5)problems.push(`${n.id} grew past its box (${Math.round(r.height/k)})`);}
  // Every drawn edge, sampled along its length, stays out of the nodes it is not part of.
  const world=Object.fromEntries(nodes.map(n=>[n.id,{x:n.x,y:n.y}]));
  for(const p of document.querySelectorAll('.studio-edges path[data-edge]')){const [from,to]=p.dataset.edge.split('>'),len=p.getTotalLength();
   for(let t=0;t<=len;t+=4){const q=p.getPointAtLength(t);for(const n of nodes){if(n.id===from||n.id===to)continue;const w=world[n.id];if(q.x>w.x-4&&q.x<w.x+184+4&&q.y>w.y-4&&q.y<w.y+n.h+4){problems.push(`edge ${p.dataset.edge} runs through ${n.id}`);break;}}}}
  return {k,minTitle:Math.min(...titles),minMeta:Math.min(...meta),problems:[...new Set(problems)]};
 },{nodes:PIPELINE_NODES.map(n=>({id:n.id,group:n.group,x:n.x,y:n.y,h:n.id==='ledger'?136:n.role==='council'?112:88})),margin:0});
 const m1440=await measure();assert.deepEqual(m1440.problems,[],'the 1440 layout is spread out and clear: '+JSON.stringify(m1440.problems));
 assert(m1440.minTitle>=12,`node text is at least 12px at the default fit at 1440 (smallest title ${m1440.minTitle.toFixed(1)}px, tags ${m1440.minMeta.toFixed(1)}px, zoom ${m1440.k.toFixed(2)})`);
 await page.screenshot({path:path.join(output,'layout-1440.png')});
 await page.setViewportSize({width:1920,height:1080});await studio.getByRole('button',{name:'Reset layout'}).click();await page.waitForTimeout(250);
 const m1920=await measure();assert.deepEqual(m1920.problems,[],'the 1920 layout is spread out and clear: '+JSON.stringify(m1920.problems));assert(m1920.minTitle>=12,`node text is at least 12px at 1920 (${m1920.minTitle.toFixed(1)}px)`);
 await page.screenshot({path:path.join(output,'layout-1920.png')});
 await page.setViewportSize({width:1440,height:900});await studio.getByRole('button',{name:'Reset layout'}).click();await page.waitForTimeout(250);
 for(const id of ['council-claude','council-codex','council-kiro']){const s=await node(id).evaluate(e=>{const c=getComputedStyle(e);return {outline:c.outlineStyle,border:c.borderTopStyle};});assert.deepEqual(s,{outline:'none',border:'solid'},`${id} has no dashed treatment: dashed always means locked`);}
 for(const e of await studio.locator('.studio-edges path[data-edge]').evaluateAll(ps=>ps.map(p=>p.getAttribute('d'))))assert(!/C/.test(e.replace(/[QA]/g,'')),'no free curves: only straight runs, rounded elbows and hops');
 assert.equal(await studio.locator('.studio-edges path[data-edge][marker-end]').count(),await studio.locator('.studio-edges path[data-edge]').count(),'every edge ends in an arrowhead');
 // 1c. Pointing at a node lights only its own links and the nodes at their ends; clicking it (or Enter) extends that to the whole path; clicking empty canvas clears it.
 const litNow=async()=>(await studio.locator('.studio-edges path[data-active]').evaluateAll(p=>p.map(e=>e.getAttribute('data-edge')))).sort();
 const directOf=id=>edgesOf().filter(e=>e.from===id||e.to===id).map(e=>e.from+'>'+e.to).sort();
 await node('permission_gate').hover();await page.waitForTimeout(300); // the dimming eases in over 140 ms
 assert.deepEqual(await litNow(),directOf('permission_gate'),'hover lights exactly the gate’s own links');
 assert(!(await litNow()).includes('token-budget>normal-answerer'),'and not the path beyond them');
 for(const id of ['redaction','permission_gate','request-queue','council','repo-attach'])assert.equal(await node(id).getAttribute('data-dim'),null,`${id} (the gate, or at the end of one of its links) is not dimmed`);
 assert.equal(await node('token-budget').getAttribute('data-dim'),'true','a node two steps away is quieted on hover');
 assert.equal(await studio.locator('.studio-card').count(),1,'one detail card while hovering');
 assert(await studio.locator('.studio-edges path[data-active]').first().evaluate(e=>parseFloat(getComputedStyle(e).strokeWidth))>=3,'the lit path is bold');
 assert(await studio.locator('.studio-edges path[data-dim]').first().evaluate(e=>+getComputedStyle(e).strokeOpacity)<.3,'the edges off the path step back');
 assert.equal(await node('exclusion_lists').getAttribute('data-dim'),'true','a node off the path is quieted');assert.equal(await node('redaction').getAttribute('data-dim'),null,'a node on the path is not');
 await page.screenshot({path:path.join(output,'studio-polish-hover-gate.png')});
 await node('ledger').hover();const ledgerLit=await studio.locator('.studio-edges path[data-trunk][data-active]').count();assert.equal(ledgerLit,await studio.locator('.studio-edges path[data-trunk]').count(),'hovering the Ledger brightens its whole trunk');
 await page.screenshot({path:path.join(output,'studio-polish-hover-ledger.png')});
 await node('council').hover();assert.equal(await studio.locator('g[data-stitch][data-active]').count(),3,'hovering the Council lights all three stitches');
 await studio.locator('.studio-region[data-group=council]').screenshot({path:path.join(output,'studio-polish-council.png')});
 await page.mouse.move(700,860);await page.waitForTimeout(150);assert.equal(await studio.locator('.studio-edges path[data-active]').count(),0,'with nothing hovered no edge is lit');
 await page.screenshot({path:path.join(output,'studio-polish-canvas.png')});
 // Click extends the lit path to everything upstream and downstream, and there is still exactly one detail card.
 await node('permission_gate').click();await page.waitForTimeout(300);
 const fullLit=await litNow();for(const e of ['redaction>permission_gate','token-budget>normal-answerer','request-intake>redaction','claim-check>chat-store'])assert(fullLit.includes(e),`clicking the gate lights the whole path: ${e}`);
 assert(fullLit.length>directOf('permission_gate').length,'more than the direct links are lit after a click');assert.equal(await node('permission_gate').getAttribute('aria-pressed'),'true');
 assert.equal(await studio.locator('.studio-card').count(),1,'one detail card with the panel open: no pinned panel plus a hover card');
 await node('permission_gate').hover();assert.equal(await studio.locator('.studio-card').count(),1,'hovering the selected node adds no second card');
 await node('redaction').hover();await page.waitForTimeout(150);assert.equal(await studio.locator('.studio-card').count(),1,'hovering another node adds none either');assert.deepEqual(await litNow(),fullLit,'and the selection keeps its path lit');
 await page.screenshot({path:path.join(output,'studio-click-path.png')});
 // Clicking empty canvas clears the selection and the path.
 await page.mouse.click(700,860);await page.waitForTimeout(300);
 assert.equal(await studio.locator('.studio-edges path[data-active]').count(),0,'clicking empty canvas clears the lit path');assert.equal(await node('permission_gate').getAttribute('aria-pressed'),'false');assert.equal(await studio.locator('.studio-card').count(),0);assert.equal(await studio.locator('[data-editor]').count(),0);
 // Keyboard: focus lights the direct links like hover; Enter extends to the full path.
 await node('redaction').focus();await page.waitForTimeout(250);assert.deepEqual(await litNow(),directOf('redaction'),'keyboard focus lights the direct links');
 await page.keyboard.press('Enter');await page.waitForTimeout(250);assert((await litNow()).length>directOf('redaction').length,'Enter extends it to the full path');
 await page.mouse.click(700,860);await page.waitForTimeout(250);assert.equal(await studio.locator('.studio-edges path[data-active]').count(),0);
 // 2. Hover and keyboard focus show the detailed card, top to bottom.
 await node('normal-answerer').hover();const c=card('Normal chat answerer');await c.waitFor();
 const text=(await c.innerText()).toLowerCase(),order=['what it does','what it receives','what it sends on','safety label','editable fields'].map(s=>text.indexOf(s)).concat(text.lastIndexOf('editable here'));
 assert(order.every(i=>i>=0)&&order.every((v,i)=>i===0||v>order[i-1]),'the card reads top to bottom: '+JSON.stringify(order));
 assert.match(await c.locator('[data-card=safety]').innerText(),/Claude\s+fenced/);
 await page.screenshot({path:path.join(output,'studio-hover.png')});
 await node('permission_gate').focus();const gate=card('Permission gate');await gate.waitFor();
 assert.equal((await gate.locator('[data-card=lock]').innerText()).trim(),locked.find(l=>l.id==='permission_gate').description,'a locked node gives the config’s own reason');
 await node('council-codex').focus();assert.match(await card('Council: Codex').locator('[data-card=safety]').innerText(),/contained/);
 // 3. A locked node shows a padlock, the reason and no editable fields.
 await node('permission_gate').click();const ed=studio.getByRole('region',{name:'Edit Permission gate'});await ed.waitFor();
 assert.equal(await ed.locator('[data-locked=true]').count(),1);assert.equal(await ed.locator('.studio-lock').count(),1,'a padlock');assert.equal(await ed.locator('input,select,textarea').count(),0,'no editable fields');
 assert.equal(await ed.getByRole('button',{name:'Save'}).count(),0,'nothing to save');await page.screenshot({path:path.join(output,'studio-locked.png')});
 await ed.getByRole('button',{name:'Close editor'}).click();await ed.waitFor({state:'detached'});
 // 3b. With the detail panel open nothing is clipped at 1280, 1440 or 1920: the header buttons are on screen and uncovered, and the panel's text stays inside it.
 const clipped=()=>page.evaluate(()=>{
  const bad=[],vw=innerWidth,bar=document.querySelector('.studio-bar'),side=document.querySelector('.studio-side');
  for(const b of document.querySelectorAll('.studio-tools button')){const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
   if(r.left<0||r.right>vw+.5)bad.push(`${b.textContent||b.getAttribute('aria-label')} is off screen`);if(!hit||!b.contains(hit))bad.push(`${b.textContent||b.getAttribute('aria-label')} is covered`);}
  if(bar.scrollWidth>bar.clientWidth+1)bad.push('the header overflows');
  if(!side)return [...bad,'no detail panel'];
  const s=side.getBoundingClientRect();if(s.right>vw+.5)bad.push('the panel is off screen');if(side.scrollWidth>side.clientWidth+1)bad.push('the panel scrolls sideways');
  for(const e of side.querySelectorAll('*')){const r=e.getBoundingClientRect();if(!r.width||!r.height||getComputedStyle(e).position==='absolute')continue;if(r.left<s.left-1||r.right>s.right+1)bad.push(`${e.tagName}.${String(e.className).slice(0,24)} sticks out of the panel`);}
  const x=side.querySelector('.studio-x');if(x){const r=x.getBoundingClientRect();if(r.right>s.right+1||r.top<s.top-1)bad.push('the close button is clipped');}
  return [...new Set(bad)];
 });
 for(const [w,h] of [[1280,800],[1440,900],[1920,1080]]){
  await page.setViewportSize({width:w,height:h});await page.waitForTimeout(200);
  await node('request-intake').click();await studio.getByRole('region',{name:'Edit Your note and mode'}).waitFor();
  assert.deepEqual(await clipped(),[],`nothing is clipped with the panel open at ${w}`);
  await page.screenshot({path:path.join(output,`panel-open-${w}.png`)});
  await studio.getByRole('button',{name:'Close editor'}).click();
  await studio.getByRole('region',{name:'Edit Your note and mode'}).waitFor({state:'detached'});
 }
 await page.setViewportSize({width:1440,height:900});await studio.getByRole('button',{name:'Reset layout'}).click();await page.waitForTimeout(250);
 // 4. Dragging moves a node and the place is remembered; Reset layout puts everything back.
 const dflt=nodeById('token-budget'),b=await node('token-budget').boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+60,b.y+b.height/2+40,{steps:8});await page.mouse.up();
 const moved=JSON.parse(await page.evaluate(()=>localStorage.getItem('aitiarch.pipeline.layout')));assert(moved['token-budget']&&Math.abs(moved['token-budget'].x-(dflt.x+60/(b.width/184)))<=3&&Math.abs(moved['token-budget'].y-(dflt.y+40/(b.width/184)))<=3,'the new place is stored: '+JSON.stringify(moved));
 assert.equal(await studio.locator('[data-editor]').count(),0,'a drag is not a click');
 await boot();await openStudio();assert.equal(await node('token-budget').evaluate(e=>e.style.left),moved['token-budget'].x+'px','the place survives a reload');
 await studio.getByRole('button',{name:'Reset layout'}).click();assert.equal(await node('token-budget').evaluate(e=>e.style.left),dflt.x+'px');assert.equal(await page.evaluate(()=>localStorage.getItem('aitiarch.pipeline.layout')),null,'the stored layout is cleared');
 await studio.getByRole('button',{name:'Zoom in'}).click();await studio.getByRole('button',{name:'Zoom out'}).click();
 // 4b. Lanes move too. A lane's header drags the lane and all its nodes together; one node moves alone and its lane grows to follow; all of it persists; Escape cancels; Reset restores.
 const posOf=async ids=>Object.fromEntries(await Promise.all(ids.map(async id=>[id,await node(id).evaluate(e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top)}))])));
 const region=g=>studio.locator(`.studio-region[data-group=${g}]`),handle=g=>region(g).locator('.studio-region-handle');
 const rectOf=loc=>loc.evaluate(e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom};});
 const laneIds=g=>PIPELINE_NODES.filter(n=>n.group===g).map(n=>n.id),guards=laneIds('guard'),others=PIPELINE_NODES.filter(n=>n.group!=='guard').map(n=>n.id),allIds=PIPELINE_NODES.map(n=>n.id);
 // Edges must still end on their own nodes, stay straight-runs only, and never be hidden behind a node they are not part of.
 const edgeProblems=()=>page.evaluate(()=>{
  const nodes=[...document.querySelectorAll('.studio-node')].map(e=>({id:e.dataset.node,x:parseFloat(e.style.left),y:parseFloat(e.style.top),w:e.offsetWidth,h:parseFloat(e.style.height)})),by=Object.fromEntries(nodes.map(n=>[n.id,n])),bad=[];
  for(const p of document.querySelectorAll('.studio-edges path[data-edge]')){
   const [from,to]=p.dataset.edge.split('>'),d=p.getAttribute('d'),len=p.getTotalLength(),end=p.getPointAtLength(len),t=by[to];
   if(/C/.test(d.replace(/[QA]/g,'')))bad.push(p.dataset.edge+' is a curve');
   if(!(Math.abs(end.x-t.x)<1.5&&end.y>=t.y&&end.y<=t.y+t.h)&&!(Math.abs(end.y-t.y)<1.5&&end.x>=t.x&&end.x<=t.x+t.w))bad.push(p.dataset.edge+' does not end on its node');
   for(let s=0;s<=len;s+=4){const q=p.getPointAtLength(s);for(const n of nodes){if(n.id===from||n.id===to)continue;if(q.x>n.x-2&&q.x<n.x+n.w+2&&q.y>n.y-2&&q.y<n.y+n.h+2){bad.push(p.dataset.edge+' is hidden behind '+n.id);break;}}}
  }
  return [...new Set(bad)];
 });
 assert.deepEqual(
  await studio.locator('.studio-region-handle').evaluateAll(handles=>handles.map(handle=>handle.dataset.group).sort()),
  [...new Set(PIPELINE_NODES.map(n=>n.group))].sort(),
  'every lane has a handle',
 );
 const before=await posOf(allIds),k=await node('redaction').evaluate(e=>e.getBoundingClientRect().width/e.offsetWidth);
 let hb=await handle('guard').boundingBox();const grab={x:hb.x+hb.width-30,y:hb.y+14};
 await page.mouse.move(grab.x,grab.y);await page.mouse.down();await page.mouse.move(grab.x+24,grab.y+70,{steps:8});
 assert.equal(await studio.locator('.studio-edges path[data-edge][marker-end]').count(),edgesOf().length,'while the lane is held every edge is still drawn, with its arrowhead');
 await page.mouse.up();await page.waitForTimeout(250);
 const after=await posOf(allIds),dx=after[guards[0]].x-before[guards[0]].x,dy=after[guards[0]].y-before[guards[0]].y;
 assert(Math.abs(dx-24/k)<=2&&Math.abs(dy-70/k)<=2,`the lane moved by the drag (${dx},${dy} for 24,70 screen px at zoom ${k.toFixed(2)})`);
 for(const id of guards)assert.deepEqual({x:after[id].x-before[id].x,y:after[id].y-before[id].y},{x:dx,y:dy},`${id} moved with its lane by the same offset (locked nodes too)`);
 for(const id of others)assert.deepEqual(after[id],before[id],`${id} in another lane did not move`);
 assert.equal(await studio.locator('[data-editor]').count(),0,'moving a lane is not a click on a node');
 assert.deepEqual(await edgeProblems(),[],'after a lane move every edge ends on its node and none is hidden behind another');
 await page.screenshot({path:path.join(output,'lane-moved.png')});
 // Escape cancels a drag in progress, and does not close the Studio.
 const resting=await posOf(guards);hb=await handle('guard').boundingBox();
 await page.mouse.move(hb.x+hb.width-30,hb.y+14);await page.mouse.down();await page.mouse.move(hb.x+hb.width-30+120,hb.y+14,{steps:6});
 assert.notDeepEqual(await posOf(guards),resting,'mid-drag the lane has moved');
 await page.keyboard.press('Escape');assert.deepEqual(await posOf(guards),resting,'Escape puts the lane back where it was');
 await page.mouse.up();assert.equal(await studio.count(),1,'Escape cancelled the drag and did not close the Studio');assert.deepEqual(await posOf(guards),resting);
 // One node moves alone; its lane-mates stay and the lane grows to contain it; its label stays on the lane.
 const lane0=await posOf(guards),rg0=await rectOf(region('guard')),tokenBox=await node('token-budget').boundingBox();
 await page.mouse.move(tokenBox.x+tokenBox.width/2,tokenBox.y+tokenBox.height/2);await page.mouse.down();await page.mouse.move(tokenBox.x+tokenBox.width/2-70,tokenBox.y+tokenBox.height/2,{steps:8});await page.mouse.up();await page.waitForTimeout(250);
 const lane1=await posOf(guards);
 for(const id of guards.filter(i=>i!=='token-budget'))assert.deepEqual(lane1[id],lane0[id],`${id} stayed put while its lane-mate was dragged`);
 assert(lane1['token-budget'].x<lane0['token-budget'].x-50,'the dragged node moved');
 const rg1=await rectOf(region('guard')),nb=await rectOf(node('token-budget'));
 assert(rg1.l<rg0.l-30&&(rg1.r-rg1.l)>(rg0.r-rg0.l)+30,'the lane grew to follow the node out past its old edge');assert(nb.l>=rg1.l-.5&&nb.r<=rg1.r+.5&&nb.t>=rg1.t&&nb.b<=rg1.b+.5,'the lane contains the dragged node');
 assert.equal((await handle('guard').innerText()).trim(),'GUARDS','the lane label stays on its lane');assert(Math.abs((await handle('guard').boundingBox()).y-(await region('guard').boundingBox()).y)<2,'at the top of the lane');
 assert.deepEqual(await edgeProblems(),[],'a node dragged over another lane still has its edges routed around the nodes in the way');
 await page.screenshot({path:path.join(output,'node-moved-lane-grown.png')});
 // Keyboard: a focused lane or node is nudged with the arrow keys.
 const k0=await posOf(guards);await handle('guard').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
 const k1=await posOf(guards);for(const id of guards)assert.deepEqual(k1[id],{x:k0[id].x+16,y:k0[id].y+16},`${id} moves with the lane on the arrow keys`);
 const l0=await posOf(['ledger']);await node('ledger').focus();await page.keyboard.press('ArrowLeft');assert.equal((await posOf(['ledger'])).ledger.x,l0.ledger.x-16,'a focused node nudges on its own');
 // Everything persists, lanes and nodes, across a reload.
 const savedPlaces=await posOf(allIds),stored=JSON.parse(await page.evaluate(()=>localStorage.getItem('aitiarch.pipeline.layout')));
 for(const id of guards)assert(stored[id],`${id} is remembered`);
 await boot();await openStudio();assert.deepEqual(await posOf(allIds),savedPlaces,'lane and node places survive a reload');
 assert.deepEqual(await edgeProblems(),[],'and the edges are routed again around them');
 // Reset layout restores both.
 await studio.getByRole('button',{name:'Reset layout'}).click();await page.waitForTimeout(250);
 const reset=await posOf(allIds);for(const n of PIPELINE_NODES)assert.deepEqual(reset[n.id],{x:n.x,y:n.y},`${n.id} is back at its default place`);
 assert.equal(await page.evaluate(()=>localStorage.getItem('aitiarch.pipeline.layout')),null,'the stored layout is cleared');
 const rgd=await rectOf(region('guard'));assert((rgd.r-rgd.l)<(rg1.r-rg1.l)-30,'and the lane is its default size again');
 // 5. A blocked reply links to the node that blocked it.
 await studio.getByRole('button',{name:'Close Pipeline Studio'}).click();await studio.waitFor({state:'detached'});
 await page.getByRole('button',{name:/^Chat/}).first().click();const panel=page.locator('#chat-panel');await panel.waitFor();
 await panel.getByRole('textbox',{name:'Message Aitiarch AI'}).fill('When is launch?');await panel.getByRole('textbox',{name:'Message Aitiarch AI'}).press('Enter');
 const review=panel.getByRole('region',{name:'What will be sent'});await review.waitFor();await review.getByRole('button',{name:'Send to Claude',exact:true}).click();
 const err=panel.locator('.chat-error');await err.waitFor();await err.locator('summary',{hasText:'Why?'}).click();
 const link=err.getByRole('button',{name:'Show on pipeline'});await link.waitFor();const target=await link.getAttribute('data-why-link');assert(nodeById(target),'the link names a real node: '+target);
 await link.click();await studio.waitFor();const lit=studio.locator('.studio-node[data-highlight]');await lit.waitFor();assert.equal(await lit.count(),1);assert.equal(await lit.getAttribute('data-node'),target,'the blocked step is highlighted');
 assert.equal(await studio.locator('[data-banner=show-on-pipeline]').innerText(),`Showing ${await lit.locator('.studio-node-title').innerText()} on the pipeline: this is the step that stopped your reply.`);await page.screenshot({path:path.join(output,'studio-show-on-pipeline.png')});
 await page.keyboard.press('Escape');await studio.waitFor({state:'detached'});await page.getByRole('button',{name:'Close chat'}).click();
 // 6. Studio and Setup edit the same machine roles through the same endpoint.
 const roleRequests=[];
 const capture=request=>roleRequests.push({url:new URL(request.url()),method:request.method()});
 page.on('request',capture);
 const openSettings=async()=>{
  await page.getByRole('button',{name:'Notes menu',exact:true}).click();
  await page.getByRole('button',{name:'AI settings'}).click();
  const dialog=page.getByRole('dialog',{name:'AI settings'});await dialog.getByRole('tab',{name:'Setup'}).click();return dialog;
 };
 const saveRole=async action=>{
  const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/setup'&&r.request().method()==='PUT'),action()]);
  assert(response.ok(),`Setup write failed: ${response.status()} ${await response.text()}`);
 };
 const editRole=async id=>{await node(id).focus();await page.keyboard.press('Enter');const editor=studio.locator('[data-editor="'+id+'"]');await editor.waitFor();return editor;};
 await openStudio();
 const roles=await studio.locator('[data-role-node]').evaluateAll(els=>els.map(el=>el.dataset.roleNode).sort());
 assert.deepEqual(roles,ROLE_REGISTRY.map(role=>role.id).sort());
 assert.equal(await node('provider-run').locator('.studio-node-title').innerText(),'Claude run');
 const ans=await editRole('normal-answerer');
 const pick=ans.getByLabel('Normal chat',{exact:true});
 assert.equal(await pick.inputValue(),'claude');
 await saveRole(()=>pick.selectOption('codex'));
 await node('provider-run').getByText('Codex run',{exact:true}).waitFor();
 assert.match(await node('normal-answerer').locator('.studio-role-chips').innerText(),/Codex.*Default[\s\S]*saved choice/);
 await page.keyboard.press('Escape');await ans.waitFor({state:'detached'});
 await page.waitForFunction(()=>document.activeElement?.getAttribute('data-node')==='normal-answerer');
 await page.keyboard.press('Escape');await studio.waitFor({state:'detached'});
 let setupDialog=await openSettings();
 const normalInSetup=setupDialog.getByLabel('Normal chat',{exact:true});assert.equal(await normalInSetup.inputValue(),'codex');
 await saveRole(()=>normalInSetup.selectOption('kiro'));
 await setupDialog.getByRole('button',{name:'Close AI settings'}).click();
 await boot();await openStudio();
 assert.equal(await (await editRole('normal-answerer')).getByLabel('Normal chat',{exact:true}).inputValue(),'kiro');
 await page.keyboard.press('Escape');
 const skill=await editRole('role-skill-diagram');
 const disabledCodex=skill.getByLabel('Skill diagrams',{exact:true}).locator('option[value="codex"]');
 assert.equal(await disabledCodex.isDisabled(),true);
 assert.match(await disabledCodex.textContent(),/Needs the Skill workflow/);
 const modelChip=skill.getByRole('button',{name:/^Model:/});
 await modelChip.click();
 const modelMenu=page.getByRole('menu',{name:'Model and effort'});
 await modelMenu.waitFor();
 const sonnet=modelMenu.getByRole('menuitemradio',{name:'sonnet',exact:true});
 await saveRole(()=>sonnet.click());
 await node('role-skill-diagram').getByText(/Claude.*Sonnet/i).waitFor();
 await page.keyboard.press('Escape');
 await studio.getByRole('button',{name:'Close Pipeline Studio'}).click();
 setupDialog=await openSettings();
 const skillInSetup=setupDialog.locator('[data-role="skill-diagram"]');
 await skillInSetup.getByRole('button',{name:/^Model: Claude.*Sonnet/i}).waitFor();
 await saveRole(()=>skillInSetup.getByRole('button',{name:'Reset to default',exact:true}).click());
 await skillInSetup.getByRole('button',{name:/^Model: Claude.*Default/}).waitFor();
 await setupDialog.getByRole('button',{name:'Close AI settings'}).click();
 await openStudio();
 for(const width of [1280,640]){
  await page.setViewportSize({width,height:900});
  const narrow=width===640;
  const narrowRole=id=>studio.locator(`.studio-list [data-node="${id}"] > button`);
  if(narrow)await narrowRole('role-invoked').scrollIntoViewIfNeeded();
  else await studio.getByRole('button',{name:'Reset layout'}).click();
  assert.deepEqual(await studio.locator('[data-role-node]').evaluateAll(els=>els.map(el=>el.dataset.roleNode).sort()),roles);
  await page.screenshot({path:path.join(output,`studio-role-nodes-${width}.png`)});
  if(narrow)await narrowRole('role-skill-diagram').press('Enter');
  const roleEditor=narrow?studio.locator('[data-editor="role-skill-diagram"]'):await editRole('investigate');
  if(narrow)await roleEditor.scrollIntoViewIfNeeded();
  const rect=await roleEditor.boundingBox();assert(rect&&rect.x>=0&&rect.x+rect.width<=width);
  await page.screenshot({path:path.join(output,`studio-role-editor-${width}.png`)});
  await page.keyboard.press('Escape');await roleEditor.waitFor({state:'detached'});
 }
 await page.setViewportSize({width:1440,height:900});
 // No inference request or external network is made by inspecting/editing machine roles.
 assert(roleRequests.some(r=>r.url.pathname==='/api/setup'&&r.method==='PUT'));
 assert(roleRequests.every(r=>r.url.origin===url&&!/\/api\/(?:chat|conversation|council|harness)\/(?:send|turn|run)$/.test(r.url.pathname)));
 page.off('request',capture);
 assert.equal(await page.evaluate(async()=>Object.hasOwn((await (await fetch('/api/pipeline-config')).json()).overrides,'normalAnswerer')),false);
 // 7. A numeric limit edits per node, keeps the other saved settings, and resets only its own node.
 await node('token-budget').click();const tb=studio.getByRole('region',{name:'Edit Token budget'});await tb.waitFor();
 await tb.locator('[data-field="chat.rollingRequestCap"]').fill('7');await tb.getByRole('button',{name:'Save'}).click();await tb.getByText('Saved.').waitFor();assert.deepEqual(await saved(),{chat:{rollingRequestCap:7}});
 // 8. A value the server refuses shows the server's own sentence and changes nothing.
 await tb.locator('[data-field="chat.tokenBudget"]').fill('99999999');await tb.getByRole('button',{name:'Save'}).click();const bad=tb.locator('[data-notice=studio-error]');await bad.waitFor();
 assert.equal((await bad.innerText()).trim(),'This value is out of range or not allowed.');assert.deepEqual(await saved(),{chat:{rollingRequestCap:7}},'a refused save changes nothing on disk');
 await tb.getByRole('button',{name:'Reset this node'}).click();await tb.getByText('This node is back to its defaults.').waitFor();await assert.rejects(readFile(configFile),{code:'ENOENT'},'resetting the last override removes the empty override file');
 assert.deepEqual(await page.evaluate(async()=>(await (await fetch('/api/pipeline-config')).json()).overrides),{},'there are no pipeline overrides after resetting the only changed node');
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await studio.waitFor({state:'detached'});
 // 9. Settings keeps its plain form, with a link to the Studio.
 // Hold its config response so this also covers the first render before settings have loaded.
 let resumeSettings;const settingsReady=new Promise(resolve=>{resumeSettings=resolve;});
 await page.route('**/api/pipeline-config',async route=>{if(route.request().method()==='GET')await settingsReady;await route.continue();});
 await page.getByRole('button',{name:'Notes menu',exact:true}).click();await page.getByRole('button',{name:'AI settings'}).click();const dialog=page.getByRole('dialog',{name:'AI settings'});await dialog.getByRole('tab',{name:'Pipeline'}).click();
 const settingsAnswerer=dialog.getByLabel('Normal chat is answered by');
 assert.equal(await settingsAnswerer.isDisabled(),true,'settings remain disabled until the config arrives');
 console.log('Settings before config: '+JSON.stringify({disabled:await settingsAnswerer.isDisabled(),value:await settingsAnswerer.inputValue()}));
 resumeSettings();
 await page.waitForFunction(()=>{const select=document.querySelector('#pipeline-answerer');return select&&!select.disabled;});
 await page.unroute('**/api/pipeline-config');
 assert.equal(await dialog.getByLabel('Normal chat is answered by').inputValue(),'claude','the plain form still reads its separate pipeline setting');await dialog.getByRole('button',{name:'Open Pipeline Studio'}).click();await studio.waitFor();assert.equal(await dialog.count(),0,'Settings closed');
 // 10. At phone width the canvas gives way to a readable list of the same nodes.
 await page.setViewportSize({width:360,height:740});await studio.locator('[data-list=true]').waitFor();
 assert.equal(await studio.locator('.studio-row').count(),PIPELINE_NODES.length,'every node is in the list');assert.equal(await studio.locator('.studio-node').count(),0);assert.equal(await studio.locator('.studio-region-handle').count(),0,'the list has no lane handles: moving lanes is a canvas feature');
 assert.equal(await studio.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'no sideways scroll at 360px');
 const row=studio.locator('[data-node="council-codex"] .studio-row');await row.scrollIntoViewIfNeeded();await row.click();const open=studio.locator('[data-node="council-codex"]');await open.getByRole('region',{name:'Details: Council: Codex'}).waitFor();assert.equal(await open.locator('input[data-field="council.caps.codex.amount"]').count(),1);
 assert.equal(await studio.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'an opened row still fits at 360px');await page.screenshot({path:path.join(output,'studio-list-360.png')});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,nodes:shown.length,screenshots:output}));
}finally{await browser?.close();await app.close();watcher.stop();console.log('Cleanup target:',base);await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
