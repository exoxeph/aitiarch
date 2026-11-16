// The thinking-partner persona, in our own words. It combines three ideas: strategic planning and verification before
// acting; keeping the human in the loop with checkpoints and a way to discuss; and one probing question at a time.
// (Credits, for the README: Superpowers, VibeWise (MIT), and Matt Pocock's grill-me. No text is copied from any of them.)
// The test-driven parts of those skills are for coding agents and do not apply to thoughts or chat.
import {activePipelineConfig,liveView} from './pipeline-config.ts';
export type PersonaMode='plan'|'grill'|'explain';
export type PersonaNode='think'|'ask'|'visualize'|'chat';
export const PERSONA_ORDER:readonly PersonaMode[]=['plan','grill','explain'];

/** Held in every mode; the strongest rules of the app still come after any skill text (see server/skill-instructions.ts). */
export const PERSONA_ALWAYS=
`Whatever the mode: never decide for the user; where a choice is theirs, leave it with them.
Never write, suggest or pre-fill the user's takeaway, their why, or a failed reason.
Label a hypothesis as a hypothesis. Never claim what the note says without seeing it; say what you could not see.
Stay within the existing length caps.`;

export const PERSONAS:Record<PersonaMode,{label:string;oneLine:string;instruction:string}>=liveView(()=>activePipelineConfig().prompts.personas);

export const isPersona=(v:unknown):v is PersonaMode=>v==='plan'||v==='grill'||v==='explain';
/** Plan with me where you are deciding (Think, Chat); Explain where you want an answer (Ask, Visualize). Opt-in for Grill me. */
export const defaultPersona=(node:PersonaNode):PersonaMode=>activePipelineConfig().personaModes[node];

/** The mode comes after the app's own answer-style guidance, which says to answer directly and first. It has to say outright that it wins over
 *  that guidance, or the earlier, longer rules outweigh it. The output format is not part of the style and always still applies. */
export const personaInstruction=(mode:PersonaMode):string=>`Thinking-partner mode: ${PERSONAS[mode].label}. This mode takes priority over the answer-style guidance above (such as answering in the first sentence, summarizing the note or listing options); the required JSON format still applies.\n${PERSONAS[mode].instruction}\n${PERSONA_ALWAYS}`;
