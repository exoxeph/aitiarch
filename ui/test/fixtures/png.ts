// Synthetic PNGs for the diagram picture tests: a real, well-formed file of a given size (a flat colour, so it stays small), or noise (so it does not compress), built with zlib only.
import {randomBytes} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';

const chunk=(type:string,data:Buffer)=>{
 const body=Buffer.concat([Buffer.from(type,'latin1'),data]),out=Buffer.alloc(12+data.length);
 out.writeUInt32BE(data.length,0);body.copy(out,4);out.writeUInt32BE(crc32(body)>>>0,8+data.length);return out;
};
/** A valid 8-bit RGB PNG, `width` x `height`. `noise` fills it with random bytes (big and incompressible). */
export function makePng(width:number,height:number,{noise=false,shade=200}:{noise?:boolean;shade?:number}={}):Buffer{
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 const row=1+width*3,raw=Buffer.alloc(row*height,shade);
 for(let y=0;y<height;y++){raw[y*row]=0;if(noise)randomBytes(width*3).copy(raw,y*row+1);}
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
/** A copy with one byte changed. */
export const flip=(png:Buffer,at:number)=>{const c=Buffer.from(png);c[at]^=0xff;return c;};
/** The svg a diagram is saved as, and its hash-named file name (the hash is of the bytes). */
import {createHash} from 'node:crypto';
export const svgFor=(label:string,extra='')=>{
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><rect width="400" height="200" fill="#eef"/><text x="20" y="60">${label}</text>${extra}</svg>`;
 return {svg,base:'diagram-'+createHash('sha256').update(svg).digest('hex')};
};
