import {describe,expect,it} from 'vitest';
import {readConversationChoice,writeConversationChoice} from '../src/chat/conversation-choice.ts';

// The chosen conversation is kept for this browser tab, as an id and a note path only, so a reload comes back to it.
const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>void m.set(k,v),removeItem:(k:string)=>void m.delete(k),m};};
const ID='e50d1e40-4aaa-47b0-923c-3a17de41469d';
describe('the chosen conversation',()=>{
 it('is written as an id and a note path, read back, and cleared',()=>{
  const s=memory();expect(readConversationChoice(s)).toBeNull();
  writeConversationChoice({id:ID,home:'notes/plan.md'},s);expect(JSON.parse([...s.m.values()][0])).toEqual({id:ID,home:'notes/plan.md'});
  expect(readConversationChoice(s)).toEqual({id:ID,home:'notes/plan.md'});
  writeConversationChoice(null,s);expect(readConversationChoice(s)).toBeNull();expect(s.m.size).toBe(0);
 });
 it('ignores anything that is not an id and a plain note path',()=>{
  for(const bad of ['','not json','null','[]','{"id":"x","home":"a.md"}',`{"id":"${ID}"}`,`{"id":"${ID}","home":""}`,`{"id":"${ID}","home":"a\\u0000b.md"}`,`{"id":"${ID}","home":"${'x'.repeat(401)}"}`,`{"id":1,"home":"a.md"}`]){
   const s=memory();s.setItem('aitiarch.chat.conversation',bad);expect(readConversationChoice(s),bad).toBeNull();
  }
 });
 it('is not thrown by storage that is off or full',()=>{
  const broken={getItem:()=>{throw new Error('off');},setItem:()=>{throw new Error('full');},removeItem:()=>{throw new Error('off');}};
  expect(readConversationChoice(broken)).toBeNull();expect(()=>writeConversationChoice({id:ID,home:'a.md'},broken)).not.toThrow();expect(()=>writeConversationChoice(null,broken)).not.toThrow();
 });
});
