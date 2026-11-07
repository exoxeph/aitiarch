// Exact protocol fields only; never retain status string values or envelope ids.
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,39}$/.exec(value)?.[0]===value;
const uuid=(value:unknown):boolean=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(value)?.[0]===value;
const tokenFields=new Set(['estimated_tokens','estimated_tokens_delta']);
export interface RejectedThinkingField { name:string; type:string; stringLength?:number; uuidMatch:boolean }
export function inspectThinkingTokens(event:Record<string,unknown>) {
  const fields:string[]=[],rejectedFields:string[]=[];
  const rejectedDetails:RejectedThinkingField[]=[];
  for(const [key,value]of Object.entries(event)){
    const field=identifier(key)?key:'unknown';fields.push(field);
    const accepted=key==='type'?value==='system':key==='subtype'?value==='thinking_tokens'
      :tokenFields.has(key)?typeof value==='number'&&Number.isFinite(value)
      :key==='uuid'||key==='session_id'?uuid(value):false;
    if(!accepted){
      rejectedFields.push(field);
      rejectedDetails.push({name:field,type:value===null?'null':Array.isArray(value)?'array':typeof value,
        ...(typeof value==='string'?{stringLength:value.length}:{}),uuidMatch:uuid(value)});
    }
  }
  const valid=event.type==='system'&&event.subtype==='thinking_tokens'&&rejectedFields.length===0;
  const tokenCounts:Record<string,number>={};
  if(valid)for(const key of tokenFields)if(typeof event[key]==='number')tokenCounts[key]=event[key] as number;
  return {valid,fields,rejectedFields,rejectedDetails,tokenCounts};
}
