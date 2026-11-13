// The trail of one investigation turn, in order: text the model wrote and tool calls. Text before a tool call is narration; the answer is only
// the text after the last tool call. Pure and shared by the server (which keeps it with the turn) and the page (which builds it live).
export type TrailItem={text:string}|{step:number};
const isText=(i:TrailItem|undefined):i is {text:string}=>!!i&&'text' in i;

/** Adds streamed text. It continues the open text item; whitespace alone never opens one. Trailing space is trimmed when a call follows (addStep). */
export function addText(trail:readonly TrailItem[],text:string):TrailItem[]{
 const last=trail.at(-1);
 if(isText(last))return [...trail.slice(0,-1),{text:last.text+text}];
 return text.trim()?[...trail,{text:text.replace(/^\s+/,'')}]:[...trail];
}
/** A tool call starts: the text before it is closed (and trimmed) as narration. */
export function addStep(trail:readonly TrailItem[],index:number):TrailItem[]{
 const last=trail.at(-1),closed=isText(last)?[...trail.slice(0,-1),...(last.text.trim()?[{text:last.text.trim()}]:[])]:[...trail];
 return [...closed,{step:index}];
}
/** The answer so far: the text after the last tool call, or '' when the trail ends with a tool call (or is empty). */
export const answerTail=(trail:readonly TrailItem[]):string=>{const last=trail.at(-1);return isText(last)?last.text.trim():'';};
/** Every text item except the answer: the grey narration rows, in order. */
export const narrationItems=(trail:readonly TrailItem[]):{text:string}[]=>{const rows=trail.filter(isText);return isText(trail.at(-1))?rows.slice(0,-1):rows;};
