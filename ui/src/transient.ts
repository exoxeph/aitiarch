interface Candidate {id:string;priority:number;inside:boolean;protected:boolean}
export function dismissTarget(rows:Candidate[],escape:boolean){const top=[...rows].sort((a,b)=>b.priority-a.priority).at(0);return !top||top.protected||(!escape&&top.inside)?null:top.id;}
interface Entry {element:()=>HTMLElement|null;close:()=>void;priority:number;protect:()=>boolean}
const entries=new Map<string,Entry>();let serial=0;
function handle(event:Event){const escape=event instanceof KeyboardEvent&&event.key==='Escape';if(event.type==='keydown'&&!escape)return;
 const rows=[...entries].flatMap(([id,e])=>{const el=e.element();return !el||el.hidden||!el.getClientRects().length?[]:[{id,priority:e.priority+Number(id)/100000,inside:event.target instanceof Node&&el.contains(event.target),protected:e.protect()}];});
 const id=dismissTarget(rows,escape);if(!id){if(escape&&rows.length){event.preventDefault();event.stopImmediatePropagation();}return;}
 if(escape){event.preventDefault();event.stopImmediatePropagation();}entries.get(id)?.close();
}
export function hasUnsentText(el:HTMLElement|null){return !!el&&[...el.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input:not([type]),input[type=text],textarea')].some(e=>!e.readOnly&&!!e.value.trim());}
export function transient(element:()=>HTMLElement|null,close:()=>void,priority=100,protect=()=>hasUnsentText(element())){
 const id=String(++serial);if(!entries.size){document.addEventListener('pointerdown',handle,true);document.addEventListener('keydown',handle,true);}entries.set(id,{element,close,priority,protect});
 return()=>{entries.delete(id);if(!entries.size){document.removeEventListener('pointerdown',handle,true);document.removeEventListener('keydown',handle,true);}};
}
