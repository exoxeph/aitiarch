import {describe,expect,it} from 'vitest';
import {finishReply,parseClaimsBlock,normalizeQuote,usesContext} from '../server/chat/reply.ts';
import {createHash} from 'node:crypto';

// The final part of the output gate: the reply is plain Markdown that must end with one claims block. Claims are checked one by one
// against the sources the request carried; a reply that leans on the sources without citing them is flagged, never hidden or retried.
const hash=(t:string)=>createHash('sha256').update(t).digest('hex');
const NOTE='# Picnic plan\n\nThe budget is 40 dollars. The venue is the library on Main Street. Volunteers bring their own food and the event starts at noon on the second Saturday of June.\n';
const sources={note:NOTE,selection:'',decisions:[{id:'T1',text:'An earlier AI reply about parking near the library.'}]};
const ANALYSIS='The plan says the venue is the library on Main Street and volunteers bring their own food, with the event starting at noon on the second Saturday of June. The budget is 40 dollars, which looks tight for a library booking.';
const finish=(text:string,s=sources)=>finishReply({text,legacy:false},s,hash);

describe('parseClaimsBlock',()=>{
 it('reads a final block of claims and strips it from the body',()=>{
  const r=parseClaimsBlock('Body text.\n\n<claims>[{"source":"N1","quote":"The budget is 40 dollars."}]</claims>\n');
  expect(r).toEqual({body:'Body text.',block:'claims',claims:[{source:'N1',quote:'The budget is 40 dollars.'}]});
 });
 it.each(['opinion','question_back','no_context_used'])('reads a "none" block with the reason %s',reason=>{
  expect(parseClaimsBlock(`A view.\n<claims>{"none":"${reason}"}</claims>`)).toEqual({body:'A view.',block:'none',reason});
 });
 it('a missing block is reported as missing, and the whole text is the body',()=>{expect(parseClaimsBlock('Just prose.')).toEqual({body:'Just prose.',block:'missing'});});
 it.each([
  ['broken JSON','Body.\n<claims>[{"source":"N1",</claims>'],
  ['a reason that is not on the list','Body.\n<claims>{"none":"because"}</claims>'],
  ['an empty list with no reason','Body.\n<claims>[]</claims>'],
 ])('a block with %s is malformed, and the body is kept',(_n,text)=>{expect(parseClaimsBlock(text)).toEqual({body:'Body.',block:'malformed'});});
 it('a block in the middle of the reply is body text, not the claims block',()=>{
  const text='Before.\n<claims>{"none":"opinion"}</claims>\nAfter.';expect(parseClaimsBlock(text)).toEqual({body:text,block:'missing'});
 });
 it('a block inside a code fence at the end is still read',()=>{
  expect(parseClaimsBlock('Body.\n```\n<claims>{"none":"opinion"}</claims>\n```')).toEqual({body:'Body.',block:'none',reason:'opinion'});
 });
 it('a code block that shows the delimiter does not end the reply',()=>{
  const text='Use this tag:\n```xml\n<claims>example</claims>\n```\nThen continue.\n<claims>{"none":"no_context_used"}</claims>';
  expect(parseClaimsBlock(text)).toEqual({body:'Use this tag:\n```xml\n<claims>example</claims>\n```\nThen continue.',block:'none',reason:'no_context_used'});
 });
});
describe('normalizeQuote',()=>{
 it('ignores whitespace and markdown emphasis, code marks, links, headings and list markers',()=>{
  expect(normalizeQuote('**The  budget**\nis `40` [dollars](x.md)')).toBe(normalizeQuote('The budget is 40 dollars'));
  expect(normalizeQuote('# Picnic plan')).toBe('Picnic plan');expect(normalizeQuote('- one\n- two')).toBe('one two');
  expect(normalizeQuote('“quoted” it’s')).toBe('"quoted" it\'s');
 });
});
describe('finishReply',()=>{
 it('a grounded reply with claims: each claim is found, stored with its source and hash',()=>{
  const r=finish('The budget is small.\n<claims>[{"source":"N1","quote":"The **budget** is 40 dollars."},{"source":"T1","quote":"parking near the library"}]</claims>');
  expect(r.body).toBe('The budget is small.');expect(r.citation).toBeUndefined();
  expect(r.claims).toEqual([{sourceId:'N1',source:'note',quote:'The **budget** is 40 dollars.',status:'found',sourceHash:hash(NOTE)},{sourceId:'T1',source:'thread',quote:'parking near the library',status:'found',sourceHash:hash(sources.decisions[0].text)}]);
 });
 it('a grounded reply with no claims block is flagged as using the note without citations',()=>{
  const r=finish(ANALYSIS);expect(r.body).toBe(ANALYSIS);expect(r.claims).toEqual([]);expect(r.citation).toBe('uncited_overlap');
 });
 it('"none" while the reply overlaps distinctively with the note is flagged',()=>{
  const r=finish(ANALYSIS+'\n<claims>{"none":"no_context_used"}</claims>');expect(r.noCitation).toBe('no_context_used');expect(r.citation).toBe('uncited_overlap');
 });
 it('a legitimate "none" for a question back is not flagged, even when the question repeats a few words of the note',()=>{
  const r=finish('What makes you sure the budget is 40 dollars and not 60?\n<claims>{"none":"question_back"}</claims>');
  expect(r.body).toBe('What makes you sure the budget is 40 dollars and not 60?');expect(r.noCitation).toBe('question_back');expect(r.citation).toBeUndefined();
 });
 it('a claim whose quote is not in its source is marked "not_found" and the reply is kept',()=>{
  const r=finish('Two points.\n<claims>[{"source":"N1","quote":"The venue is the library"},{"source":"N1","quote":"The budget is 90 dollars"}]</claims>');
  expect(r.body).toBe('Two points.');expect(r.claims.map(c=>c.status)).toEqual(['found','not_found']);expect(r.claims[1]).not.toHaveProperty('sourceHash');
 });
 it('a claim naming a source the request did not carry is not found; one with an invalid id is dropped',()=>{
  const r=finish('X.\n<claims>[{"source":"O3","quote":"anything"},{"source":"../x","quote":"y"},{"source":"note","quote":"The venue is the library"}]</claims>');
  expect(r.claims.map(c=>[c.sourceId,c.status])).toEqual([['O3','not_found'],['N1','found']]);
 });
 it('a malformed block keeps the body and is flagged, as uncited when the reply leans on the note',()=>{
  expect(finish('Short.\n<claims>[oops</claims>').citation).toBe('malformed_block');
  expect(finish(ANALYSIS+'\n<claims>[oops</claims>').citation).toBe('uncited_overlap');
 });
 it('no block and no overlap says the reply did not say whether it used the note',()=>{expect(finish('A general remark about planning.').citation).toBe('missing_block');});
 it('with no sources at all, a missing block is not flagged: there was nothing to cite',()=>{
  expect(finish('A general remark.',{note:'',selection:'',decisions:[]}).citation).toBeUndefined();
 });
 it('the selection is source S1',()=>{
  const r=finish('Y.\n<claims>[{"source":"S1","quote":"second Saturday"}]</claims>',{...sources,selection:'the second Saturday of June'});expect(r.claims[0]).toMatchObject({sourceId:'S1',source:'selection',status:'found'});
 });
 it('an older-format JSON reply is still accepted: its answer is the body and its claims are checked the same way',()=>{
  const r=finishReply({text:'{"answer":"Yes.","claims":[{"sourceId":"N1","quote":"The venue is the library"}]}',legacy:false},sources,hash);
  expect(r.body).toBe('Yes.');expect(r.claims[0]).toMatchObject({sourceId:'N1',status:'found'});
 });
 it('a structured result from an adapted provider is checked the same way',()=>{
  const r=finishReply({text:'Yes.',legacy:true,claims:[{sourceId:'N1',quote:'not there'}]},sources,hash);expect(r.claims[0].status).toBe('not_found');
 });
 it('claim quotes are redacted before they are checked and kept, because the sources were redacted before they were sent',()=>{
  const redact=(t:string)=>t.replace(/password=\S+/g,'password=[SECRET]');
  const r=finishReply({text:'X.\n<claims>[{"source":"N1","quote":"password=hunter22 here"}]</claims>',legacy:false},{...sources,note:'Use password=[SECRET] here.'},hash,redact);
  expect(r.claims[0]).toMatchObject({quote:'password=[SECRET] here',status:'found'});
 });
 it('JSON-shaped replies with the wrong fields still fail closed',()=>{
  expect(()=>finish('{"answer":"x","claims":[],"takeaway":"do this"}')).toThrow();
 });
});
describe('usesContext',()=>{
 it('needs several distinctive shared phrases in a reply of some length, or one long verbatim run',()=>{
  expect(usesContext(ANALYSIS,[NOTE])).toBe(true);
  expect(usesContext('Volunteers bring their own food and the event starts at noon.',[NOTE])).toBe(true);
  expect(usesContext('The budget is 40 dollars, you say?',[NOTE])).toBe(false);
  expect(usesContext('It is what it is and that is that, on the one hand and on the other hand.',['It is what it is and that is that, on the one hand and on the other hand, a common phrase.'])).toBe(false);
 });
});
