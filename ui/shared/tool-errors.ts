// What a tool call that came back with an error means, in words. Only a REAL permission denial by the CLI's rules reads "Denied by policy: <reason>". Any other
// error is an error: a path that does not exist reads "Error: path not found" with the path as the repo has it. Pure: the server classifies and cleans the message
// when the result arrives, the page reads steps (also ones stored before this existed) with the same functions.
export type FailureKind='denied'|'not_found'|'error';
export interface StepFailure {kind:FailureKind;word:'Denied by policy'|'Error';detail:string}
export interface FailedStep {tool:string;target:string;ok:boolean|null;denial?:string;error?:string;path?:string}

// Strict on purpose: the CLI words a policy denial as "Permission to <do something> has been denied" or "... denied by your permission settings". A file called
// permission-denied.ts in a "does not exist" message must not read as a denial, and an operating-system "EACCES: permission denied" is a tool error, not a policy.
const DENIED=[/^\s*(?:error:\s*)?permission to [^\n]{0,200}?\bdenied\b/i,/\bdenied by (?:your |the |its )?(?:permission|policy|settings)/i,/\b(?:not allowed|not permitted) by (?:your |the )?(?:permission|policy|settings)/i];
const MISSING=/\bdoes not exist\b|\bno such file\b|\bENOENT\b|\bnot found\b/i;
export function classifyFailure(text:string):FailureKind{
 if(DENIED.some(r=>r.test(text)))return 'denied';
 return MISSING.test(text)?'not_found':'error';
}

const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** One short line, with the copy's own folder taken off every path in it: a path inside the repo reads as the repo has it (forward slashes), and is never mistaken for a user path. */
export function cleanToolText(raw:string,cwd:string):string{
 let t=String(raw??'').split(/\r?\n/)[0].trim();
 const base=cwd.replace(/[\\/]+$/,'');
 if(base){
  const lead=/^[\\/]/.test(base)?'[\\\\/]+':'',folder=lead+base.split(/[\\/]+/).filter(Boolean).map(escape).join('[\\\\/]+');
  t=t.replace(new RegExp(folder+'[\\\\/]+([^\\s"\'<>:*?|]*)','gi'),(_m,rest:string)=>rest.replace(/\\/g,'/')); // the folder and what is inside it
  t=t.replace(new RegExp(folder+'(?![\\w.\\-])','gi'),'.');                                                   // the folder itself
 }
 return t.slice(0,200);
}

const outside=(p:string)=>/^[A-Za-z]:|^[\\/]|\[USER_PATH\]|^~|^\.$/.test(p); // not a path inside the repo: never shown as one
function pathFromMessage(text:string):string|null{
 const m=/(?:does not exist|not found|no such file or directory)\s*[:,]?\s*(?:open\s*)?['"]?([^'"\s]+?)['"]?\s*$/i.exec(text),p=m?.[1]?.trim();
 return p&&!outside(p)?p:null;
}
/** The failure a step shows, or null when it did not fail. Reads steps stored before errors and denials were told apart (a tool error saved as a "denial"). */
export function stepFailure(step:FailedStep):StepFailure|null{
 if(step.ok!==false)return null;
 const text=step.error??step.denial??'',kind=classifyFailure(text);
 if(kind==='denied')return {kind,word:'Denied by policy',detail:text};
 if(kind==='not_found'){
  const p=step.path&&!outside(step.path)?step.path:pathFromMessage(text);
  return {kind,word:'Error',detail:p?`path not found: ${p}`:'path not found'};
 }
 return {kind,word:'Error',detail:text||'the tool did not finish'};
}
