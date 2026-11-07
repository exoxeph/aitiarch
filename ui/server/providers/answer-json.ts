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
