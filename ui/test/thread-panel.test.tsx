import {renderToStaticMarkup} from 'react-dom/server';import {expect,it} from 'vitest';
import {TakeawayBox,ReplyView,ReplyStack} from '../src/threads/ThreadPanel.tsx';
it('the human box is empty and has no AI suggestion controls',()=>{
 const html=renderToStaticMarkup(<TakeawayBox value="" onChange={()=>{}} onSubmit={()=>{}} onSkip={()=>{}} busy={false}/>);
 expect(html).toContain('Your takeaway');expect(html).toContain('Skip takeaway');expect(html).toContain('></textarea>');expect(html).not.toMatch(/suggest|prefill|use summary|use answer/i);
});
it('only the first two replies precede Show N more, without dropping any reply',()=>{
 const replies=Array.from({length:5},(_,n)=>({id:'r'+n,parentId:'t1',body:'Reply '+n,generation:{requestId:'r'+n,action:'ask' as const,provider:'claude' as const,model:null,status:'complete' as const,evidence:[],dismissed:false,createdAt:'2026-11-08T00:00:00Z'}}));
 const html=renderToStaticMarkup(<ReplyStack replies={replies} question={()=>'Question placeholder'} cancel={()=>{}}/>);
 expect(html).toContain('<summary>Show 3 more</summary>');expect(html.indexOf('Reply 1')).toBeLessThan(html.indexOf('<details'));expect(html.indexOf('Reply 2')).toBeGreaterThan(html.indexOf('<details'));expect(html).not.toContain('<details open');
 expect((html.match(/class="thread-reply"/g)||[])).toHaveLength(5);
});
it('Skip collapses the box with a readable local timestamp and Reopen, without exposing the preserved draft',()=>{
 const html=renderToStaticMarkup(<TakeawayBox value="Preserved human draft" onChange={()=>{}} onSubmit={()=>{}} onSkip={()=>{}} busy={false} skippedAt="2026-11-08T00:00:00Z" onReopen={()=>{}}/>);
 expect(html).toContain('Skipped on');expect(html).toContain('Reopen takeaway');expect(html).not.toContain('<textarea');expect(html).not.toContain('Preserved human draft');expect(html).not.toContain('2026-11-08T00:00:00Z');
 const reopened=renderToStaticMarkup(<TakeawayBox value="Preserved human draft" onChange={()=>{}} onSubmit={()=>{}} onSkip={()=>{}} busy={false}/>);
 expect(reopened).toContain('Preserved human draft');
});
it('pending and failed replies never render their unaccepted body, accepted AI is labeled',()=>{
 for(const status of ['pending','error','cancelled','complete'] as const){const html=renderToStaticMarkup(<ReplyView reply={{id:'r1',parentId:'t1',body:'Synthetic AI text.',generation:{requestId:'r1',action:'ask',provider:'claude',model:null,status,evidence:[],dismissed:false,createdAt:'2026-11-08T00:00:00Z'}}}/>);
 expect(html.includes('Synthetic AI text.')).toBe(status==='complete');expect(html).toContain('AI');}
});
