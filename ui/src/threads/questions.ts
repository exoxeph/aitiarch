// Page-lifetime memory only. Never serialized, logged or copied to UI state/ink.
const questions=new Map<string,string>();
export const rememberQuestion=(note:string,id:string,text:string)=>{questions.set(note+'\0'+id,text);};
export const recalledQuestion=(note:string,id:string)=>questions.get(note+'\0'+id);
export const forgetQuestion=(note:string,id:string)=>questions.delete(note+'\0'+id);
export const clearQuestions=()=>questions.clear();
