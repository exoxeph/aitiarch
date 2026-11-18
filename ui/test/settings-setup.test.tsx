import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import type {SetupView} from '../shared/setup.ts';
import {SettingsDialog} from '../src/settings/SettingsDialog.tsx';

const {initialTab} = vi.hoisted(()=>({initialTab:{value:'usage'}}));
vi.mock('react',async importOriginal=>{
 const actual=await importOriginal<typeof import('react')>();
 return {...actual,useState:(initial:unknown)=>actual.useState(initial==='usage'?initialTab.value:initial)};
});

const data:SetupView={
 ready:true,seen:true,fontSize:null,models:[],
 providers:[
  {id:'claude',label:'Claude',path:'/fake/claude',version:'2.1.206',compatible:true,source:'explicit flag',reason:'Metadata verified',notices:['untested version: tested 2.1.205, found 2.1.206']},
  {id:'codex',label:'Codex',path:'/fake/codex',version:'0.167.0',compatible:true,source:'default',reason:'Metadata verified',notices:[]},
 ],
 roles:[
  {role:'normal-chat',provider:'codex',source:'saved choice',capableProviders:['claude','codex'],reason:null},
  {role:'invoked',provider:'claude',source:'default',capableProviders:['claude','codex'],reason:null},
  {role:'thread-reply',provider:'codex',source:'default',capableProviders:['claude','codex'],reason:'The saved provider is disabled.'},
  {role:'council',provider:'claude',source:'default',capableProviders:['claude','codex'],participants:['claude','codex'],reason:null},
  ...(['investigate-read','skill-diagram'] as const).map(role=>({role,provider:'claude' as const,source:'default' as const,capableProviders:['claude' as const],reason:null,routingNote:'This feature uses the startup Claude configuration.'})),
 ],
 privacy:{mode:'private',sharedReady:false,notice:'filesystem-private'},
};
function render(tab:string,preferences:SetupView|null=data){
 initialTab.value=tab;
 return renderToStaticMarkup(<SettingsDialog onClose={()=>{}} onOpenSetup={()=>{}} preferences={preferences} onPreferences={()=>{}}/>);
}

it('places Setup after Usage and keeps Usage free of setup controls',()=>{
 const html=render('usage');
 expect([...html.matchAll(/role="tab"[^>]*>([^<]+)/g)].map(m=>m[1])).toEqual(['Usage','Setup','Skills','Pipeline','Text size']);
 expect(html).toContain('Chat tokens, live');
 expect(html).not.toMatch(/Open setup|Run first-time setup again|Tools found/);
});

it('shows detected tools, effective role sources, reasons and scoped controls',()=>{
 const html=render('setup');
 for(const label of ['/fake/claude','2.1.206','untested version','Normal chat','saved choice','explicit flag','The saved provider is disabled.','Council participants','Investigate','Skill diagrams','startup Claude','Reset to default','Choose the model in the chat box.','Run first-time setup again']){
  expect(html).toContain(label);
 }
 expect(html.match(/<select/g)).toHaveLength(5);
 expect(html).toContain('aria-haspopup="menu"');
});

it('keeps Setup reachable when setup metadata is unavailable',()=>{
 expect(render('setup',null)).toContain('Setup information is unavailable.');
});
