import {it,expect,afterEach} from 'vitest';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {InvestigatorCli,nonPromptingSupported} from '../server/investigator/cli.ts';import {InvestigatorStream} from '../server/investigator/stream.ts';
import {minimalEnvironment} from '../server/investigator/lookups.ts';
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0)){console.log('CLEANUP TARGET fixture',r);await rm(r,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
const init={type:'system',subtype:'init',tools:[],mcp_servers:[],plugins:[]};
it('requires an actual permission-mode help declaration supporting dontAsk, not a mention elsewhere',()=>{
 expect(nonPromptingSupported('  --permission-mode <mode> choices: manual, dontAsk\n  --verbose More output')).toBe(true);
 for(const help of ['  --other mentions --permission-mode dontAsk','  --permission-mode <mode> choices: manual\n  --other dontAsk'])expect(nonPromptingSupported(help)).toBe(false);
});
it('event ordering fails closed, emitted thinking is labeled, secrets split across chunks are redacted before forwarding',()=>{
 const events:any[]=[],s=new InvestigatorStream(e=>events.push(e));const stream=[init,{type:'stream_event',event:{type:'message_start'}},{type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}}},{type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'A synthetic thought.'}}},{type:'stream_event',event:{type:'content_block_stop',index:0}},{type:'stream_event',event:{type:'content_block_start',index:1,content_block:{type:'text',text:''}}},{type:'stream_event',event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Bearer '}}},{type:'stream_event',event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'z'.repeat(32)}}},{type:'stream_event',event:{type:'content_block_stop',index:1}},{type:'stream_event',event:{type:'message_stop'}},{type:'result',subtype:'success',result:'Bearer '+'z'.repeat(32),usage:{input_tokens:2,output_tokens:3}}];
 for(const e of stream)s.push(Buffer.from(JSON.stringify(e)+'\n'));expect(events.some(e=>e.type==='text')).toBe(false);expect(events.filter(e=>e.type==='status')).toHaveLength(stream.length);s.finish();expect(events).toContainEqual({type:'thinking',text:'A synthetic thought.',label:'CLI-emitted thinking'});expect(JSON.stringify(events)).not.toContain('z'.repeat(32));
 expect(events.filter(e=>e.type==='status').map(e=>e.name)).toEqual(stream.map(e=>e.type==='stream_event'&&'event'in e?'stream_event_'+e.event?.type:e.type==='system'?'system_'+e.subtype:e.type));
 expect(events.findIndex(e=>e.type==='thinking')).toBeLessThan(events.findIndex(e=>e.type==='text'));
 for(const e of [{...init,tools:['Read']},{type:'system',subtype:'hook_started'},{type:'stream_event',event:{type:'content_block_start',content_block:{type:'tool_use'}}},{type:'unexpected'}])expect(()=>new InvestigatorStream(()=>{}).push(Buffer.from(JSON.stringify(e)+'\n'))).toThrow();
});
it('fake CLI uses tools-off flags and minimal env; no keys inherited; codex disabled without a spawn',async()=>{
 expect(()=>new InvestigatorCli({command:'C:/fake/claude.exe',fixture:true})).toThrow();
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m4-cli-'));roots.push(root);const record=path.join(root,'record.json');
 const cli=new InvestigatorCli({command:process.execPath,prefixArgs:[fileURLToPath(new URL('./fixtures/investigator-cli.mjs',import.meta.url)),record,'ok'],fixture:true});
 process.env.AITIARCH_TEST_API_KEY='synthetic-secret';try{expect(minimalEnvironment()).not.toHaveProperty('AITIARCH_TEST_API_KEY');const r=await cli.run({role:'mother',input:{question:'Synthetic'},cwd:root,maxTokens:1000,timeoutMs:1000,turns:12,emit:()=>{},signal:new AbortController().signal});expect(JSON.parse(r.text)).toEqual({say:'Synthetic.',delegate:[]});const captured=JSON.parse(await readFile(record,'utf8'));expect(captured.args).toContain('--safe-mode');expect(captured.args[captured.args.indexOf('--tools')+1]).toBe('');expect(captured.env).not.toHaveProperty('AITIARCH_TEST_API_KEY');}finally{delete process.env.AITIARCH_TEST_API_KEY;}
});
it('cancel and deadline kill the entire fake CLI process tree, await exit, never accept partial output',async()=>{
 for(const cancel of [true,false]){const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m4-kill-'));roots.push(root);const record=path.join(root,'record.json'),cli=new InvestigatorCli({command:process.execPath,prefixArgs:[fileURLToPath(new URL('./fixtures/investigator-cli.mjs',import.meta.url)),record,'hang'],fixture:true}),controller=new AbortController();
 const pending=cli.run({role:'agent',input:{},cwd:root,maxTokens:1000,timeoutMs:cancel?5000:600,turns:12,emit:()=>{},signal:controller.signal});
 if(cancel){for(let i=0;i<100;i++){try{await readFile(record);break;}catch{await new Promise(r=>setTimeout(r,10));}}controller.abort();}
 await expect(pending).rejects.toMatchObject({code:cancel?'cancelled':'timeout'});const data=JSON.parse(await readFile(record,'utf8'));for(const pid of [data.pid,data.childPid])expect(()=>process.kill(pid,0)).toThrow();
 }
},15000);
