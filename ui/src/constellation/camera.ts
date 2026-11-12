// The Constellation's camera: which world point sits at the centre of the view, and how far in we are. Pure math.
export interface Camera {x:number;y:number;k:number}
export interface Size {w:number;h:number}
export const MIN_ZOOM=0.15,MAX_ZOOM=4;
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));

export const toScreen=(c:Camera,v:Size,p:{x:number;y:number})=>({x:(p.x-c.x)*c.k+v.w/2,y:(p.y-c.y)*c.k+v.h/2});
export const toWorld=(c:Camera,v:Size,s:{x:number;y:number})=>({x:(s.x-v.w/2)/c.k+c.x,y:(s.y-v.h/2)/c.k+c.y});

/** Zoom by `factor` keeping the world point under the pointer where it is. */
export function zoomAt(c:Camera,v:Size,s:{x:number;y:number},factor:number):Camera{
 const k=clamp(c.k*factor,MIN_ZOOM,MAX_ZOOM),w=toWorld(c,v,s);
 return {x:w.x-(s.x-v.w/2)/k,y:w.y-(s.y-v.h/2)/k,k};
}

/** A camera that shows all the points with some room around them. One point: centred at a comfortable zoom. */
export function fit(points:{x:number;y:number}[],v:Size,pad=60):Camera{
 if(!points.length)return {x:0,y:0,k:1};
 if(points.length===1)return {x:points[0].x,y:points[0].y,k:1.2};
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const p of points){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
 const k=clamp(Math.min((v.w-2*pad)/(x1-x0||1),(v.h-2*pad)/(y1-y0||1),2),MIN_ZOOM,MAX_ZOOM);
 return {x:(x0+x1)/2,y:(y0+y1)/2,k};
}

/** Where the camera is a fraction `t` (0..1) through a glide from a to b: eased out, zoom interpolated evenly in scale. */
export function flight(a:Camera,b:Camera,t:number):Camera{
 if(t<=0)return a;if(t>=1)return b;
 const e=1-(1-t)**3;
 return {x:a.x+(b.x-a.x)*e,y:a.y+(b.y-a.y)*e,k:a.k*(b.k/a.k)**e};
}
