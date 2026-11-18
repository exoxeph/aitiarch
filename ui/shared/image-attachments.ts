export const IMAGE_MAX_BYTES=5*1024*1024;
export const IMAGE_MAX_PIXELS=16_000_000;
export const IMAGE_SEND_MAX_COUNT=4;
export const IMAGE_SEND_MAX_BYTES=15*1024*1024;
export const IMAGE_WARNING='images are sent as-is; secret exclusion cannot inspect them';

export interface StagedImage {
 id:string;
 mime:'image/png';
 byteLength:number;
 width:number;
 height:number;
}

/** Server-owned snapshot of the images confirmed for a single review/send. */
export interface ConfirmedImageSend {
 sendId:string;
 provider:'claude'|'codex';
 model:string|null;
 images:readonly {id:string;sha256:string}[];
}
