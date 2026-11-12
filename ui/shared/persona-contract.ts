// What each thinking-partner mode asks of a reply, as a structural check (docs/chat-redesign.md, section f). Heuristics on the reply's body only (the claims
// block is already removed, and Grill me ignores claims): a rhetorical "?" can pass. The result says what is wrong and never changes, hides or retries the reply.
// Pure and shared: the server stores it on the message, the page words it.
import {PERSONAS,isPersona,type PersonaMode} from './persona.ts';

export const CONTRACT_ISSUES=['no_question','several_questions','too_many_sentences','too_long','has_list_or_table_or_code','no_final_question'] as const;
export type ContractIssue=typeof CONTRACT_ISSUES[number];
export interface Contract {mode:PersonaMode;met:boolean;issues:ContractIssue[]}
/** Which problems each mode can have. */
const ALLOWED:Record<PersonaMode,readonly ContractIssue[]>={
 grill:['no_question','several_questions','too_many_sentences','too_long','has_list_or_table_or_code'],
 plan:['several_questions','no_final_question'],
 explain:['too_long'],
};
export const GRILL_MAX_WORDS=60,GRILL_MAX_SENTENCES=2,ANSWER_WORD_CAP=120,EXPLAIN_MAX_WORDS=ANSWER_WORD_CAP*2;

const wordCount=(s:string)=>s.trim().split(/\s+/).filter(Boolean).length;
const withoutCode=(s:string)=>s.replace(/```[\s\S]*?(```|$)/g,' ').replace(/`[^`\n]*`/g,' ');
/** The text up to the last mark that is not just Markdown or a closing bracket or quote. */
const trimmedEnd=(s:string)=>s.replace(/[\s*_~)\]}"'\u201d\u2019]+$/,'');
const endsWithQuestion=(s:string)=>trimmedEnd(s).endsWith('?');
const questions=(s:string)=>(withoutCode(s).match(/\?/g)??[]).length;
const hasStructure=(s:string)=>/```/.test(s)||/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/m.test(s)||/^[ \t]*#{1,6}[ \t]+\S/m.test(s)||/^[ \t]*\|.*\|[ \t]*$/m.test(s);
const sentenceCount=(s:string)=>(withoutCode(s).match(/[.!?](?=\s|$)/g)??[]).length;

export function checkContract(mode:PersonaMode,body:string):Contract{
 const found=new Set<ContractIssue>();
 if(mode==='grill'){
  const text=body.trim();
  if(!endsWithQuestion(text))found.add('no_question');
  if(questions(text)>1)found.add('several_questions');
  if(sentenceCount(text)>GRILL_MAX_SENTENCES)found.add('too_many_sentences');
  if(wordCount(text)>GRILL_MAX_WORDS)found.add('too_long');
  if(hasStructure(text))found.add('has_list_or_table_or_code');
 }else if(mode==='plan'){
  const paragraphs=withoutCode(body).split(/\n[ \t]*\n/).map(p=>p.trim()).filter(Boolean),last=paragraphs.at(-1)??'';
  if(!endsWithQuestion(last))found.add('no_final_question');
  else if(questions(last)>1)found.add('several_questions');
 }else if(wordCount(body)>EXPLAIN_MAX_WORDS)found.add('too_long');
 const issues=CONTRACT_ISSUES.filter(i=>found.has(i));
 return {mode,met:issues.length===0,issues};
}

/** Exact shape, and only problems that belong to the mode; `met` agrees with `issues`. */
export function validContract(v:unknown):v is Contract{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const c=v as Contract;if(Object.keys(c).sort().join()!=='issues,met,mode'||!isPersona(c.mode)||typeof c.met!=='boolean'||!Array.isArray(c.issues))return false;
 const allowed=ALLOWED[c.mode];
 return c.issues.every((i,n)=>allowed.includes(i)&&(n===0||CONTRACT_ISSUES.indexOf(c.issues[n-1])<CONTRACT_ISSUES.indexOf(i)))&&c.met===(c.issues.length===0);
}

/** One plain sentence for a broken contract, naming the mode; null when it was met. */
export function contractText(c:Contract):string|null{
 if(c.met||!c.issues.length)return null;
 const clause:Record<ContractIssue,string>={
  no_question:'does not end with a question',several_questions:'has more than one question',too_many_sentences:'has more than two sentences',
  too_long:c.mode==='explain'?'is longer than twice the length limit':`is longer than ${GRILL_MAX_WORDS} words`,has_list_or_table_or_code:'has a list, table, heading or code block',no_final_question:'does not end with a question',
 };
 const list=c.issues.map(i=>clause[i]),joined=list.length<2?list.join(''):`${list.slice(0,-1).join(', ')} and ${list.at(-1)}`;
 return `Not what ${PERSONAS[c.mode].label} asks for: it ${joined}.`;
}
