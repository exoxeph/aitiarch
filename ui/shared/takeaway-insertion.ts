import type {InkItem} from './ink.ts';
/** Pure preview only. The UI applies changes as an ordinary human editor transaction,
 * then its existing session saves with compare-and-write. Never writes a file. */
export function previewTakeawayInsertion(note:{text:string;version:string},item:InkItem,expectedVersion:string){
 if(note.version!==expectedVersion)throw new Error('The note changed. Review a new preview.');
 const a=item.attachment;if(a.status!=='attached'||note.text.slice(a.from,a.to)!==item.anchor.quote)throw new Error('An attached anchor is required.');
 const text=item.thread?.takeaway.text;if(item.thread?.takeaway.state!=='submitted'||typeof text!=='string'||!text.trim())throw new Error('Submit your own takeaway first.');
 const boundary=note.text.indexOf('\n\n',a.to),from=boundary===-1?note.text.length:boundary;
 const insert=(from>0&&!note.text.slice(0,from).endsWith('\n\n')?'\n\n':'')+text+(boundary===-1?'\n':'');
 return {noteVersion:note.version,changes:{from,to:from,insert},humanText:text};
}
