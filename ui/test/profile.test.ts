import {describe,expect,it} from 'vitest';
import {cleanAttachments,covers,deriveProfile,needOf,normalizeAttachedPath,resumePlan,type Grant} from '../shared/profile.ts';

const grant=(over:Partial<Grant>={}):Grant=>({v:1,project:'p',session:'s',profile:'notes',files:[],repo:false,diagrams:false,budgetUsd:0.5,confirmed:'x',...over});

describe('the profile comes from what is attached, nothing else',()=>{
 it('none or notes only is tool-less, diagrams alone give the diagram profile, files or the repo give Investigate',()=>{
  expect(deriveProfile({files:[],repo:false},false)).toBe('notes');
  expect(deriveProfile({files:[],repo:false},true)).toBe('diagrams');
  expect(deriveProfile({files:['src/a.ts'],repo:false},false)).toBe('investigate');
  expect(deriveProfile({files:[],repo:true},false)).toBe('investigate');
 });
 it('diagrams together with files or the repo run as Investigate, and the diagrams are not part of the need',()=>{
  expect(deriveProfile({files:['a.ts'],repo:false},true)).toBe('investigate');expect(needOf({files:['a.ts'],repo:false},true).diagrams).toBe(false);
  expect(needOf({files:[],repo:true},true)).toMatchObject({profile:'investigate',diagrams:false});
  expect(needOf({files:[],repo:false},true)).toMatchObject({profile:'diagrams',diagrams:true});
 });
});

describe('a grant covers a need only up to what the card showed',()=>{
 it('no grant is notes only',()=>{
  expect(covers(null,needOf({files:[],repo:false},false))).toBe(true);
  expect(covers(null,needOf({files:[],repo:false},true))).toBe(false); // diagrams need the card
  expect(covers(null,needOf({files:['a.ts'],repo:false},false))).toBe(false);
  expect(covers(null,needOf({files:[],repo:true},false))).toBe(false);
 });
 it('a higher profile, an extra file, the repo or the diagrams are each refused',()=>{
  const g=grant({profile:'investigate',files:['a.ts']});
  expect(covers(g,needOf({files:['a.ts'],repo:false},false))).toBe(true);
  expect(covers(g,needOf({files:['a.ts','b.ts'],repo:false},false))).toBe(false); // a file the card did not list
  expect(covers(g,needOf({files:['a.ts'],repo:true},false))).toBe(false); // the repo was not granted
  expect(covers(grant({profile:'diagrams'}),needOf({files:[],repo:false},true))).toBe(false); // diagrams not granted
  expect(covers(grant({profile:'diagrams',diagrams:true,diagramNote:'a.md'}),needOf({files:[],repo:false},true,'a.md'))).toBe(true);
  // the diagrams of ONE note: another note's, an unbound (older) grant and a need with no note are all refused
  expect(covers(grant({profile:'diagrams',diagrams:true,diagramNote:'a.md'}),needOf({files:[],repo:false},true,'b.md'))).toBe(false);
  expect(covers(grant({profile:'diagrams',diagrams:true}),needOf({files:[],repo:false},true,'a.md'))).toBe(false);
  expect(covers(grant({profile:'diagrams',diagrams:true,diagramNote:'a.md'}),needOf({files:[],repo:false},true))).toBe(false);
  expect(covers(grant({profile:'investigate',repo:true,diagrams:false}),needOf({files:[],repo:false},true,'a.md'))).toBe(false);
  expect(covers(grant({profile:'diagrams',diagrams:true,diagramNote:''}),needOf({files:[],repo:false},true))).toBe(false); // an empty note names nothing: never covers
  expect(needOf({files:[],repo:false},true,'a.md')).toMatchObject({diagrams:true,diagramNote:'a.md'});expect(needOf({files:[],repo:true},true,'a.md')).toMatchObject({diagrams:false,diagramNote:''});expect(needOf({files:[],repo:false},false,'a.md')).toMatchObject({diagrams:false,diagramNote:''});
  expect(covers(grant({profile:'notes'}),needOf({files:['a.ts'],repo:false},false))).toBe(false); // a lower profile never covers a higher one
 });
 it('a repo grant reaches any file; a lower need is always covered',()=>{
  const g=grant({profile:'investigate',repo:true});
  expect(covers(g,needOf({files:['x/y.ts'],repo:false},false))).toBe(true);expect(covers(g,needOf({files:[],repo:false},false))).toBe(true);
 });
});

