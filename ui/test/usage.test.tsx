import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {afterEach,expect,it,vi} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {UsageLogs,claudeUsageRecord} from '../server/providers/usage.ts';
import {PlanVault} from '../server/providers/plan-vault.ts';
import {createProvider} from '../server/providers/index.ts';
import {UsageView} from '../src/UsagePanel.tsx';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-usage-test-'));roots.push(root);return {root,logs:new UsageLogs({claude:path.join(root,'claude'),plan:path.join(root,'plan'),since:Date.now()-1000})};}
const request={id:'usage-test',action:'think' as const,question:'PRIVATE_QUESTION_SENTINEL',selection:'Synthetic',note:'Synthetic',decisions:[],turns:[]};
it('adapters without an explicit usage writer never open host usage storage, including verified fake CLIs',async()=>{
 const {root}=await fixture(),spy=vi.spyOn(UsageLogs.prototype,'write'),script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url));
 const provider=createProvider({provider:'claude',command:process.execPath,contract:'claude-canary-2.1.205',prefixArgs:[script,'verified-thinking-valid',path.join(root,'record'),'claude'],failureLog:{write:async()=>{}}});
 await provider.invoke(request);expect(spy).not.toHaveBeenCalled();
});
it('logs successful fake Claude usage privately, without text, and never logs a failed call',async()=>{
 const {root,logs}=await fixture(),script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url));
 const provider=(scenario:string)=>createProvider({provider:'claude',command:process.execPath,contract:'claude-canary-2.1.205',prefixArgs:[script,scenario,path.join(root,'record'),'claude'],failureLog:{write:async()=>{}},usageLog:logs});
 await provider('verified-thinking-valid').invoke(request);
 await expect(provider('verified-empty-result').invoke(request)).rejects.toMatchObject({code:'invalid_response'});
 const text=await readFile(path.join(root,'claude','usage.jsonl'),'utf8'),rows=text.trim().split('\n').map(line=>JSON.parse(line));
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({provider:'claude',input:12,output:8});expect(rows[0].wallMs).toBeGreaterThan(0);
 expect(rows[0]).toMatchObject({answerCharacters:'Answer for usage-test'.length,answerWords:3});
 expect(text).not.toMatch(/PRIVATE_QUESTION|Answer for|selection|claims|prompt|session_id|uuid/);
});
it('combines only numeric usage, counts this session separately, reads the normal cap, and marks unreported counters',async()=>{
 const {root,logs}=await fixture();
 await logs.write(claudeUsageRecord({inputTokens:11,outputTokens:7,cachedTokens:3},25));
 const vault=new PlanVault(path.join(root,'plan'));await vault.append('usage.jsonl',{at:new Date(0).toISOString(),provider:'chatgpt-plan',input:100,cached:20,output:40,reasoning:10});await vault.write({limit:5},'cap.json');
 const summary=await logs.summary();expect(summary.hourlyCap).toBe(5);
 expect(summary.providers[0]).toMatchObject({provider:'claude',calls:1,callsThisSession:1,input:11,cached:3,output:7,wallMs:25});
 expect(summary.providers[1]).toMatchObject({provider:'chatgpt-plan',calls:1,callsThisSession:0,input:100,cached:20,output:40,reasoning:10});
 await logs.write(claudeUsageRecord(null,4));expect((await logs.summary()).providers[0].unreportedCalls).toBe(1);
 const html=renderToStaticMarkup(<UsageView summary={summary}/>);expect(html).toContain('My AI calls and tokens');expect(html).toContain('Calls this session');expect(html).toContain('https://chatgpt.com/settings/usage');expect(html).toContain('5');expect(html).not.toMatch(/\$|remaining requests/i);
});
it('refuses usage storage inside a notebook or repo',async()=>{
 const {root}=await fixture();await expect(new UsageLogs({claude:path.join(root,'.aitiarch'),plan:path.join(root,'plan')}).write(claudeUsageRecord(null,1))).rejects.toThrow();
 await expect(new UsageLogs({claude:fileURLToPath(new URL('../',import.meta.url)),plan:path.join(root,'plan')}).write(claudeUsageRecord(null,1))).rejects.toThrow();
});
it('shows per-chat usage and budget without a remaining-requests or price estimate',()=>{
 const html=renderToStaticMarkup(<UsageView summary={{since:new Date().toISOString(),hourlyCap:2,providers:[],chats:[{note:'fixture.md',calls:2,input:30,cached:4,output:12,unreportedCalls:0,tokenBudget:50000,spent:46,reserved:0,rollingRequestCap:12,windowMinutes:60}]}}/>);
 expect(html).toContain('Chat budgets');expect(html).toContain('one per note');expect(html).toContain('46');expect(html).toContain('50000');expect(html).not.toMatch(/\$|remaining requests/i);
});
it('lists a conversation on its own row, under the note it started on, next to the note\'s one-off chat',()=>{
 const row=(extra:Record<string,unknown>)=>({note:'fixture.md',calls:1,input:10,cached:0,output:5,unreportedCalls:0,tokenBudget:50000,spent:15,reserved:0,rollingRequestCap:12,windowMinutes:60,...extra});
 const html=renderToStaticMarkup(<UsageView summary={{since:new Date().toISOString(),hourlyCap:2,providers:[],chats:[row({}),row({session:'e50d1e40-4aaa-47b0-923c-3a17de41469d',label:'Storage plan',calls:3,spent:900})]}}/>);
 expect(html).toContain('<th>fixture.md</th>');expect(html).toContain('<th>fixture.md · Storage plan</th>');expect(html).toContain('900');expect(html.match(/<tr>/g)!.length).toBeGreaterThanOrEqual(3);
});
