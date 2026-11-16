import {expect,it} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {OrphanList} from '../src/ink/OrphanList.tsx';import {captureAnchor} from '../shared/anchors.ts';import {newThread} from '../shared/threads.ts';import type {InkItem} from '../shared/ink.ts';
const anchor=captureAnchor('Removed synthetic sentence.',0,27);
function orphan(thread:boolean):InkItem{
 const item:InkItem={id:'orphan',kind:'answer',body:'Preserved AI reply.',anchor,originalAnchor:anchor,attachment:{status:'orphaned',reason:'missing'},generation:{requestId:'orphan',action:'think',provider:'claude',model:null,createdAt:'2026-01-01T00:00:00.000Z',status:'complete',evidence:[],dismissed:false}};
 if(thread)item.thread=newThread(item);return item;
}
const render=(item:InkItem)=>renderToStaticMarkup(<OrphanList text="Current synthetic sentence." items={[item]} onPick={()=>{}} onSelect={()=>{}} onOpen={()=>{}}/>);
it('offers Open thread for an orphan with a surviving thread',()=>{expect(render(orphan(true))).toContain('Open thread');});
it('does not offer Open thread for legacy orphan ink without a thread',()=>{expect(render(orphan(false))).not.toContain('Open thread');});
it('continues to escape orphan content instead of rendering HTML',()=>{const item=orphan(true);item.body='<img src=x onerror=alert(1)>';expect(render(item)).not.toContain('<img');expect(render(item)).toContain('&lt;img');});
