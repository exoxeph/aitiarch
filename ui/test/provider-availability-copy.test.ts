import {expect,it} from 'vitest';
import {availabilityStatus} from '../src/chat/normal-provider.ts';
it('uses plain words when a provider check fails and preserves its check states',()=>{
 expect(availabilityStatus(null,'claude')).toEqual({word:'Could not check',why:'Availability could not be checked.'});
 expect(availabilityStatus(undefined,'claude').word).toBe('Checking…');
 expect(availabilityStatus([],'claude').word).toBe('Not set up');
 expect(availabilityStatus([{id:'claude',available:true}],'claude').word).toBe('Available');
 expect(availabilityStatus([{id:'claude',available:false,reason:'Install the CLI.'}],'claude')).toEqual({word:'Unavailable',why:'Install the CLI.'});
});
