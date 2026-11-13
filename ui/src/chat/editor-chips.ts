// The words of the chips and notices that say what the next chat message carries from the editor. Pure: the panel only renders what these return.
import type {EditorContext} from '../../shared/editor-context.ts';

/** "line 5" or "lines 3-5". */
export const linesText=(from:number,to:number)=>from===to?`line ${from}`:`lines ${from}-${to}`;
/** The heading path as it reads in the chip and the manifest: "Plan > Risks". Empty when the cursor is above the first heading. */
export const sectionText=(section:readonly string[])=>section.join(' > ');
const charsText=(n:number)=>`${n.toLocaleString('en-US')} ${n===1?'char':'chars'}`;

/** The selection chip: where the selection is and how much of it goes. */
export function selectionChipText(selection:NonNullable<EditorContext['selection']>):string{
 return `Selection · ${linesText(selection.fromLine,selection.toLine)} · ${charsText(selection.text.length)}${selection.cut?', cut short':''}`;
}
/** The chip that says which note goes with the message. */
export const noteChipText=(title:string,on:boolean)=>on?`Open note · ${title}`:`Open note · ${title} · off`;
/** Said when the person opens another note while a conversation is on. */
export const noteChangedText=(from:string,to:string)=>`Open note changed: ${from} -> ${to}`;
