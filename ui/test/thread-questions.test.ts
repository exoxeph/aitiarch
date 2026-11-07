import {expect,it} from 'vitest';
import {rememberQuestion,recalledQuestion,clearQuestions} from '../src/threads/questions.ts';
import {prepareRequest} from '../server/providers/index.ts';
it('remembers questions only in runtime memory and reload starts with no question',()=>{rememberQuestion('fixture.md','r1','Synthetic question.');expect(recalledQuestion('fixture.md','r1')).toBe('Synthetic question.');clearQuestions();expect(recalledQuestion('fixture.md','r1')).toBeUndefined();});
it('both prompts explicitly prohibit writing, suggesting, pre-filling or editing human fields',()=>{
 for(const action of ['think','ask'] as const){const p=prepareRequest({id:'r1',action,question:'Synthetic question.',selection:'Synthetic.',note:'Synthetic.',decisions:[],turns:[]});expect(p.instruction).toContain('Never write, suggest, pre-fill or edit');}
});
