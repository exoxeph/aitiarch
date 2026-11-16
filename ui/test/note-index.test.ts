import {expect,it} from 'vitest';
import {decisionRows} from '../shared/note-index.ts';
it('lists every parsed decision newest-edited note first, keeping source lines and human text',()=>{
 const rows=decisionRows([{path:'old.md',title:'Old',mtimeMs:1,text:'Decision: Old choice'},
 {path:'new.md',title:'New',mtimeMs:2,text:'# Plan\nDecision: Queue\nWhy: Latency\nRejected: Polling\n\nRejected: Blocking'}]);
 expect(rows.map(r=>[r.path,r.lineNumber])).toEqual([['new.md',2],['new.md',6],['old.md',1]]);
 expect(rows[0]).toMatchObject({noteName:'New',decision:'Queue',why:'Latency',rejected:['Polling']});
 expect(rows[1].decision).toBe('');
});
it('has no rows for ordinary prose or fenced decisions',()=>expect(decisionRows([{path:'p.md',title:'P',mtimeMs:1,text:'Ordinary prose\n```\nDecision: Not real\n```'}])).toEqual([]));
