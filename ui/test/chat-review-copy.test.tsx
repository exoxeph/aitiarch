import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ReviewCard} from '../src/chat/ChatPanel.tsx';
import type {ChatReview} from '../shared/chat.ts';
const review:ChatReview={reviewId:'review',requestId:'request',path:'fixture.md',question:'Synthetic question',selection:'',sources:[],historyPairs:0,omittedPairs:0,instruction:'Synthetic instruction',history:[],estimatedTokens:100,requiresConfirmation:true};
const html=(extra:object={})=>renderToStaticMarkup(<ReviewCard review={{...review,...extra}} stopAsking={false} setStopAsking={()=>{}} onSend={()=>{}} onCancel={()=>{}}/>);
it.each([['claude','Claude'],['codex','Codex'],['kiro','Kiro']])('names the frozen %s recipient before anything is sent',(provider,label)=>{
 const out=html({provider});expect(out).toContain('Review — nothing sent yet');expect(out).toContain(`Send to ${label}`);expect(out).toContain(`Instructions ${label} gets`);expect(out).not.toContain('Nothing has gone to Claude');expect(out).not.toContain('Demo mode:');
});
it('explicitly identifies a fake-provider review and its primary send button',()=>{const out=html({provider:'claude',demo:true});expect(out).toContain('Demo mode: no model is called');expect(out).toContain('>Send (demo, no model)</button>');expect(out).not.toContain('>Send to Claude</button>');});
