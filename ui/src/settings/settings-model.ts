// Settings logic for the AI settings screens. Pure; the server stays the authority and these only keep the screen honest.
import {formatCount} from '../chat/chat-model.ts';

export interface Meter {percent:number;label:string;tone:'ok'|'warn'|'full'}
export function tokenMeter(u:{spent:number;tokenBudget:number}):Meter{
 const ratio=u.tokenBudget>0?u.spent/u.tokenBudget:0;
 return {percent:Math.min(100,Math.round(ratio*100)),label:`${formatCount(u.spent)} of ${formatCount(u.tokenBudget)} tokens`,tone:ratio>=1?'full':ratio>=0.8?'warn':'ok'};
}
/** The notice Settings shows when the Claude Code CLI is not the version the diagram fence was verified on (or its version could not be read). Null when it is that version. */
export function cliNotice(cli:{version:string|null;tested:string}):string|null{
 if(cli.version===cli.tested)return null;
 return `${cli.version?`Your Claude Code CLI is version ${cli.version}`:'The version of your Claude Code CLI could not be read'}: the diagram fence was verified on ${cli.tested}. A conversation that may open diagrams is still watched by Aitiarch, which stops any read outside its diagram folder.`;
}
