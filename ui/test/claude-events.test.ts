import {describe,expect,it} from 'vitest';
import {normalizeClaudeEvent,IsolationMonitor,isolationPasses} from '../server/providers/claude-events.ts';

// One description of the Claude CLI's stream events for chat. Only what can do harm is fatal: a tool, hook or permission event, a session
// that starts with tools, MCP servers or plugins, or a second session. Anything else the CLI adds later is named by its type words and counted.
const ids={uuid:'11111111-1111-4111-8111-111111111111',session_id:'22222222-2222-4222-8222-222222222222'};
const init={type:'system',subtype:'init',tools:[],mcp_servers:[],plugins:[]};
const ev=(event:unknown)=>({type:'stream_event',event,...ids});
describe('normalizeClaudeEvent',()=>{
 it.each([
  ['status',{type:'system',subtype:'status',status:'requesting',...ids}],
  ['status with no status word',{type:'system',subtype:'status'}],
  ['status with an extra payload',{type:'system',subtype:'status',status:'Requesting now!',payload:'x'}],
  ['thinking tokens',{type:'system',subtype:'thinking_tokens',estimated_tokens:12,...ids}],
  ['rate limit',{type:'rate_limit_event',rate_limit_info:{status:'allowed'},...ids}],
  ['assistant snapshot',{type:'assistant',message:{content:[{type:'text',text:'x'}]}}],
 ])('%s is progress',(_n,e)=>{expect(normalizeClaudeEvent(e).kind).toBe('progress');});
 it('reads text deltas and drops thinking, whatever extra plain or nested fields they carry',()=>{
  expect(normalizeClaudeEvent(ev({type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Hi'}}))).toEqual({kind:'text',text:'Hi'});
  const thinking=normalizeClaudeEvent(ev({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'SECRET',signature:'s',index:0,more:{a:[1]},'C:\\odd':'y'}}));
  expect(thinking.kind).toBe('thinking');expect(JSON.stringify(thinking)).not.toContain('SECRET');
  expect(normalizeClaudeEvent(ev({type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig',encoding:'base64'}})).kind).toBe('thinking');
 });
 it('reads init registries and the final result',()=>{
  expect(normalizeClaudeEvent({...init,tools:['Read']})).toEqual({kind:'init',tools:1,mcpServers:0,plugins:0});
  expect(normalizeClaudeEvent({type:'result',subtype:'success',result:'Done.',model:'m-1',usage:{input_tokens:3}})).toMatchObject({kind:'result',ok:true,text:'Done.',model:'m-1'});
  expect(normalizeClaudeEvent({type:'result',subtype:'error_during_execution',is_error:true})).toMatchObject({kind:'result',ok:false});
 });
 it.each([
  ['a tool_use block',ev({type:'content_block_start',index:0,content_block:{type:'tool_use',name:'Write'}}),'tool'],
  ['a tool input delta',ev({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{}'}}),'tool'],
  ['a nested tool_result',{type:'user',message:{content:[{type:'tool_result',content:'x'}]}},'tool'],
  ['a stop for tool use',ev({type:'message_delta',delta:{stop_reason:'tool_use'}}),'tool'],
  ['a hook event',{type:'system',subtype:'hook_started'},'hook'],
  ['a permission denial',{type:'result',subtype:'success',result:'x',permission_denials:[{tool:'Write'}]},'permission'],
 ])('%s is danger',(_n,e,what)=>{expect(normalizeClaudeEvent(e)).toEqual({kind:'danger',what});});
 it('names an unknown event by its type words only, never its contents',()=>{
  expect(normalizeClaudeEvent({type:'system',subtype:'brand_new_kind',note:'synthetic secret'})).toEqual({kind:'unknown',name:'system/brand_new_kind'});
  expect(normalizeClaudeEvent({type:'Odd Type!'})).toEqual({kind:'unknown',name:'?'});
  expect(normalizeClaudeEvent(ev({type:'content_block_delta',index:0,delta:{type:'citations_delta'}}))).toEqual({kind:'unknown',name:'stream_event/content_block_delta/citations_delta'});
 });
 it('treats an event too deep to inspect as danger, because a tool event could hide in it',()=>{
  let deep:any={type:'x'};for(let n=0;n<40;n++)deep={type:'wrap',inner:deep};
  expect(normalizeClaudeEvent(deep)).toEqual({kind:'danger',what:'too_deep'});
 });
});
describe('IsolationMonitor',()=>{
 it('passes one clean session with unknown events, and counts them',()=>{
  const m=new IsolationMonitor();for(const e of [init,{type:'system',subtype:'brand_new_kind'},{type:'unexpected'}])m.observe(normalizeClaudeEvent(e));
  expect(m.initialized).toBe(true);expect(m.unknown).toEqual(['system/brand_new_kind','unexpected']);
 });
 it.each([
  ['tools in the session',[{...init,tools:['Read']}]],
  ['MCP servers in the session',[{...init,mcp_servers:['x']}]],
  ['plugins in the session',[{...init,plugins:['x']}]],
  ['a second session',[init,init]],
  ['a hook event',[init,{type:'system',subtype:'hook_response'}]],
  ['a tool event',[init,ev({type:'content_block_start',index:0,content_block:{type:'tool_use'}})]],
 ])('fails on %s',(_n,events)=>{const m=new IsolationMonitor();expect(()=>{for(const e of events)m.observe(normalizeClaudeEvent(e));}).toThrow();});
 it('isolationPasses needs exactly one clean session and no danger',()=>{
  expect(isolationPasses([init,{type:'unexpected'},{type:'result',subtype:'success',result:'x'}])).toBe(true);
  expect(isolationPasses([{type:'result',subtype:'success',result:'x'}])).toBe(false);
  expect(isolationPasses([init,{type:'system',subtype:'hook_started'}])).toBe(false);
 });
});
