// Inspect only flat metadata types/identifiers; never retain status string values.
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,39}$/.exec(value)?.[0]===value;
const tokenFields=new Set(['tokens','token_count','thinking_tokens']);
export function inspectThinkingTokens(event:Record<string,unknown>) {
  const fields:string[]=[],rejectedFields:string[]=[];
  for(const [key,value]of Object.entries(event)){
    const field=identifier(key)?key:'unknown';fields.push(field);
    const token=tokenFields.has(key);
    const forbidden=/(text|content|message|thinking|summary)/i.test(key)&&!token;
    const primitive=typeof value==='number'?Number.isFinite(value):typeof value==='boolean'||identifier(value);
    if(forbidden||!primitive||(token&&!(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)))rejectedFields.push(field);
  }
  const valid=event.type==='system'&&event.subtype==='thinking_tokens'&&rejectedFields.length===0;
  const tokenCounts:Record<string,number>={};
  if(valid)for(const key of tokenFields)if(typeof event[key]==='number')tokenCounts[key]=event[key] as number;
  return {valid,fields,rejectedFields,tokenCounts};
}
