// Why a Claude call failed, in a small set of safe reasons the chat can say in plain words. A reason never carries the question, a note,
// a credential or a path: details are short, sanitized, and capped. Pure, so the provider (which makes the reason) and the page (which
// shows it) share one definition.
export type FailureKind='not_configured'|'flag_rejected'|'timeout'|'login'|'exited'|'unparseable'|'output_limit'|'context_limit'|'cost_cap';
export interface FailureReason {kind:FailureKind;/** For flag_rejected: the option the CLI refused, e.g. --include-partial-messages. */flag?:string;
 /** A short, sanitized description: what was unexpected, or the tail of the CLI's own error message. Never prompt text. */detail?:string;exitCode?:number}

const FLAG='(--[a-z][a-z0-9-]{0,40})(?=[\'"`\\s.,:;]|$)';
const FLAG_PATTERNS=[new RegExp(`unknown option\\s+['"\`]?${FLAG}`,'i'),new RegExp(`unrecogni[sz]ed (?:option|argument)s?:?\\s+['"\`]?${FLAG}`,'i'),
 new RegExp(`unknown argument:?\\s+['"\`]?${FLAG}`,'i'),new RegExp(`invalid option(?:\\s+--)?\\s+['"\`]?${FLAG}`,'i')];
/** The option name a CLI complained about, or null. Only ever a plain --flag-name, never arbitrary text. */
export function flagFrom(stderr:string):string|null{
 for(const pattern of FLAG_PATTERNS){const m=pattern.exec(stderr);if(m)return m[1].toLowerCase();}
 return null;
}

/** The last 300 characters of an error message that are safe to show: control codes, paths, key-like values and anything that came from the
 *  prompt are removed first. `prompt` is the text that was sent; any 12-character run of it found in the message is hidden. */
export function safeTail(text:string,prompt=''):string{
 let t=String(text).replace(/\u001b\[[0-9;]*[A-Za-z]/g,'').replace(/[\u0000-\u001f\u007f]/g,' ');
 if(prompt.length>=12){
  const grams=new Set<string>();for(let i=0;i+12<=prompt.length;i++)grams.add(prompt.slice(i,i+12));
  const hidden=new Array<boolean>(t.length).fill(false);
  for(let i=0;i+12<=t.length;i++)if(grams.has(t.slice(i,i+12)))for(let k=i;k<i+12;k++)hidden[k]=true;
  let out='',inRun=false;for(let i=0;i<t.length;i++){if(hidden[i]){if(!inRun){out+='[hidden]';inRun=true;}}else{out+=t[i];inRun=false;}}
  t=out;
 }
 t=t.replace(/[A-Za-z]:\\[^\s"'<>|]*/g,'[path]').replace(/\/(?:Users|home|tmp|var|etc|opt|usr|mnt)\/[^\s"'<>]*/g,'[path]')
  .replace(/\b(api[_-]?key|password|secret|token|authorization)\s*[:=]\s*[^\s,;]+/gi,'$1=[hidden]').replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}/g,'[hidden]')
  .replace(/\s+/g,' ').trim();
 return t.slice(-300);
}

/** The reason for a provider error code, keeping the details the provider attached when it attached any. */
export function describeFailure(code:string,reason?:FailureReason):FailureReason{
 if(reason)return reason;
 switch(code){
  case 'timeout':return {kind:'timeout'};case 'not_logged_in':return {kind:'login'};
  case 'missing_cli':case 'unsupported_cli':return {kind:'not_configured'};
  case 'output_limit':return {kind:'output_limit'};case 'context_limit':return {kind:'context_limit'};
  case 'invalid_response':return {kind:'unparseable'};
  default:return {kind:'exited'};
 }
}

/** One sentence for the page. The chat adds "No retry was made." after it. */
export function failureText(r:FailureReason):string{
 switch(r.kind){
  case 'not_configured':return 'Claude is not set up for chat. Start Aitiarch with --claude and the full path to your Claude program.';
  case 'flag_rejected':return `Your Claude program does not accept the option ${r.flag??'that Aitiarch passes'}. It is probably a different version than Aitiarch expects.`;
  case 'timeout':return 'Claude took too long to answer, so it was stopped.';
  case 'login':return 'Claude needs you to sign in. Open a terminal, run claude, log in, then try again.';
  case 'exited':return `Claude's program stopped with an error${r.exitCode!==undefined?` (exit code ${r.exitCode})`:''}${r.detail?`: ${r.detail}`:' and printed no details.'}`;
  case 'unparseable':return `Claude's reply did not have the shape Aitiarch expects${r.detail?` (${r.detail})`:''}.`;
  case 'output_limit':return "Claude's reply was longer than Aitiarch allows.";
  case 'context_limit':return 'The note and context are too large to send. Narrow the sources and try again.';
  case 'cost_cap':return 'The turn reached its cost cap, so it was stopped and nothing from it was kept.';
 }
}
