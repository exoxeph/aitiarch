// Observation only. This never changes acceptance or edits an answer.
export function measureAnswerLength(answer:unknown):{answerCharacters:number|null;answerWords:number|null}{
 if(typeof answer!=='string')return {answerCharacters:null,answerWords:null};
 return {answerCharacters:answer.length,answerWords:answer.trim()?answer.trim().split(/\s+/u).length:0};
}
