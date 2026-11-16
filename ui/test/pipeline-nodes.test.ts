import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {DEFAULT_PIPELINE_CONFIG,applyOverrides,locked} from '../shared/pipeline-config.ts';
import {WHY_RULE_IDS,whyRule} from '../shared/chat-why.ts';
import {FIELDS,PIPELINE_NODES,edgesOf,fieldsOf,lockReason,nodeById,numberAt,safetyLabelOf} from '../shared/pipeline-nodes.ts';

const nested=(key:string,value:number)=>key.split('.').reduceRight<unknown>((inner,k)=>({[k]:inner}),value) as Record<string,unknown>;
const ids=PIPELINE_NODES.map(x=>x.id);

it('has unique node ids and every edge joins two real nodes',()=>{
 expect(new Set(ids).size).toBe(ids.length);
 for(const e of edgesOf()){expect(ids,`edge from ${e.from}`).toContain(e.from);expect(ids,`edge to ${e.to}`).toContain(e.to);expect(e.from).not.toBe(e.to);}
});
it('has a node for every locked rule in the pipeline config, with the same id',()=>{
 for(const rule of locked)expect(nodeById(rule.id)?.kind,rule.id).toBe('locked');
});
it('has a node for every node id the failure explainer can report, except an internal error',()=>{
 const reported=new Set(WHY_RULE_IDS.map(id=>whyRule(id)?.nodeId).filter((x):x is string=>!!x&&x!=='internal'));
 for(const id of reported)expect(nodeById(id),`explainer node ${id}`).toBeDefined();
});
it('gives every locked node a reason and no editable fields, and every editable node something to edit',()=>{
 for(const node of PIPELINE_NODES){
  if(node.kind==='locked'){expect(node.fields,node.id).toEqual([]);expect(node.answerer,node.id).toBeUndefined();expect(lockReason(node).length,node.id).toBeGreaterThan(20);}
  else{expect(node.fields.length>0||node.answerer===true,node.id).toBe(true);expect(lockReason(node)).toBe('');}
  for(const k of node.fields)expect(FIELDS[k],`${node.id} field ${k}`).toBeDefined();
  expect(node.does.length&&node.receives.length&&node.sendsOn.length,node.id).toBeTruthy();
 }
});
it('binds each setting to exactly one node and only to settings that exist in the config',()=>{
 const seen=new Map<string,string>();
 for(const node of PIPELINE_NODES)for(const k of node.fields){expect(seen.has(k),`${k} is on ${seen.get(k)} and ${node.id}`).toBe(false);seen.set(k,node.id);expect(typeof numberAt(DEFAULT_PIPELINE_CONFIG,k),k).toBe('number');}
});
it('describes only code that exists: every source file is in the repo',()=>{
 const root=path.resolve(__dirname,'..');
 for(const node of PIPELINE_NODES)for(const s of node.source)expect(existsSync(path.join(root,s)),`${node.id} -> ${s}`).toBe(true);
});
it('holds its ranges to the real validator: the ends are accepted, just outside is refused',()=>{
 for(const f of Object.values(FIELDS)){
  expect(applyOverrides(nested(f.key,f.max)).ok,`${f.key} max`).toBe(true);
  expect(applyOverrides(nested(f.key,f.min)).ok,`${f.key} min`).toBe(true);
  expect(applyOverrides(nested(f.key,f.max+(f.fractional?f.max*.01:1))).ok,`${f.key} above max`).toBe(false);
  const below=f.fractional?f.min/2:f.min-1;
  if(below>=0&&below!==f.min&&!(f.min===0))expect(applyOverrides(nested(f.key,below)).ok,`${f.key} below min`).toBe(false);
 }
});
it('takes safety labels from the config, so a provider node cannot drift from it',()=>{
 expect(safetyLabelOf(nodeById('council-codex')!)).toBe(DEFAULT_PIPELINE_CONFIG.safetyLabels.codex);
 expect(safetyLabelOf(nodeById('council-kiro')!)).toBe('host-gated');
 expect(safetyLabelOf(nodeById('ledger')!)).toBeNull();
 expect(fieldsOf(nodeById('council-codex')!).map(f=>f.unit)).toEqual(['tokens','ms']);
});

