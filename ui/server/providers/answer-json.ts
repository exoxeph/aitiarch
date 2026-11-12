/** What the chat makes of the model's final reply (Think and Ask keep the strict parser below). */
export type ChatReply={kind:'structured';value:unknown}|{kind:'prose';text:string};
const isExact=(v:unknown)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v as object).sort().join()==='answer,claims';
const tryJson=(s:string):{ok:true;value:unknown}|{ok:false}=>{try{return {ok:true,value:JSON.parse(s)};}catch{return {ok:false};}};
/**
 * A structured reply is exactly {answer, claims}. The model does not always format it that way, so: the whole text, JSON inside a code fence
 * (with prose around it, or not) or an object wrapped in other text is accepted when it has exactly those two keys. Plain prose, including a
 * code answer, is an unstructured reply. Anything JSON-shaped that is wrong (extra keys such as a takeaway, missing claims, malformed or cut
 * off) throws: it is never shown as if it were an answer.
 */
export function parseChatReply(value:unknown):ChatReply{
 if(typeof value!=='string'||!value.trim())throw new Error('Invalid answer formatting.');
 const text=value.trim(),whole=tryJson(text);
 if(whole.ok){
  if(isExact(whole.value))return {kind:'structured',value:whole.value};
  if(typeof whole.value==='object'||typeof whole.value==='string')throw new Error('Invalid answer shape.'); // an object or array of the wrong shape, or a quoted string
  return {kind:'prose',text}; // a bare number, true, false or null is just a short answer
 }
 for(const match of text.matchAll(/```[A-Za-z]*[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g)){
  const inner=tryJson(match[1]);if(!inner.ok)continue;
  if(isExact(inner.value))return {kind:'structured',value:inner.value};
  if(match[0]===text&&(typeof inner.value==='object'))throw new Error('Invalid answer shape.'); // the whole reply is one fence holding the wrong JSON
 }
 const first=text.indexOf('{'),last=text.lastIndexOf('}');
 if(first>=0&&last>first){const wrapped=tryJson(text.slice(first,last+1));if(wrapped.ok&&isExact(wrapped.value))return {kind:'structured',value:wrapped.value};}
 if(/^[\[{]/.test(text))throw new Error('Invalid answer formatting.'); // looks like JSON but is not usable: malformed or cut off
 return {kind:'prose',text};
}

// Only the approved outer fence is normalized. No prose extraction or schema bypass.
export function parseAnswerJson(value:unknown):unknown {
  if(typeof value!=='string')throw new Error('Invalid answer formatting.');
  let text=value.trim();
  if(text.startsWith('```')){
    const match=/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```$/.exec(text);
    if(!match)throw new Error('Invalid answer formatting.');
    text=match[1];
  }
  if(text.includes('```'))throw new Error('Invalid answer formatting.');
  return JSON.parse(text,(_key,entry)=>{
    if(typeof entry==='string'&&entry.includes('```'))throw new Error('Invalid answer formatting.');
    return entry;
  });
}
