import {describe,expect,it} from 'vitest';
import {prepareRequest,type Request} from '../server/providers/index.ts';
import {composeInstruction,HARD_RULES,SKILL_HEADING,type SkillBlock} from '../shared/instruction.ts';
import {CHAT_FORMAT,CHAT_HARD_RULES,CHAT_INVARIANTS,chatMode} from '../server/chat/request.ts';
import {personaInstruction} from '../shared/persona.ts';

// A node's persona mode and attached skills reach the prompt through prepareRequest, and change nothing when absent.
const base:Request={id:'r1',action:'ask',question:'What is weak here?',selection:'',note:'A short note.',decisions:[],turns:[]};
const skills:SkillBlock={text:'## Skill: demo\nUse a table when it helps.',loaded:[{id:'a1',name:'demo',chars:40,tokens:10,truncated:false,files:['SKILL.md']}],skipped:[],truncated:false};

describe('without a persona or skills',()=>{
 it('the instruction is exactly what it was',()=>{
  const plain=prepareRequest(base).instruction;
  expect(prepareRequest({...base,persona:undefined,skills:undefined}).instruction).toBe(plain);
  expect(plain).not.toContain(SKILL_HEADING);expect(plain).not.toContain('Thinking-partner mode');
 });
});

describe('with a persona mode',()=>{
 it('adds the mode after the existing instruction, for Ask and Think',()=>{
  for(const extra of [{},{action:'think' as const,question:''}]){
   const plain=prepareRequest({...base,...extra}).instruction,withMode=prepareRequest({...base,...extra,persona:'grill'}).instruction;
   expect(withMode.startsWith(plain)).toBe(true);expect(withMode).toContain(personaInstruction('grill'));
  }
  // Chat builds its own prompt (server/chat/request.ts): the mode is the answer style, right after what the data is, and before the format.
  const chat=prepareRequest({...base,chat:true,persona:'grill'}).instruction;
  expect(chat.startsWith(CHAT_INVARIANTS)).toBe(true);expect(chat).toContain(chatMode('grill'));expect(chat.indexOf(chatMode('grill'))).toBeLessThan(chat.indexOf(CHAT_FORMAT));
 });
});

describe('with attached skills',()=>{
 it('puts the skill text in the instruction under its heading and ends with the hard rules',()=>{
  const t=prepareRequest({...base,persona:'explain',skills}).instruction;
  expect(t).toContain(SKILL_HEADING);expect(t).toContain('Use a table when it helps.');expect(t.endsWith(HARD_RULES)).toBe(true);
  expect(t).toBe(composeInstruction({base:prepareRequest(base).instruction,persona:personaInstruction('explain'),skillBlock:skills}));
 });
 it('keeps skill text out of the data the model is told to treat as untrusted',()=>{
  const packet=prepareRequest({...base,skills});
  expect(JSON.stringify(packet.data)).not.toContain('Use a table when it helps.');
 });
 it('works in chat too, and still puts the rules after the skill (the chat has its own rules, always last)',()=>{
  const t=prepareRequest({...base,chat:true,skills}).instruction;
  expect(t.indexOf(SKILL_HEADING)).toBeLessThan(t.indexOf(CHAT_HARD_RULES));expect(t.endsWith(CHAT_HARD_RULES)).toBe(true);
  expect(prepareRequest({...base,chat:true}).instruction.endsWith(CHAT_HARD_RULES),'and also when no skill is attached').toBe(true);
 });
});
