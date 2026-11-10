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

it('slides into the empty gap of a margin that holds thought blobs instead of dropping below',()=>{
 // Right margin has a blob from 150 to 420 beside the selection; the left margin is empty and equally near.
 const blob={left:880,right:1190,top:150,bottom:420};
 const r=placeToolbar({left:250,right:850},200,{width:268,height:240},space,[blob]);
 expect(r.side).not.toBe('below');
 // never overlaps the blob
 if(r.side==='right')expect(r.top>=blob.bottom+8||r.top+240<=blob.top-8).toBe(true);
});
it('uses the right margin gap below a blob when both margins are blocked',()=>{
 const right={left:880,right:1190,top:150,bottom:420},left={left:10,right:220,top:100,bottom:600};
 const r=placeToolbar({left:250,right:850},200,{width:268,height:240},{left:0,right:1200,top:0,bottom:900},[right,left]);
 expect(r).toEqual({side:'right',left:862,top:428});
});
it('only goes below when no side margin is wide enough',()=>{
 expect(placeToolbar({left:100,right:1100},200,{width:268,height:240},space,[]).side).toBe('below');
});