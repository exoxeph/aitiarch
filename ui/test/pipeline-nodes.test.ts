import {existsSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
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
