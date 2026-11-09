import {useEffect,useRef} from 'react';
export function ThoughtInsertionPreview({text,insert,cancel}:{text:string;insert:()=>void;cancel:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=dialog.current;d?.showModal();return()=>{d?.close();};},[]);
 return <dialog ref={dialog} className="thought-insert-preview" aria-label="Review AI block insertion" onCancel={e=>{e.preventDefault();cancel();}} onKeyDown={e=>{
  if(e.key!=='Tab')return;
  const buttons=e.currentTarget.querySelectorAll<HTMLButtonElement>('button'),first=buttons[0],last=buttons[buttons.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
 }}>
  <h2>Bring AI content to notebook</h2><p>AI-authored text, inserted only by you. This is not a takeaway or a decision. One Undo removes the insertion.</p>
  <pre>{text}</pre><button autoFocus onClick={insert}>{text.includes('![AI diagram:')?'Insert AI diagram image':'Insert labeled AI block'}</button><button onClick={cancel}>Cancel AI insertion</button>
 </dialog>;
}
