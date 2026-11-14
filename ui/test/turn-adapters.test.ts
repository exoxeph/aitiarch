import {expect,it} from 'vitest';
import {runTurn,type TurnAdapter,type TurnInput} from '../server/providers/turn.ts';
import {createCliAdapter,CODEX_FLAGS,permissionDenial,kiroSessionVerified} from '../server/providers/tool-less.ts';
import {claudeTurn} from '../server/providers/claude-turn.ts';import {createProvider,type Provider} from '../server/providers/index.ts';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';
import path from 'node:path';import {access} from 'node:fs/promises';
const input:TurnInput={question:'What month?',notes:[{id:'N1',label:'Plan',text:'Launch in June.'}],deadlineMs:1500,maxOutputBytes:20000,cap:{unit:'tokens',amount:2000}};
const fake=(events:any[],hang=false):TurnAdapter=>({id:'test',label:'Test',safetyLabel:'contained',async *startTurn(_i,signal){for(const e of events)yield e;if(hang)await new Promise(r=>signal.addEventListener('abort',r,{once:true}));}});
it('latches refusal even when a later event completes successfully',async()=>{expect((await runTurn(fake([{type:'refusal',code:'filtered'},{type:'complete',answer:'yes'}]),input)).status).toBe('refused');});
it('Claude bridge latches a protocol refusal before a successful final result',async()=>{
 const provider:Provider={checkAvailability:async()=>({available:true}),invoke:async(_request,options)=>{options?.onStreamEvent?.({type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'refusal'}}});return {id:'synthetic',provider:'claude',model:null,answer:'June.',claims:[],usage:null};}};
 const adapter=claudeTurn(provider);
 expect((await runTurn(adapter,input)).status).toBe('refused');
});
it('rejects an empty or missing completion',async()=>{for(const es of [[{type:'complete',answer:' '}],[{type:'delta',text:'partial'}]])expect((await runTurn(fake(es),input)).status).toBe('error');});
it('deadline aborts a stalled adapter',async()=>{expect((await runTurn(fake([],true),{...input,deadlineMs:30})).status).toBe('timeout');});
it('rejects excess output and usage above the approved cap',async()=>{expect((await runTurn(fake([{type:'complete',answer:'x'.repeat(100)}]),{...input,maxOutputBytes:20})).code).toBe('output_limit');expect((await runTurn(fake([{type:'usage',usage:{unit:'tokens',amount:2001,afterTurn:true}},{type:'complete',answer:'ok'}]),input)).code).toBe('budget');});
const fixture=path.resolve('test/fixtures/council-cli.mjs');
function cli(id:'codex'|'kiro',mode:string){return createCliAdapter({id,command:process.execPath,prefixArgs:[fixture,mode],kiroHomeParent:path.resolve(process.env.TEMP??'/tmp','aitiarch-council-fake-homes'),onScratch:p=>scratches.push(p)});}
const scratches:string[]=[];
it.each([['codex','tokens'],['kiro','credits']] as const)('preserves %s after-turn over-cap answers with a warning',async(id,unit)=>{const adapter={...fake([{type:'complete',answer:'Accepted'},{type:'usage',usage:{unit,amount:3,afterTurn:true}}]),id};const r=await runTurn(adapter,{...input,cap:{unit,amount:2}});expect(r.status).toBe('ok');expect(r.answer).toBe('Accepted');expect(r.overCap).toBe(true);expect(r.warning).toContain('re-approve');expect((await runTurn({...adapter,startTurn:fake([{type:'usage',usage:{unit,amount:3,afterTurn:false}},{type:'complete',answer:'no'}]).startTurn},{...input,cap:{unit,amount:2}})).code).toBe('budget');});
it('Claude USD remains a hard cap even on final usage',async()=>{expect((await runTurn({...fake([{type:'complete',answer:'no'},{type:'usage',usage:{unit:'usd',amount:3,afterTurn:true}}]),id:'claude'},{...input,cap:{unit:'usd',amount:2}})).code).toBe('budget');});
it('Codex pinned recipe includes the spike hardening',()=>{expect(CODEX_FLAGS).toContain('--ignore-rules');expect(CODEX_FLAGS).toContain('code_mode_host');expect(CODEX_FLAGS).toContain('--ephemeral');});
it('Codex fake CLI completes and removes an empty scratch',async()=>{const r=await runTurn(cli('codex','codex'),input);expect(r.status).toBe('ok');expect(r.answer).toBe('June.');await expect(access(scratches.at(-1)!)).rejects.toThrow();});
it.each(['command_execution','mcp_tool_call','file_change','apply_patch'])('Codex kills forbidden %s item',async kind=>{const r=await runTurn(cli('codex',kind),input);expect(r.code).toBe('tool_attempt');expect(r.status).toBe('error');});
it('Kiro verified empty inventory allows answer and counts the final credit snapshot once',async()=>{const r=await runTurn(cli('kiro','kiro'),{...input,cap:{unit:'credits',amount:1}});expect(r.status).toBe('ok');expect(r.usage).toEqual([{unit:'credits',amount:0.02,afterTurn:true}]);});
it('Kiro rejects EVERY permission request and fails the turn',async()=>{const r=await runTurn(cli('kiro','permission'),input);expect(r.code).toBe('tool_attempt');expect(r.status).toBe('error');});
it('Kiro refuses to prompt without verified agent, tools and MCP inventory',async()=>{expect((await runTurn(cli('kiro','no-inventory'),input)).status).toBe('unavailable');});
it('Kiro refusal metadata rejects a later end_turn',async()=>{expect((await runTurn(cli('kiro','refusal'),input)).status).toBe('refused');});
it('Kiro ignores replay before session load has completed',async()=>{const r=await runTurn(cli('kiro','replay'),input);expect(r.answer).toBe('June.');});
it('permission denial never chooses an allow option',()=>{expect(permissionDenial([{optionId:'allow_once',kind:'allow_once'},{optionId:'no',kind:'reject_once'}])).toEqual({outcome:'selected',optionId:'no'});expect(permissionDenial([{optionId:'yes',kind:'allow_once'}])).toEqual({outcome:'cancelled'});});
it.each([{modes:{currentModeId:'other',availableModes:[]},tools:[],mcpServers:[]},{modes:{currentModeId:'aitiarch-tool-less',availableModes:[{id:'aitiarch-tool-less'}]},tools:['read'],mcpServers:[]},{modes:{currentModeId:'aitiarch-tool-less',availableModes:[{id:'aitiarch-tool-less'}]},tools:[],mcpServers:['server']}])('self check rejects nonempty or incorrect inventories',s=>{expect(kiroSessionVerified(s)).toBe(false);});
it('Claude adapter reuses isolated fake CLI flags, streaming and usage',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-council-claude-')),record=path.join(root,'record.json');
 try{const provider=createProvider({provider:'claude',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/provider-cli.mjs'),'verified-chat-stream',record,'claude'],contract:'claude-canary-2.1.205',failureLog:{write:async()=>{}}});
  const r=await runTurn(claudeTurn(provider),{...input,deadlineMs:5000});expect(r.status).toBe('ok');expect(r.usage).toContainEqual({unit:'tokens',amount:30,afterTurn:true});
  // This fixture exits nonzero unless tools="", safe mode and the complete isolation flags are present.
  const trace=await readFile(record+'.metadata','utf8');expect(trace).toContain('--help');expect(trace).toContain('--version');
 }finally{console.info('CLEANUP TARGET:',root);await rm(root,{recursive:true,force:true});}
});
it('CLI deadline kills a process tree before cleanup',async()=>{const r=await runTurn(cli('codex','hang'),{...input,deadlineMs:100});expect(r.status).toBe('timeout');await expect(access(scratches.at(-1)!)).rejects.toThrow();});
it('deadline also kills a stalled capability subprocess before cleanup',async()=>{const started=performance.now();const r=await runTurn(cli('codex','metadata-hang'),{...input,deadlineMs:100});expect(r.status).toBe('timeout');expect(performance.now()-started).toBeLessThan(1500);await expect(access(scratches.at(-1)!)).rejects.toThrow();});
