import {useEffect,useRef,useState} from 'react';
import {IMAGE_SEND_MAX_BYTES,IMAGE_SEND_MAX_COUNT,IMAGE_WARNING,type ImageAvailability,type StagedImage} from '../../shared/image-attachments.ts';
import {chatImageAvailability,removeChatImage,stageChatImage,type ImageSurface} from '../api.ts';
import {imageAsPng} from './image-source.ts';

export type ImagePreview=StagedImage&{src:string};
type ImageSupport=ImageAvailability|{available:false;status?:undefined;reason:string};
export const imageSupportText=(support:ImageSupport)=>support.status?(`${support.status[0].toUpperCase()}${support.status.slice(1)}. ${support.reason}`):support.reason;

export function clipboardImages(data:DataTransfer){
 return Array.from(data.files).filter(file=>file.type.startsWith('image/'));
}

function pngData(file:Blob):Promise<string>{
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result).split(',',2)[1]??'');
  reader.onerror=()=>reject(new Error('The image could not be read.'));
  reader.readAsDataURL(file);
 });
}

function discard(id:string){void removeChatImage(id).catch(()=>{});}

export function useChatImages(settings:unknown,showNotice:(text:string)=>void,surface?:ImageSurface,enabled=true){
 const [support,setSupport]=useState<ImageSupport>({available:false,reason:'Checking image delivery…'});
 const [images,setImages]=useState<ImagePreview[]>([]),[loading,setLoading]=useState(false);
 const current=useRef<ImagePreview[]>([]),alive=useRef(true),staging=useRef(false);
 const epoch=useRef(0);
 function clear(){
  epoch.current++;
  for(const image of current.current)discard(image.id);
  current.current=[];
  setImages([]);
 }
 useEffect(()=>{
  if(!enabled)return;
  let active=true;
  const check=()=>{void chatImageAvailability(surface).then(value=>{if(active)setSupport(value);}).catch(()=>{
   if(active)setSupport({available:false,reason:'Could not check image delivery.'});
  });};
  check();
  window.addEventListener('aitiarch:pipeline-changed',check);
  return()=>{active=false;window.removeEventListener('aitiarch:pipeline-changed',check);};
 },[settings,surface,enabled]);
 useEffect(()=>{
  alive.current=true;
  return()=>{
   alive.current=false;
   for(const image of current.current)discard(image.id);
   current.current=[];
  };
 },[]);
 async function add(files:readonly File[]){
  if(!enabled||!files.length||staging.current)return;
  if(!support.available){showNotice(imageSupportText(support));return;}
  if(support.status==='untested model'||support.status==='untested version')showNotice(imageSupportText(support));
  staging.current=true;
  const generation=epoch.current;
  setLoading(true);
  try{
   for(const file of files){
    if(current.current.length>=IMAGE_SEND_MAX_COUNT)throw Error('Attach at most four images.');
    const encoded=await pngData(await imageAsPng(file));
    if(!alive.current||generation!==epoch.current)return;
    const staged=await stageChatImage(encoded,surface);
    if(!alive.current||generation!==epoch.current){discard(staged.id);return;}
    if(current.current.reduce((sum,image)=>sum+image.byteLength,0)+staged.byteLength>IMAGE_SEND_MAX_BYTES){
     discard(staged.id);
     throw Error('Attach at most 15 MiB of images per send.');
    }
    const image={...staged,src:`data:image/png;base64,${encoded}`};
    current.current=[...current.current,image];
    setImages(current.current);
   }
  }catch(error){if(alive.current&&generation===epoch.current)showNotice(error instanceof Error?error.message:'The image could not be attached.');}
  finally{staging.current=false;if(alive.current)setLoading(false);}
 }
 function remove(id:string){
  const image=current.current.find(item=>item.id===id);
  if(!image)return;
  discard(id);
  current.current=current.current.filter(item=>item.id!==id);
  setImages(current.current);
 }
 return {images,support,loading,add,remove,clear};
}

export function ImagePicker({draft,disabled}:{draft:ReturnType<typeof useChatImages>;disabled:boolean}){
 const picker=useRef<HTMLInputElement>(null);
 return <div className="chat-image-picker">
  <input type="file" ref={picker} hidden multiple accept="image/png,image/jpeg,image/webp" disabled={disabled||draft.loading||!draft.support.available} onChange={e=>{
   const files=Array.from(e.target.files??[]);
   e.target.value='';
   void draft.add(files);
  }}/>
  <button type="button" disabled={disabled||draft.loading||!draft.support.available} title={imageSupportText(draft.support)} onClick={()=>picker.current?.click()}>Attach images</button>
  {!draft.support.available&&<span className="small muted"> {imageSupportText(draft.support)}</span>}
 </div>;
}

export function ImageThumbnails({images,onRemove}:{images:readonly ImagePreview[];onRemove?:(id:string)=>void}){
 return <ul className="chat-image-list" aria-label="Attached images">{images.map((image,index)=>
  <li key={image.id}>
   <img src={image.src} alt={`Attached image ${index+1}`} width={64} height={48}/>
   <span>{image.width} × {image.height}</span>
   {onRemove&&<button type="button" className="ghost" aria-label={`Remove image ${index+1}`} onClick={()=>onRemove(image.id)}>×</button>}
  </li>
 )}</ul>;
}

export function ImageConfirmation({images,checked,onChange}:{images:readonly ImagePreview[];checked:boolean;onChange:(checked:boolean)=>void}){
 return <fieldset className="chat-image-confirm">
  <legend>Images for this send</legend>
  <ImageThumbnails images={images}/>
  <p>{IMAGE_WARNING}</p>
  <p className="small muted">Image token cost is unknown before sending.</p>
  <label><input type="checkbox" checked={checked} onChange={event=>onChange(event.target.checked)}/> Confirm sending these images</label>
 </fieldset>;
}

export function ImageInterpretationNotice({shown}:{shown?:true}){
 return shown?<p className="chat-warn" role="note">interpretation of your image, not verified</p>:null;
}
