import {it,expect} from 'vitest';
import {dismissTarget} from '../src/transient.ts';
it('dismisses only the topmost transient, never inside it',()=>{const rows=[{id:'toolbar',priority:10,inside:false,protected:false},{id:'palette',priority:30,inside:false,protected:false}];expect(dismissTarget(rows,false)).toBe('palette');expect(dismissTarget([...rows,{id:'chat',priority:40,inside:true,protected:false}],false)).toBeNull();expect(dismissTarget(rows,true)).toBe('palette');});
it('never closes a transient containing unsent human text',()=>{expect(dismissTarget([{id:'ask',priority:20,inside:false,protected:true}],true)).toBeNull();expect(dismissTarget([{id:'review',priority:20,inside:false,protected:true}],false)).toBeNull();});
