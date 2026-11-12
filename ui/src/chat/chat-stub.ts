// Static data for the chat panel: context chips and suggested prompts. Nothing here talks to a provider.
export interface ContextChip {id:'note'|'threads'|'selection';label:string;on:boolean}

export const DEFAULT_CONTEXT:readonly ContextChip[]=[
 {id:'note',label:'This note',on:true},
 {id:'threads',label:'Threads',on:true},
 {id:'selection',label:'Selection',on:false},
];
export const SUGGESTED_PROMPTS:readonly string[]=[
 'Where is this note weakest?',
 'Which of my questions is still open?',
 'Turn the main ideas into a short outline.',
];

export function noteTitle(path:string|null):string{
 if(!path)return 'no note open';
 return (path.split(/[\\/]/).pop()??path).replace(/\.md$/i,'');
}
export const chatHeader=(path:string|null)=>`Aitiarch AI - On ${noteTitle(path)}`;
export const toggleChip=(chips:readonly ContextChip[],id:ContextChip['id']):ContextChip[]=>chips.map(c=>c.id===id?{...c,on:!c.on}:{...c});
