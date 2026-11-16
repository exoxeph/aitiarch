import {expect,it} from 'vitest';
import {decisionRows} from '../shared/note-index.ts';
import {searchNotes} from '../shared/note-index.ts';
it('lists every parsed decision newest-edited note first, keeping source lines and human text',()=>{
 const rows=decisionRows([{path:'old.md',title:'Old',mtimeMs:1,text:'Decision: Old choice'},
 {path:'new.md',title:'New',mtimeMs:2,text:'# Plan\nDecision: Queue\nWhy: Latency\nRejected: Polling\n\nRejected: Blocking'}]);
 expect(rows.map(r=>[r.path,r.lineNumber])).toEqual([['new.md',2],['new.md',6],['old.md',1]]);
 expect(rows[0]).toMatchObject({noteName:'New',decision:'Queue',why:'Latency',rejected:['Polling']});
 expect(rows[1].decision).toBe('');
});
it('has no rows for ordinary prose or fenced decisions',()=>expect(decisionRows([{path:'p.md',title:'P',mtimeMs:1,text:'Ordinary prose\n```\nDecision: Not real\n```'}])).toEqual([]));
it('searches note text case-insensitively, with note names, bounded snippets and source lines',()=>{
 const hits=searchNotes([{path:'plan.md',title:'Plan',mtimeMs:1,text:'# Plan\n'+'.'.repeat(200)+' Cobalt phrase '+'.'.repeat(200)}],'COBALT');
 expect(hits).toHaveLength(1);expect(hits[0]).toMatchObject({path:'plan.md',noteName:'Plan',lineNumber:2,kind:'text'});
 expect(hits[0].snippet).toContain('Cobalt');expect(hits[0].snippet.length).toBeLessThanOrEqual(160);
});
it('ranks decision matches before prose, including reasons and rejected options, without duplicate line hits',()=>{
 const hits=searchNotes([{path:'a.md',title:'A',mtimeMs:10,text:'Queue prose\nDecision: Queue\nWhy: Bursts\nRejected: Polling'},
 {path:'b.md',title:'B',mtimeMs:1,text:'Decision: Queue too'}],'queue');
 expect(hits.map(h=>h.kind)).toEqual(['decision','decision','text']);
 expect(searchNotes([{path:'a.md',title:'A',mtimeMs:1,text:'Decision: Queue\nWhy: Bursts\nRejected: Polling'}],'polling')[0]).toMatchObject({kind:'decision',lineNumber:1});
});
it('caps results at 20, counts multiple matching lines, and returns nothing for blank queries',()=>{
 const notes=[{path:'a.md',title:'A',mtimeMs:1,text:Array.from({length:35},(_,i)=>`Match ${i}`).join('\n')}];
 expect(searchNotes(notes,'match')).toHaveLength(20);expect(searchNotes(notes,'   ')).toEqual([]);
});
it('treats hostile search input literally without regex or markup execution',()=>{
 expect(searchNotes([{path:'a.md',title:'A',mtimeMs:1,text:'<script>[x].*</script>'}],'[x].*')[0].snippet).toContain('[x].*');
});
