import type {ReviewedCodexSkill} from '../../shared/invocation.ts';

export function CodexSkillsReview({skills}:{skills?:readonly ReviewedCodexSkill[]}){
 if(!skills?.length)return null;
 return <div className="small">
  <p>Codex receives these skill instructions for this send.</p>
  <ul>{skills.map(skill=><li key={skill.pathHash}>
   {skill.name} · {skill.classification}{skill.truncated?' · truncated':''}<br/>
   <code style={{overflowWrap:'anywhere'}}>{skill.contentHash}</code>
  </li>)}</ul>
 </div>;
}
