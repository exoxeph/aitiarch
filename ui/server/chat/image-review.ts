import type {ImageStore} from '../image-store.ts';
import type {ConfirmedImageSend,ReviewedImageManifest} from '../../shared/image-attachments.ts';

type Binding=Pick<ConfirmedImageSend,'sendId'|'provider'|'model'>;
type Reader=Pick<ImageStore,'readManifest'>;
const reReview=()=>Error('The images or selected model changed. Review again before sending.');

function descriptors(images:Awaited<ReturnType<Reader['readManifest']>>):ReviewedImageManifest['images']{
 return images.map(({id,sha256,mime,byteLength,width,height})=>({id,sha256,mime,byteLength,width,height}));
}

/** Freeze server-derived metadata for review. No paths, pixels or bytes in the review payload. */
export async function reviewImageManifest(store:Reader,ids:readonly string[],binding:Binding):Promise<ReviewedImageManifest>{
 if(!ids.length)throw Error('No staged images to review.');
 const images=await store.readManifest(ids);
 return {sendId:binding.sendId,provider:binding.provider,model:binding.model,images:descriptors(images)};
}

/** No session override. Hand off the same verified byte buffers that were checked against the review. */
export async function confirmImageManifest(store:Reader,review:ReviewedImageManifest,binding:Binding,input:{confirmImages?:boolean;imageIds:readonly string[]}){
 if(input.confirmImages!==true)throw Error('Confirm the reviewed images before sending.');
 if(binding.sendId!==review.sendId||binding.provider!==review.provider||binding.model!==review.model||
    input.imageIds.length!==review.images.length||review.images.some((image,i)=>image.id!==input.imageIds[i]))throw reReview();
 const images=await store.readManifest(input.imageIds);
 const current=descriptors(images);
 if(current.length!==review.images.length||current.some((image,i)=>{
  const prior=review.images[i];
  return image.id!==prior.id||image.sha256!==prior.sha256||image.mime!==prior.mime||image.byteLength!==prior.byteLength||
   image.width!==prior.width||image.height!==prior.height;
 }))throw reReview();
 return {manifest:review,images};
}