describe('a CLI session is resumed only at exactly the profile it ran at',()=>{
 it('a downgrade starts a fresh session, and so does an upgrade',()=>{
  expect(resumePlan({id:'a',profile:'investigate',turns:3},3,'notes')).toEqual({fresh:true,resume:false}); // down
  expect(resumePlan({id:'a',profile:'notes',turns:3},3,'investigate')).toEqual({fresh:true,resume:false}); // up
  expect(resumePlan({id:'a',profile:'diagrams',turns:2},2,'investigate')).toEqual({fresh:true,resume:false});
 });
 it('the same profile resumes, and a first turn starts',()=>{
  expect(resumePlan({id:'a',profile:'notes',turns:3},3,'notes')).toEqual({fresh:false,resume:true});
  expect(resumePlan({id:'a',profile:'notes',turns:0},0,'notes')).toEqual({fresh:false,resume:false});
 });
 it('a conversation with no record counts as notes: it resumes at notes and starts fresh for anything else',()=>{
  expect(resumePlan(undefined,4,'notes')).toEqual({fresh:false,resume:true});
  expect(resumePlan(undefined,4,'diagrams')).toEqual({fresh:true,resume:false});
  expect(resumePlan(undefined,0,'investigate')).toEqual({fresh:true,resume:false});
 });
});

describe('an attached file path has one acceptable spelling',()=>{
 it('accepts a plain repo-relative path and turns backslashes into slashes',()=>{
  expect(normalizeAttachedPath('src/login.js')).toBe('src/login.js');expect(normalizeAttachedPath('src\\auth\\login.js')).toBe('src/auth/login.js');
 });
 it('refuses every way out of the repo or around the rules',()=>{
  for(const bad of ['../x','a/../../x','..\\x','a/./b','/etc/passwd','\\\\server\\share\\x','C:\\Windows\\x','C:x','~/x','%APPDATA%\\x','$HOME/x','a//b','dir/','','a\u0000b','a/b.','a /b','file.txt:stream','a/*.ts','a?b'])
   expect(normalizeAttachedPath(bad),JSON.stringify(bad)).toBeNull();
  expect(normalizeAttachedPath(5 as unknown)).toBeNull();expect(normalizeAttachedPath('a'.repeat(500))).toBeNull();
 });
});

describe('the attachments of a request are cleaned as a whole',()=>{
 it('drops unknown fields, dedupes and sorts',()=>{
  expect(cleanAttachments({files:['b.ts','a.ts','a.ts'],notes:['n.md'],repo:true,profile:'investigate',budgetUsd:99})).toEqual({ok:true,value:{notes:['n.md'],files:['a.ts','b.ts'],repo:true}});
  expect(cleanAttachments(undefined)).toEqual({ok:true,value:{notes:[],files:[],repo:false}});
 });
 it('one bad entry refuses the request',()=>{
  expect(cleanAttachments({files:['a.ts','../secret']}).ok).toBe(false);expect(cleanAttachments({notes:['/abs']}).ok).toBe(false);
  expect(cleanAttachments({files:'a.ts'}).ok).toBe(false);expect(cleanAttachments({repo:'yes'}).ok).toBe(false);expect(cleanAttachments([]).ok).toBe(false);
  expect(cleanAttachments({files:Array.from({length:21},(_,i)=>`f${i}.ts`)}).ok).toBe(false);
 });
});
