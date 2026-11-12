import { captureAnchor } from './anchors.ts';
import { VISUALIZE_QUESTION } from './diagram.ts';
export type Renderer = 'builtin' | 'skill';
export interface Invocation {
  id: string; path: string; action: 'think' | 'ask'; question: string;
  text: string; from: number; to: number;
  /** Visualize only: who draws the diagram. Absent means Built-in (the app's own spec pipeline). */
  renderer?: Renderer;
}
export function freezeInvocation(input: Invocation) {
  if (!input || typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id) || !['think', 'ask'].includes(input.action) ||
      typeof input.path !== 'string' || typeof input.text !== 'string' || typeof input.question !== 'string' ||
      input.question.length > 8000 || new TextEncoder().encode(input.text).length > 65536 ||
      input.to - input.from > 8000 || (input.action === 'ask' && !input.question.trim())) throw new Error('Invalid invocation or context too large.');
  if (input.renderer !== undefined && (!['builtin', 'skill'].includes(input.renderer) || (input.renderer === 'skill' && (input.action !== 'ask' || input.question !== VISUALIZE_QUESTION)))) throw new Error('Invalid invocation or context too large.');
  const anchor = captureAnchor(input.text, input.from, input.to);
  return Object.freeze({ ...input, anchor: structuredClone(anchor), selection: anchor.quote });
}
