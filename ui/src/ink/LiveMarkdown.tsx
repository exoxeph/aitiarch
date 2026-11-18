import type {ReplyRenderProfile} from '../../shared/reply-render-profile.ts';
import {Fragment,useEffect,useRef,useState} from 'react';
import {ReplyMarkdown} from './ReplyMarkdown.tsx';
import {healMarkdown} from './heal-markdown.ts';
import {createFrameBatcher,inlineCodeParts,type FrameBatcher} from './live-text.ts';

// An answer that is still arriving, drawn by the same renderer as the finished one (ReplyMarkdown). While it streams the tail is healed (heal-markdown.ts) so no raw
// mark shows, and the text reaches the renderer at most once per animation frame. When it ends the very same element gets the exact final text in the same commit,
// so the DOM is what the last frame showed. Links are never clickable here or in the final render (the renderer makes no anchors).
function useFrameText(text:string,live:boolean):string{
 const [shown,setShown]=useState(text),batcher=useRef<FrameBatcher<string>|null>(null);
 if(!batcher.current)batcher.current=createFrameBatcher<string>(f=>requestAnimationFrame(f),id=>cancelAnimationFrame(id),setShown);
 useEffect(()=>{
  if(live)batcher.current!.push(text);
  else{batcher.current!.cancel();setShown(text);}
 },[text,live]);
 useEffect(()=>()=>batcher.current?.cancel(),[]);
 return live?shown:text; // not live: the final text itself, with no frame of delay
}
export function LiveMarkdown({text,live,profile}:{text:string;live:boolean;profile?:ReplyRenderProfile}){
 const shown=useFrameText(text,live);
 return <>
  <ReplyMarkdown profile={profile} deferRich={live} text={live?healMarkdown(shown.replace(/\s+$/,'')):text}/>
  {live&&<span className="chat-caret" aria-hidden="true"/>}
 </>;
}

/** Narration is a line of plain text with `inline code` shown as code. No other mark is interpreted. `heal` closes a span that was cut short. */
export function InlineCode({text,heal}:{text:string;heal?:boolean}){
 return <>{inlineCodeParts(text,{heal}).map((p,i)=>p.code?<code key={i}>{p.text}</code>:<Fragment key={i}>{p.text}</Fragment>)}</>;
}
