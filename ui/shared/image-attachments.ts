export const IMAGE_MAX_BYTES=5*1024*1024;
export const IMAGE_MAX_PIXELS=16_000_000;
export const IMAGE_SEND_MAX_COUNT=4;
export const IMAGE_SEND_MAX_BYTES=15*1024*1024;
export const IMAGE_WARNING='images are sent as-is; secret exclusion cannot inspect them';

export function validImageIds(value:unknown):value is string[]{
 return Array.isArray(value)&&value.length<=IMAGE_SEND_MAX_COUNT&&value.every(id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id));
}

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

export interface ReviewedImageManifest extends ConfirmedImageSend {
 images:readonly (StagedImage&{sha256:string})[];
}

export interface ImageAvailability {
 available:boolean;
 status:'verified'|'untested model'|'untested version'|'not verified yet'|'unsupported'|'synthetic';
 reason:string;
}
