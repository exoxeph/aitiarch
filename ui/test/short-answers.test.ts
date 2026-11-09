import {expect,it} from 'vitest';
import {prepareRequest} from '../server/providers/index.ts';
import {measureAnswerLength} from '../shared/answer-length.ts';
import {validateProductResult} from '../server/product-validation.ts';
for(const kind of ['think','ask','followup'] as const)it(`${kind} requests ask for short plain answers, distinguishing note facts from hypotheses without internal jargon`,()=>{
 const instruction=prepareRequest({id:'short-test',action:kind==='think'?'think':'ask',question:kind==='followup'?'Synthetic follow-up':'',selection:'Synthetic',note:'Synthetic',decisions:[],turns:[]}).instruction;
 expect(instruction).toContain('at most about 120 words');expect(instruction).toContain('plain language');expect(instruction).toContain('first sentence');
 expect(instruction).toContain('The first sentence is the answer itself');expect(instruction).toContain('in one short clause at most, and only when the question is about the note');expect(instruction).toContain('Never claim the note says or contains something you did not see');expect(instruction).toContain('as a hypothesis');expect(instruction).toContain('Do not mention decision IDs, source IDs, contracts or validation in the answer text');
 expect(instruction).toContain('The field is named exactly "quote"');
});
it('answer length is metadata only; a 150-word answer still passes the unchanged validator',()=>{
 const answer=Array.from({length:150},()=> 'Synthetic').join(' '),measurement=measureAnswerLength(answer);
 expect(measurement).toEqual({answerCharacters:answer.length,answerWords:150});
 expect(()=>validateProductResult({id:'test',provider:'claude',model:null,answer,claims:[],usage:null},'test',{note:'Synthetic',decisions:[]},v=>v,()=> 'hash')).not.toThrow();
 expect(measureAnswerLength(undefined)).toEqual({answerCharacters:null,answerWords:null});
});
