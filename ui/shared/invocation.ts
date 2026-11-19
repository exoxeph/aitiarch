import { captureAnchor } from './anchors.ts';
import { VISUALIZE_QUESTION } from './diagram.ts';
import {validImageIds} from './image-attachments.ts';
export interface ReviewedCodexSkill {name:string;pathHash:string;contentHash:string;classification:'read-only';truncated:boolean}
export type Renderer = 'builtin' | 'skill';
export interface Invocation {
  id: string; path: string; action: 'think' | 'ask'; question: string;
  text: string; from: number; to: number;
  /** Visualize only: who draws the diagram. Absent means Built-in (the app's own spec pipeline). */
  renderer?: Renderer;
  /** Skill renderer only: which attached skill draws it (a skill id). Absent means the first one attached. */
  skill?: string;
  /** One-use server review. Required when machine-role routing is enabled. */
  reviewId?:string;
  imageIds?:string[];
  confirmImages?:boolean;
  confirmSkills?:boolean;
}
export function freezeInvocation(input: Invocation) {
  if(input?.reviewId!==undefined&&(typeof input.reviewId!=='string'||!/^[a-f0-9-]{36}$/.test(input.reviewId)))throw new Error('Review again before sending.');
  if (!input || typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id) || !['think', 'ask'].includes(input.action) ||
      typeof input.path !== 'string' || typeof input.text !== 'string' || typeof input.question !== 'string' ||
      input.question.length > 8000 || new TextEncoder().encode(input.text).length > 65536 ||
      input.to - input.from > 8000 || (input.action === 'ask' && !input.question.trim())) throw new Error('Invalid invocation or context too large.');
  if (input.renderer !== undefined && (!['builtin', 'skill'].includes(input.renderer) || (input.renderer === 'skill' && (input.action !== 'ask' || input.question !== VISUALIZE_QUESTION)))) throw new Error('Invalid invocation or context too large.');
  if (input.skill !== undefined && (input.renderer !== 'skill' || typeof input.skill !== 'string' || !/^[a-f0-9]{12}$/.test(input.skill))) throw new Error('Invalid invocation or context too large.');
  if(input.imageIds!==undefined&&(!validImageIds(input.imageIds)||
     input.imageIds.length>0&&input.question===VISUALIZE_QUESTION))throw new Error('Invalid image attachments for this request.');
  const anchor = captureAnchor(input.text, input.from, input.to);
  return Object.freeze({ ...input, ...(input.imageIds?{imageIds:[...input.imageIds]}:{}), anchor: structuredClone(anchor), selection: anchor.quote });
}
