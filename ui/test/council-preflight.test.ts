import {expect,it} from 'vitest';import {readFile,mkdtemp,rm,access} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createCliAdapter,kiroSessionCheck,turnPrompt} from '../server/providers/tool-less.ts';import {runTurn,type TurnInput} from '../server/providers/turn.ts';
const shape=JSON.parse(await readFile(new URL('./fixtures/kiro-v2-handshake.json',import.meta.url),'utf8'));
const input:TurnInput={question:'What month?',notes:[{id:'N1',label:'Plan',text:'Launch in June.'}],deadlineMs:3000,maxOutputBytes:20000,cap:{unit:'tokens',amount:2000}};
it('defines the existing claims contract in the standalone tool-less prompt',()=>{expect(turnPrompt(input)).toContain('<claims>[{"source":"N1","quote":');});
it('preserves a Codex runtime error before later completion and budget events',async()=>{const a=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),'runtime-error']});const r=await runTurn(a,input);expect(r.status).toBe('unavailable');expect(r.code).toBe('codex_runtime_error');expect(r.message).toContain('Code Mode');});
it('uses distinct removed Kiro homes for consecutive turns',async()=>{const homes:string[]=[];const a=createCliAdapter({id:'kiro',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),'kiro'],kiroHomeParent:path.join(os.tmpdir(),'aitiarch-council-fake-homes'),onHome:p=>homes.push(p)});for(let i=0;i<2;i++){expect((await runTurn(a,{...input,cap:{unit:'credits',amount:1}})).status).toBe('ok');await expect(access(homes[i])).rejects.toThrow();}expect(homes.length).toBe(2);expect(homes[0]).not.toBe(homes[1]);});
it('rejects an extra file in the fresh home and removes it',async()=>{let home='';const a=createCliAdapter({id:'kiro',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),'kiro'],kiroHomeParent:path.join(os.tmpdir(),'aitiarch-council-fake-homes'),onHome:async p=>{home=p;await (await import('node:fs/promises')).writeFile(path.join(p,'extra'),'synthetic');}});expect((await runTurn(a,input)).code).toBe('kiro_profile_not_clean');await expect(access(home)).rejects.toThrow();});
it('reads the captured V2 notification inventory, not invented session result fields',()=>{expect(kiroSessionCheck(shape.session,shape.inventory.params)).toEqual({ok:true});});
it.each([
 ['agent missing',s=>{delete s.session.modes;},'kiro_agent_missing'],
 ['agent mismatch',s=>{s.session.modes.currentModeId='other';},'kiro_agent_mismatch'],
 ['MCP nonempty',s=>{s.inventory.params.mcpServers=[{name:'synthetic'}];},'kiro_mcp_nonempty'],
 ['tools nonempty',s=>{s.inventory.params.tools=[{name:'read'}];},'kiro_tools_nonempty'],
 ['data unreadable',s=>{s.inventory.params=null;},'kiro_inventory_unreadable'],
 ['tools unreadable',s=>{delete s.inventory.params.tools;},'kiro_tools_unreadable'],
 ['MCP unreadable',s=>{s.inventory.params.mcpServers='bad';},'kiro_mcp_unreadable'],
 ['session mismatch',s=>{s.inventory.params.sessionId='other';},'kiro_inventory_session_mismatch'],
] as [string,(s:any)=>void,string][])('fails closed: %s',(_name,mutate,code)=>{const s=structuredClone(shape);mutate(s);let result;expect(()=>{result=kiroSessionCheck(s.session,s.inventory.params);}).not.toThrow();expect(result).toMatchObject({ok:false,code});});
it('Codex preflight caches only success for the executable and recipe',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-council-preflight-')),record=path.join(root,'metadata.jsonl');
 try{const adapter=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),'codex',record]});for(let i=0;i<2;i++)expect((await runTurn(adapter,input)).status).toBe('ok');const steps=(await readFile(record,'utf8')).trim().split('\n').map(l=>JSON.parse(l));expect(steps).toEqual([['--version'],['exec','--help']]);}
 finally{console.info('CLEANUP TARGET:',root);await rm(root,{recursive:true,force:true});}
});
it('Codex help timeout identifies its step and removes the stalled subprocess scratch',async()=>{
 let scratch='';const adapter=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),'help-hang'],startupTimeoutMs:250,onScratch:p=>{scratch=p;}});
 const r=await runTurn(adapter,input);expect(r.status).toBe('unavailable');expect(r.code).toBe('codex_help_timeout');expect(r.message).toContain('exec --help');await expect(access(scratch)).rejects.toThrow();
});
it.each(['kiro','kiro-after'])('verifies actual notification/session ordering %s',async mode=>{
 const a=createCliAdapter({id:'kiro',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),mode],kiroHomeParent:path.join(os.tmpdir(),'aitiarch-council-fake-homes')});
 expect((await runTurn(a,{...input,cap:{unit:'credits',amount:1}})).status).toBe('ok');
});
it.each([['kiro-tools','kiro_tools_nonempty'],['kiro-mcp','kiro_mcp_nonempty'],['kiro-agent','kiro_agent_mismatch'],['kiro-unreadable','kiro_inventory_unreadable']])('blocks prompting on captured bad inventory %s',async(mode,code)=>{
 const a=createCliAdapter({id:'kiro',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/council-cli.mjs'),mode],kiroHomeParent:path.join(os.tmpdir(),'aitiarch-council-fake-homes')});
 const r=await runTurn(a,input);expect(r.status).toBe('unavailable');expect(r.code).toBe(code);expect(r.message).toContain('observed');expect(r.answer).toBe('');
});
