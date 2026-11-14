// What the chat says about diagrams in a conversation turn. Pure; the panel only renders it. Claude may open a diagram's picture with Read when the question needs it: the review card says which it may
// open and the cost cap, each Read shows as a live row on the reply's trail, and a turn the fence stopped says why.
import type {ChatReview,DiagramRead} from '../../shared/chat.ts';
import {fenceText,type FenceCode} from '../../shared/diagram-fence.ts';

const quoted=(d:{n:number;title:string})=>`D${d.n} '${d.title}'`;
const money=(n:number)=>'$'+n.toFixed(2);
/** The review card's line: "Claude may open these diagrams: D1 'title', D2 'title' (up to $0.50)". Null when it may open none. */
export function reviewDiagramsText(r:Pick<ChatReview,'diagrams'|'diagramCapUsd'>):string|null{
 if(!r.diagrams?.length)return null;
 return `Claude may open ${r.diagrams.length===1?'this diagram':'these diagrams'}: ${r.diagrams.map(quoted).join(', ')}${r.diagramCapUsd!==undefined?` (up to ${money(r.diagramCapUsd)})`:''}`;
}
/** A line of the review card for a diagram that is withheld: "D3 'title': withheld, it holds text that looks like a secret." */
export const withheldText=(d:{n:number;title:string;why:string})=>`${quoted(d)}: withheld, ${d.why}.`;
/** A row on the reply's trail: "Opened D1 'title'". */
export const openedText=(d:Pick<DiagramRead,'n'|'title'>)=>`Opened ${quoted(d)}`;
/** What the turn cost, under the reply: "This turn cost $0.012". */
export const turnCostText=(usd:number)=>`This turn cost $${usd.toFixed(usd<0.1?3:2)}`;
/** The sentence for a turn the fence stopped, with what it had cost when the CLI said. */
export function stoppedText(fence:FenceCode,capUsd?:number,costUsd?:number):string{
 return fenceText(fence,capUsd)+(costUsd!==undefined&&fence!=='budget'?` It had cost $${costUsd.toFixed(costUsd<0.1?3:2)}.`:'');
}
