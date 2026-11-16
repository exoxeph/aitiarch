import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ChatModeMenu} from '../src/chat/ChatMode.tsx';

it('names Normal and Council as chat modes rather than reply styles',()=>{
 for(const [value,label] of [['chat','Normal'],['council','Council']] as const){
  expect(renderToStaticMarkup(<ChatModeMenu value={value} onChange={()=>{}}/>)).toContain(`Chat mode: ${label}`);
 }
});
