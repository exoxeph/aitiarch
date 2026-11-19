import type {TourStatus} from '../../shared/tour-state.ts';

export function shouldOfferTour(status:TourStatus|undefined, setupSettled:boolean){
 return status==='unseen'&&setupSettled;
}

export const TOUR_STEPS=[
 {target:'editor',title:'The slash menu',
  text:'In a note, type / on an empty line for headings, tasks, a table and more. Choose a block to insert its Markdown.',
  demo:'/table → Table',missing:'Open a note to find the editor.'},
 {target:'context',title:'Links and attachments',
  text:'Use [[Note name]] to link your notes. In the chat composer, type @ to attach context for that request. A note link alone shares nothing with AI.',
  demo:'[[Delivery notes]] links · @Delivery notes attaches',missing:'Open Chat to find the @ attachment menu.'},
 {target:'selection',title:'Think on this and Ask',
  text:'Select text in a note to find Think on this and Ask. The review shows the selection and what will be shared. The request waits for your approval.',
  demo:'Select text → Think on this → Review → Send',missing:'Select text in a note to reveal these controls. Availability depends on your setup.'},
 {target:'thread',title:'Margin threads',
  text:'Open a thought beside your note to see its thread. The takeaway is yours to write and submit.',
  missing:'A margin thread appears once a thought is attached to your note.'},
 {target:'constellation',title:'Constellation and Decisions',
  text:'Open Constellation to see how notes connect. Decisions across all notes collects your Decision, Why and Rejected lines.',
  missing:'Use Show decisions in the command palette to find the list.'},
 {target:'ai',title:'Aitiarch AI',
  text:'Open Chat to see the assigned AI and choose a model. Review what will go before sending. Pipeline Studio shows how a request runs, including its caps and checks.',
  missing:'AI availability and role assignments are shown in AI settings.'},
] as const;
