import {describe,expect,it} from 'vitest';
import {PERSONAS,PERSONA_ORDER,PERSONA_ALWAYS,defaultPersona,isPersona,personaInstruction} from '../shared/persona.ts';

// The thinking-partner persona (2.5): three modes in our own words, and rules that hold in every mode.
describe('the three modes',()=>{
 it('are Plan with me, Grill me and Explain, each with a one-line description for the switch',()=>{
  expect(PERSONA_ORDER).toEqual(['plan','grill','explain']);
  expect(PERSONA_ORDER.map(m=>PERSONAS[m].label)).toEqual(['Plan with me','Grill me','Explain']);
  for(const m of PERSONA_ORDER){const d=PERSONAS[m].oneLine;expect(d.length).toBeGreaterThan(20);expect(d.length).toBeLessThanOrEqual(90);expect(d).not.toMatch(/\n/);}
 });
 it('default per node: Plan with me for Think and Chat, Explain for Ask and Visualize',()=>{
  expect(defaultPersona('think')).toBe('plan');expect(defaultPersona('chat')).toBe('plan');
  expect(defaultPersona('ask')).toBe('explain');expect(defaultPersona('visualize')).toBe('explain');
 });
 it('recognizes only the three names',()=>{
  for(const m of PERSONA_ORDER)expect(isPersona(m)).toBe(true);
  for(const bad of ['Plan','grill ','',null,undefined,5,'decide'])expect(isPersona(bad)).toBe(false);
 });
});

describe('what each mode asks of the model',()=>{
 it('Plan with me: asks for your approach first when you are deciding, lays out options with trade-offs, ends with one question',()=>{
  const t=PERSONAS.plan.instruction;
  expect(t).toMatch(/ask for their own approach/i);expect(t).toMatch(/trade-?offs/i);expect(t).toMatch(/end with (exactly )?one question/i);
 });
 it('Grill me: one probing question at a time until the idea holds up',()=>{
  const t=PERSONAS.grill.instruction;
  expect(t).toMatch(/one (probing )?question at a time/i);expect(t).toMatch(/until the idea holds up/i);expect(t).toMatch(/do not answer your own question/i);
 });
 it('Grill me: exactly one question and nothing else, no summary, no options, no answering for the user',()=>{
  const t=PERSONAS.grill.instruction;
  expect(t).toMatch(/exactly one probing question/i);expect(t).toMatch(/weakest assumption/i);expect(t).toMatch(/and nothing else/i);
  expect(t).toMatch(/do not summari[sz]e the note, list options, or answer the question for the user/i);expect(t).toMatch(/stop and wait/i);
 });
 it('Explain: the answer first, then only what helps',()=>{
  const t=PERSONAS.explain.instruction;expect(t).toMatch(/answer first/i);expect(t).toMatch(/only what helps/i);
 });
 it('every mode stays inside the length already set, and is written for text only (no tools)',()=>{
  for(const m of PERSONA_ORDER){const t=PERSONAS[m].instruction;expect(t).toMatch(/length (limit|cap)s? (already )?(set|given)/i);expect(t.length).toBeLessThan(900);}
 });
});

describe('what holds in every mode',()=>{
 it('never decides for you, never writes a takeaway, labels hypotheses, and does not claim unseen text',()=>{
  expect(PERSONA_ALWAYS).toMatch(/never decide[s]? for the user/i);
  expect(PERSONA_ALWAYS).toMatch(/never (write|suggest|pre-fill)[^.]*takeaway/i);
  expect(PERSONA_ALWAYS).toMatch(/label (a |any )?hypothes[ie]s/i);
  expect(PERSONA_ALWAYS).toMatch(/never claim[^.]*(note|text)[^.]*(without|did not) (seeing|see)/i);
  expect(PERSONA_ALWAYS).toMatch(/length caps/i);
 });
 it('the always-on rules do not tell Grill me or Explain to list options (only Plan with me does)',()=>{
  expect(PERSONA_ALWAYS).not.toMatch(/show the options/i);expect(PERSONA_ALWAYS).toMatch(/where a choice is theirs, leave it with them/i);
  expect(PERSONAS.plan.instruction).toMatch(/options/i);expect(PERSONAS.grill.instruction).not.toMatch(/show the options/i);expect(PERSONAS.explain.instruction).not.toMatch(/options/i);
 });
 it('a mode says it takes priority over the default answer style, and that the required JSON format still applies',()=>{
  for(const m of PERSONA_ORDER){const t=personaInstruction(m);expect(t).toMatch(/takes priority over the answer-style guidance above/i);expect(t).toMatch(/required JSON format still applies/i);}
 });
 it('personaInstruction names the mode and always carries the rules',()=>{
  for(const m of PERSONA_ORDER){const t=personaInstruction(m);expect(t).toContain(PERSONAS[m].label);expect(t).toContain(PERSONAS[m].instruction);expect(t).toContain(PERSONA_ALWAYS);}
 });
 it('does not drag a mode into the TDD half of the skills it learned from',()=>{
  for(const m of PERSONA_ORDER)expect(personaInstruction(m)).not.toMatch(/failing test|red.?green|write the test first/i);
 });
});
