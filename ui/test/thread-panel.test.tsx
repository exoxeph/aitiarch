import {renderToStaticMarkup} from 'react-dom/server';import {expect,it} from 'vitest';
import {TakeawayBox,ReplyView} from '../src/threads/ThreadPanel.tsx';
it('the human box is empty and has no AI suggestion controls',()=>{
 const html=renderToStaticMarkup(<TakeawayBox value="" onChange={()=>{}} onSubmit={()=>{}} onSkip={()=>{}} busy={false}/>);
 expect(html).toContain('Your takeaway');expect(html).toContain('Skip takeaway');expect(html).toContain('></textarea>');expect(html).not.toMatch(/suggest|prefill|use summary|use answer/i);
});
it('pending and failed replies never render their unaccepted body, accepted AI is labeled',()=>{
 for(const status of ['pending','error','cancelled','complete'] as const){const html=renderToStaticMarkup(<ReplyView reply={{id:'r1',parentId:'t1',body:'Synthetic AI text.',generation:{requestId:'r1',action:'ask',provider:'claude',model:null,status,evidence:[],dismissed:false,createdAt:'2026-11-08T00:00:00Z'}}}/>);
 expect(html.includes('Synthetic AI text.')).toBe(status==='complete');expect(html).toContain('AI');}
});
