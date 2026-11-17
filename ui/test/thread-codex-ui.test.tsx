import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ReplyView,failureLabels} from '../src/threads/ThreadPanel.tsx';
import {invokedUsageLabel} from '../shared/invoked-usage.ts';
it('labels every saved AI message by its own provider in a mixed-provider thread',()=>{
 const html=renderToStaticMarkup(<>{(['claude','codex','chatgpt-plan'] as const).map((provider,n)=><ReplyView key={provider} reply={{id:'r'+n,parentId:'root',body:'Synthetic answer.',generation:{requestId:'r'+n,action:'ask',provider,model:null,status:'complete',evidence:[],dismissed:false,createdAt:'2026-11-18T00:00:00Z'}}}/>)}</>);
 for(const label of ['Claude','Codex','ChatGPT plan'])expect(html).toContain(label);
});
it('shows a plain stale-review failure and distinguishes unknown native usage from dollars',()=>{
 expect(failureLabels.review_changed).toContain('Review again');
 const label=invokedUsageLabel({provider:'codex',unit:'tokens',amount:null,budgetCharge:40000,cap:40000,overCap:false});
 expect(label).toContain('not reported');expect(label).not.toContain('$');expect(label).not.toContain('0 tokens measured');
});
