// Settings logic for the AI settings screens. Pure; the server stays the authority and these only keep the screen honest.
import {formatCount} from '../chat/chat-model.ts';

export interface Meter {percent:number;label:string;tone:'ok'|'warn'|'full'}
export function tokenMeter(u:{spent:number;tokenBudget:number}):Meter{
 const ratio=u.tokenBudget>0?u.spent/u.tokenBudget:0;
 return {percent:Math.min(100,Math.round(ratio*100)),label:`${formatCount(u.spent)} of ${formatCount(u.tokenBudget)} tokens`,tone:ratio>=1?'full':ratio>=0.8?'warn':'ok'};
}
