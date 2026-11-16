import {afterEach,expect,it} from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {DEFAULT_PIPELINE_CONFIG as defaults,setActivePipelineConfig,validPipelineConfig} from '../shared/pipeline-config.ts';
import {validateOverrides} from '../server/pipeline-config-store.ts';
import {createCliAdapter} from '../server/providers/tool-less.ts';
import type {Request} from '../server/providers/index.ts';
import type {TurnAdapter} from '../server/providers/turn.ts';
import {normalChatTurn,validateNormalChatResult} from '../server/chat/normal-answerer.ts';

afterEach(()=>setActivePipelineConfig(null));
const request:Request={id:'normal-one',action:'ask',chat:true,question:'When is launch?',selection:'',note:'Launch in June.',decisions:[],turns:[]};
const choose=(normalAnswerer:'claude'|'codex'|'kiro')=>setActivePipelineConfig({...structuredClone(defaults),normalAnswerer});
it('defaults to Claude; PUT accepts only the one new provider selector and keeps roles, labels and locked ids closed',()=>{
 expect(defaults.normalAnswerer).toBe('claude');
 for(const normalAnswerer of ['claude','codex','kiro'])expect(validateOverrides({normalAnswerer}).effective.normalAnswerer).toBe(normalAnswerer);
 for(const normalAnswerer of ['chatgpt-plan','unknown',null,1])expect(validPipelineConfig({...defaults,normalAnswerer})).toBe(false);
 for(const overrides of [{roles:{chat:'codex'}},{safetyLabels:{codex:'fenced'}},{permission_gate:true},{extra:true}])expect(()=>validateOverrides(overrides)).toThrow();
});
it.each(['codex','kiro'] as const)('%s runs through the unchanged Council fake CLI adapter and validates as the selected provider',async id=>{
 choose(id);
 const adapter=createCliAdapter({id,command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),id],kiroHomeParent:path.join(os.tmpdir(),'aitiarch-normal-answerer-homes')});
 const result=await normalChatTurn(request,[adapter]);
 expect(result.status).toBe('ok');expect(result.provider).toBe(id);
 expect(validateNormalChatResult({id:request.id,provider:id,model:null,answer:result.answer,claims:[],usage:null},request).body).toBe('June.');
 expect(result.usage[0].unit).toBe(id==='codex'?'tokens':'credits');
});
it('rejects a mismatched provider and preserves every other product validator',()=>{
 choose('kiro');const result={id:request.id,provider:'codex' as const,model:null,answer:'June.',claims:[],usage:null};
 expect(()=>validateNormalChatResult(result,request)).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'result_provider'})}));
 expect(()=>validateNormalChatResult({...result,provider:'kiro',answer:''},request)).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'answer_empty'})}));
 expect(()=>validateNormalChatResult({...result,provider:'kiro',claims:[{sourceId:'N1',quote:'Not in this note'}]},request)).toThrow(expect.objectContaining({record:expect.objectContaining({rule:'claim_quote_exact'})}));
});
it('unavailable selected adapter does not run a different provider',async()=>{
 choose('codex');let called=false;
 const other:TurnAdapter={id:'kiro',label:'Kiro',safetyLabel:'host-gated',async *startTurn(){called=true;yield {type:'complete',answer:'must not run'};}};
 expect(await normalChatTurn(request,[other])).toMatchObject({provider:'codex',status:'unavailable',code:'provider-unavailable'});expect(called).toBe(false);
});
it('Claude stays on the original runner rather than entering the new transport',async()=>{
 await expect(normalChatTurn(request,[])).rejects.toThrow('Claude uses the existing chat runner');
});
it('notes-only bridge refuses transcript source ids before starting any adapter',async()=>{
 choose('codex');await expect(normalChatTurn({...request,decisions:[{id:'C1',text:'synthetic session'}]},[])).rejects.toThrow('Notes-only context required');
});
