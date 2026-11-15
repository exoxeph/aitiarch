import {expect,it} from 'vitest';
import {clampChatWidth,isSheet,loadChatWidth,loadPinned,saveChatWidth,savePinned,CHAT_MIN_WIDTH} from '../src/chat/chat-layout.ts';
const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},m};};
it('chat layout: defaults to about 45% of the window and keeps the limits',()=>{
 expect(clampChatWidth(null,1440)).toBe(648);
 expect(clampChatWidth(null,800)).toBe(CHAT_MIN_WIDTH);
 expect(clampChatWidth(5000,1440)).toBe(1296);
 expect(clampChatWidth(100,1440)).toBe(CHAT_MIN_WIDTH);
 expect(clampChatWidth(700,1440)).toBe(700);
 });
it('chat layout: is a full-width sheet only below 700 px',()=>{expect(isSheet(699)).toBe(true);expect(isSheet(700)).toBe(false);});
it('chat layout: remembers the pin and the width, and ignores bad stored values',()=>{
 const s=memory();expect(loadPinned(s)).toBe(false);savePinned(true,s);expect(loadPinned(s)).toBe(true);savePinned(false,s);expect(loadPinned(s)).toBe(false);
 expect(loadChatWidth(s)).toBe(null);saveChatWidth(612.4,s);expect(loadChatWidth(s)).toBe(612);
 s.setItem('aitiarch.chat.width','abc');expect(loadChatWidth(s)).toBe(null);s.setItem('aitiarch.chat.width','12');expect(loadChatWidth(s)).toBe(null);
 });
it('chat layout: never throws when storage is blocked',()=>{
 const blocked={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}};
 expect(loadPinned(blocked)).toBe(false);expect(loadChatWidth(blocked)).toBe(null);expect(()=>{savePinned(true,blocked);saveChatWidth(500,blocked);}).not.toThrow();
 });