// Every test runs with the app's config folder pointing at a temp folder: nothing here may touch the real one.
let configDir='',savedConfigDir:string|undefined;
beforeAll(()=>{savedConfigDir=process.env.AITIARCH_CONFIG_DIR;configDir=mkdtempSync(path.join(os.tmpdir(),'aitiarch-nodes-'));process.env.AITIARCH_CONFIG_DIR=configDir;});
afterAll(()=>{if(savedConfigDir===undefined)delete process.env.AITIARCH_CONFIG_DIR;else process.env.AITIARCH_CONFIG_DIR=savedConfigDir;rmSync(configDir,{recursive:true,force:true});});
const words=(id:string)=>{const n=nodeById(id)!;return [n.does,n.receives,n.sendsOn,n.lockedReason??''].join(' ');};

it('the tripwire is not wired to the ledger and its text says nothing about it: it only reports to the chat',()=>{
 const trip=nodeById('tripwire')!;
 expect(trip.edges).toEqual([]);
 expect(edgesOf().some(e=>e.from==='tripwire'&&e.to==='ledger')).toBe(false);
 expect(words('tripwire')).not.toMatch(/ledger/i);
 expect(nodeById('ledger')!.receives).not.toMatch(/tripwire/i);
 expect(nodeById('investigate')!.edges).toEqual(expect.arrayContaining(['tripwire','ledger'])); // the Investigate turn itself still records its own ledger event
});
it('the corrected wording stays true to the code it was checked against',()=>{
 const has=(id:string,...needles:(string|RegExp)[])=>{for(const x of needles)expect(words(id),`${id}: ${x}`).toMatch(x instanceof RegExp?x:new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));};
 has('redaction','best effort','Repo files are covered by exclusion lists, not masking','again just before it leaves','at send');
 expect(words('redaction')).not.toMatch(/^Removes secrets/);
 has('permission_gate','when you send','after the busy check');
 has('request-queue','one request per chat at a time','at most two chats at once','refused as busy','nothing waits in line','20 reviews','50 one-off chats','busy check, approval check');
 has('session-intake','other projects','Only Claude','in memory only');
 expect(words('session-intake')).not.toMatch(/outside this project is refused/);
 has('chat-history','Claude keeps its own session','fresh session','changed answerer','earlier questions and answers');
 expect(FIELDS['chat.sources'].help).not.toMatch(/selection/i);
 has('ledger','whether it finished','which notes were read','never records what was asked or answered');
 expect(nodeById('ledger')!.lockedReason).toMatch(/no setting/);expect(nodeById('ledger')!.lockedReason).toMatch(/new events/);
 has('council','one to three','cannot be verified','discarded','Council history, not the ledger');
 has('council-codex','three blocked code attempts','not a no-read guarantee','0.167.0','keeps the answer and revokes the approval');
 has('council-kiro','any tool attempt','tool list must be empty','keeps the answer and revokes the approval');
 has('council-claude','after the turn','only hard stop','discarded');
 for(const id of ['council-claude','council-codex','council-kiro'])has(id,'after the turn','only hard stop');
 has('diagram-route','12 files','outside the folder','hooks or denials','changed folder','withheld diagram','passed to Claude');
 has('fence_flags','diagram fence');
 expect(nodeById('fence_flags')!.source).toContain('server/providers/claude-arguments.ts');
 expect(nodeById('fence_flags')!.source).not.toContain('server/providers/tool-less.ts'); // that file is the Codex and Kiro adapter
 has('run-control','start after the Claude process starts','provider failure','per-provider deadlines','Investigate uses its own timer');
 has('exclusion_lists','named like secrets or keys','contents of copied files are not scanned');
 has('provider_contracts','does not confine','selection','editor line','earlier exchanges');
 has('hard_prompt_rules','asked of the model, not enforced','allowed fields','claim marks');
 has('chat-store','Keep on disk privately','/chat/','.gitignore');
});
