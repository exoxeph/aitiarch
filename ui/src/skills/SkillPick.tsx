import type {SkillsReview} from '../../shared/node-settings.ts';

// Visualize with the Skill renderer: one skill draws the diagram. When several are attached, the review asks which one (the first is chosen for you),
// and says in words that only that one is sent. Changing the pick reviews the request again.
export function SkillPick({review,disabled,onPick}:{review?:SkillsReview|null;disabled?:boolean;onPick:(id:string)=>void}){
 if(!review?.choose||review.choose.length<2)return null;
 return <fieldset className="persona-switch renderer-switch skill-pick" disabled={disabled}>
  <legend className="persona-legend">Which skill draws it</legend>
  <div className="persona-options">
   {review.choose.map(c=><label className="persona-option" key={c.id}>
    <input type="radio" name="skill-pick" value={c.id} checked={review.picked===c.id} onChange={()=>onPick(c.id)} aria-describedby="skill-pick-line"/><span className="persona-seg">{c.name}</span>
   </label>)}
  </div>
  {review.note&&<p className="persona-line" id="skill-pick-line">{review.note}</p>}
 </fieldset>;
}
