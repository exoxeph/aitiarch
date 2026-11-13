// The words of the diagram chips above the composer. Pure; the panel only renders them. A diagram of the open note is a chip: "D1 claude-design · about 450 tokens". It is off until the question or the
// cursor points at the diagram, the person can switch it on or off, and at most two pictures go with a message.
import {formatTokens,type ReviewImage} from '../../shared/chat.ts';
import {MAX_DIAGRAM_IMAGES,imageTokens,type DiagramRef} from '../../shared/diagram-refs.ts';

/** The chip's text. `picture` is the saved picture's size when there is one; `state` says whether the picture goes with the next message. */
export function diagramChipText(d:Pick<DiagramRef,'n'|'title'>,picture:{width:number;height:number}|undefined,state:'on'|'off'|'over',failed=false):string{
 const head=`D${d.n} ${d.title}`;
 if(!picture)return `${head} · ${failed?'no picture':'picture on its way'}`;
 if(state==='over')return `${head} · not attached (limit ${MAX_DIAGRAM_IMAGES})`;
 return `${head} · about ${formatTokens(imageTokens(picture.width,picture.height))} tokens`;
}
/** Said when more pictures are switched on than a message can carry. */
export function overLimitText(over:readonly number[]):string{
 const names=over.map(n=>`D${n}`).join(', ');
 return `At most ${MAX_DIAGRAM_IMAGES} pictures go with a message: ${names} will not be attached. Switch another off to attach ${over.length===1?'it':'them'}.`;
}
/** A line of the review card for one picture that goes. */
export const reviewImageText=(i:Pick<ReviewImage,'n'|'title'|'tokens'>)=>`D${i.n} ${i.title} · about ${formatTokens(i.tokens)} tokens`;
/** A line of the review card for a diagram that was asked for and is not attached. */
export const notAttachedText=(i:{n:number;title:string;why:string})=>`D${i.n} ${i.title}: not attached, ${i.why}.`;
