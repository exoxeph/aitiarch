import type {SkillsReview} from '../../shared/node-settings.ts';

// Part of the "What will be sent" review: which skills are in this request. Every state is written in words (never colour alone),
// and token numbers say they are estimates. The exact text sent is in the instruction block the review already shows.
const count=(n:number)=>n.toLocaleString('en-US');
const WHY={total_cap:'the 48,000-character limit for all skills was already used.',unreadable:'its file could not be read.'} as const;

export function SkillsReviewList({review}:{review?:SkillsReview|null}){
 if(!review)return null;
 return <section className="skills-review" aria-label="Skills in this request">
  <h4 className="skills-review-title">Skills in this request</h4>
  <ul className="skills-review-list">
   {review.loaded.map(s=><li key={'l'+s.name}>
    <span className="skills-review-name">{s.name}</span> <span className="skills-review-est">about {count(s.tokens)} tokens (estimate)</span>
    {s.truncated&&<span className="skills-review-state"> · Cut to fit the size limits</span>}
   </li>)}
   {review.skipped.map(s=><li key={'s'+s.name}>
    <span className="skills-review-name">{s.name}</span> <span className="skills-review-state">Left out: {WHY[s.reason]}</span>
   </li>)}
   {review.missing.map(id=><li key={'m'+id}><span className="skills-review-state">A skill you attached is not installed (id {id}). Nothing from it is sent.</span></li>)}
  </ul>
  <p className="skills-review-note">The exact text is in the instructions below.</p>
 </section>;
}
