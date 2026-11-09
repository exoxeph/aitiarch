export interface ToolbarSpace {left:number;right:number;top:number;bottom:number}
/** Never overlaps the writing column. `below` means a reserved, non-overlay dock. */
export function placeToolbar(text:{left:number;right:number},firstLine:number,size:{width:number;height:number},space:ToolbarSpace):{side:'right'|'left'|'below';left:number;top:number}{
 const top=Math.max(space.top+8,Math.min(firstLine,space.bottom-size.height-8));
 if(space.right-text.right>=size.width+20)return {side:'right',left:text.right+12,top};
 if(text.left-space.left>=size.width+20)return {side:'left',left:text.left-size.width-12,top};
 return {side:'below',left:0,top:0};
}
