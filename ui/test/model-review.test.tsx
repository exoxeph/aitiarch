import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ReviewCard} from '../src/chat/ChatPanel.tsx';
import {ReplyView} from '../src/threads/ThreadPanel.tsx';
import {CouncilResults} from '../src/chat/CouncilPanel.tsx';
import type {ChatReview} from '../shared/chat.ts';
const base:ChatReview={reviewId:'r',requestId:'q',path:'synthetic.md',question:'Synthetic?',selection:'',sources:[],historyPairs:0,omittedPairs:0,instruction:'Synthetic rules.',history:[],estimatedTokens:100,requiresConfirmation:true};
it.each([{model:'sonnet',effort:'low'},{model:null,effort:null}])('chat review distinguishes requested settings from reported model: %j',modelSettings=>{
 const html=renderToStaticMarkup(<ReviewCard review={{...base,provider:'claude',modelSettings,continuityNotice:'A fresh CLI context will be used.'}} stopAsking={false} setStopAsking={()=>{}} onSend={()=>{}} onCancel={()=>{}}/>);
 expect(html).toContain(`Requested model: ${modelSettings.model??'Default'}`);expect(html).toContain(`effort: ${modelSettings.effort??'Default'}`);expect(html).toContain('A fresh CLI context will be used.');expect(html).toContain('Send to Claude');
});
it.each(['runtime-model',null])('thread reply reports only final model metadata: %s',model=>{
 const reply={id:'r',parentId:'t',body:'Synthetic answer.',generation:{requestId:'r',action:'ask' as const,provider:'claude' as const,model,status:'complete' as const,evidence:[],dismissed:false,createdAt:'2026-11-18T00:00:00Z'}};
 const html=renderToStaticMarkup(<ReplyView reply={reply}/>);
 expect(html).toContain(model??'model not reported');
});
it('Council shows reported model or the explicit missing label without inferring aliases',()=>{
 const html=renderToStaticMarkup(<CouncilResults run={{id:'r',question:'Synthetic?',notes:[],startedAt:'2026-11-18T00:00:00Z',finishedAt:'2026-11-18T00:00:01Z',results:[{provider:'codex',safetyLabel:'contained',status:'ok',answer:'Synthetic.',usage:[],durationMs:1000}]}}/>);
 expect(html).toContain('model not reported');
});
