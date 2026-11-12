import {PERSONAS,PERSONA_ORDER,type PersonaMode} from '../../shared/persona.ts';

/** How a step works with you: Plan with me, Grill me or Explain, with one line on what the chosen one does. Every state is in words. */
export function PersonaSwitch({id,label,value,onChange,disabled,hint,kept}:{id:string;label:string;value:PersonaMode;onChange:(p:PersonaMode)=>void;disabled?:boolean;hint?:string;kept?:boolean|null}){
 return <fieldset className="persona-switch" disabled={disabled}>
  <legend className="persona-legend">{label}</legend>
  <div className="persona-options">
   {PERSONA_ORDER.map(p=><label key={p} className="persona-option">
    <input type="radio" name={`persona-${id}`} value={p} checked={value===p} onChange={()=>onChange(p)} aria-describedby={`persona-line-${id}`}/>
    <span className="persona-seg">{PERSONAS[p].label}</span>
   </label>)}
  </div>
  <p className="persona-line" id={`persona-line-${id}`}>{PERSONAS[value].oneLine}{kept===true&&' · Kept until you close Aitiarch'}</p>
  {disabled&&hint&&<p className="persona-line">{hint}</p>}
 </fieldset>;
}

/** A quiet line under an AI answer: which skills shaped it. Names only. Nothing at all when none were used. */
export function UsedSkills({names}:{names?:readonly string[]}){
 if(!names?.length)return null;
 return <p className="used-skills"><span className="used-skills-label">Used:</span> {names.join(', ')}</p>;
}
