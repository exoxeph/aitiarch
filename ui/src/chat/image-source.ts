import {IMAGE_MAX_BYTES,IMAGE_MAX_PIXELS} from '../../shared/image-attachments.ts';

const invalid=()=>Error('Attach a valid PNG, JPEG or WebP image.');
function dimensions(mime:'image/png'|'image/jpeg'|'image/webp',width:number,height:number){
 if(width<=0||height<=0)throw invalid();
 if(width*height>IMAGE_MAX_PIXELS)throw Error('Images must be at most 16 megapixels.');
 return {mime,width,height};
}

export function inspectImageSource(bytes:Uint8Array){
 if(bytes.length>IMAGE_MAX_BYTES)throw Error('Source images must be at most 5 MiB.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const is=(offset:number,tag:string)=>Array.from(tag).every((letter,i)=>bytes[offset+i]===letter.charCodeAt(0));
 if(is(0,'GIF87a')||is(0,'GIF89a'))throw Error('GIF images are not supported.');
 if(bytes.length>=24&&view.getUint32(0)===0x89504e47&&view.getUint32(4)===0x0d0a1a0a&&is(12,'IHDR'))
  return dimensions('image/png',view.getUint32(16),view.getUint32(20));
 if(bytes[0]===0xff&&bytes[1]===0xd8){
  for(let offset=2;offset+4<=bytes.length;){
   if(bytes[offset++]!==0xff)throw invalid();
   while(bytes[offset]===0xff)offset++;
   const marker=bytes[offset++];
   if(offset+2>bytes.length||marker===0xda||marker===0xd9)break;
   const size=view.getUint16(offset);
   if(size<2||offset+size>bytes.length)throw invalid();
   if([0xc0,0xc1,0xc2].includes(marker)&&size>=8)
    return dimensions('image/jpeg',view.getUint16(offset+5),view.getUint16(offset+3));
   offset+=size;
  }
 }
 if(bytes.length>=20&&is(0,'RIFF')&&is(8,'WEBP')&&view.getUint32(4,true)===bytes.length-8){
  let frame:ReturnType<typeof dimensions>|undefined;
  for(let offset=12;offset<bytes.length;){
   if(offset+8>bytes.length)throw invalid();
   const data=offset+8,size=view.getUint32(offset+4,true),end=data+size+(size%2);
   if(end>bytes.length)throw invalid();
   if(is(offset,'ANIM')||is(offset,'ANMF')||is(offset,'VP8X')&&size===10&&(bytes[data]&2))throw Error('Animated WebP images are not supported.');
   if(is(offset,'VP8 ')&&size>=10&&bytes[data+3]===0x9d&&bytes[data+4]===1&&bytes[data+5]===0x2a)
    frame=dimensions('image/webp',view.getUint16(data+6,true)&0x3fff,view.getUint16(data+8,true)&0x3fff);
   if(is(offset,'VP8L')&&size>=5&&bytes[data]===0x2f){
    const shape=view.getUint32(data+1,true);
    frame=dimensions('image/webp',(shape&0x3fff)+1,((shape>>>14)&0x3fff)+1);
   }
   if(is(offset,'VP8X')&&size===10){
    const side=(i:number)=>1+bytes[i]+256*bytes[i+1]+65536*bytes[i+2];
    dimensions('image/webp',side(data+4),side(data+7));
   }
   offset=end;
  }
  if(frame)return frame;
 }
 throw invalid();
}

export async function imageAsPng(file:File):Promise<Blob>{
 if(file.size>IMAGE_MAX_BYTES)throw Error('Source images must be at most 5 MiB.');
 const bytes=await file.arrayBuffer(),source=inspectImageSource(new Uint8Array(bytes));
 const original=new Blob([bytes],{type:source.mime});
 if(source.mime==='image/png')return original; // The server independently decodes and strips PNG metadata.
 const bitmap=await createImageBitmap(original).catch(()=>{throw invalid();});
 try{
  dimensions(source.mime,bitmap.width,bitmap.height);
  const canvas=document.createElement('canvas');
  canvas.width=bitmap.width;
  canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Could not prepare this image.');
  ctx.drawImage(bitmap,0,0);
  const png=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!png||png.type!=='image/png')throw Error('Could not encode this image as PNG.');
  if(png.size>IMAGE_MAX_BYTES)throw Error('The processed PNG exceeds 5 MiB.');
  return png;
 }finally{bitmap.close();}
}
