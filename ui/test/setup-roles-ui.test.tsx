import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ROLE_REGISTRY,type SetupView} from '../shared/setup.ts';
import {Setup} from '../src/setup/Setup.tsx';
import {SetupPane} from '../src/settings/SetupPane.tsx';
import {roleModelLabel} from '../shared/model-choice.ts';
import {formatDoctor} from '../server/platform/doctor.ts';

const view:SetupView={ready:true,seen:false,fontSize:null,models:[],
 providers:[{id:'claude',label:'Claude',path:'/fake/claude',version:'2.1.205',source:'explicit flag',compatible:true,reason:'Metadata matched.',notices:[]},
 {id:'kiro',label:'Kiro',path:'/fake/kiro',version:'3.3.0',source:'discovered',compatible:true,reason:'Metadata matched.',notices:[]}],
 roles:ROLE_REGISTRY.map(def=>({role:def.id,provider:'claude',source:'default',reason:null,capableProviders:['claude'],
  providerReasons:{kiro:'Needs the Skill workflow.'},
  ...(def.multiple?{participants:['claude']}:{})})),
 privacy:{mode:'private',sharedReady:false,notice:'filesystem-private'}};

it('defines every role in Settings, collapsed first-run customization, doctor and the chip labels',()=>{
 const settings=renderToStaticMarkup(<SetupPane view={view} onChange={()=>{}}/>);
 const first=renderToStaticMarkup(<Setup data={view} onClose={()=>{}}/>);
 const doctor=formatDoctor({exitCode:0,notice:'',checks:[],providers:[],roles:view.roles.map(role=>({...role,version:null}))});
 expect(first).toContain('<details><summary>Customize which AI does each job');
 for(const role of ROLE_REGISTRY){
  expect(settings).toContain(`data-role="${role.id}"`);
  expect(first).toContain(`data-role="${role.id}"`);
  expect(doctor).toContain(role.label);
  expect(roleModelLabel(role.id)).toBe(role.label);
 }
 expect(settings).toMatch(/<option value="kiro" disabled="">Kiro/);
 expect(settings).toContain('Needs the Skill workflow.');
 expect(first).toContain('Needs the Skill workflow.');
 expect(settings+first).not.toContain('does not support this role or is disabled');
 expect(settings).not.toContain('Set by launch flag; remove the flag to edit here.');
 expect(settings.match(/<select aria-label="Think and Ask"[^>]*>/)?.[0]).toBe('<select aria-label="Think and Ask">');
 expect(settings).toContain('Reset to default');
 expect(first).not.toContain('aria-haspopup="menu"');
});

it('enables a provider when the role view says it gained the required capability',()=>{
 const upgraded={...view,roles:view.roles.map(role=>role.role==='skill-diagram'
  ? {...role,capableProviders:[...role.capableProviders,'kiro' as const],providerReasons:{}}
  : role)};
 for(const html of [renderToStaticMarkup(<SetupPane view={upgraded} onChange={()=>{}}/>),renderToStaticMarkup(<Setup data={upgraded} onClose={()=>{}}/>)])
  expect(html.match(/<select aria-label="Skill diagrams"[^>]*>.*?<\/select>/)?.[0]).toContain('<option value="kiro">Kiro</option>');
});
