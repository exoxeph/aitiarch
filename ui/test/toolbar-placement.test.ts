import {it,expect} from 'vitest';
import {placeToolbar} from '../src/editor/toolbar-placement.ts';
const space={left:0,right:1200,top:0,bottom:900};
it('prefers the right margin aligned to the first line',()=>{
 expect(placeToolbar({left:250,right:850},200,{width:212,height:240},space)).toEqual({side:'right',left:862,top:200});
});
it('uses the left margin when the right is too narrow',()=>{
 expect(placeToolbar({left:300,right:1100},200,{width:212,height:240},space)).toEqual({side:'left',left:76,top:200});
});
it('reserves a dock when neither margin fits instead of covering text',()=>{
 expect(placeToolbar({left:100,right:1100},200,{width:212,height:240},space).side).toBe('below');
});
it('keeps a margin panel inside the vertical viewport',()=>{
 expect(placeToolbar({left:250,right:850},850,{width:212,height:240},space).top).toBe(652);
});
