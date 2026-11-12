import type {Backlink} from '../api.ts';

/** The notes that cite this one, in the note's "..." menu: where each link is, and one click to open it. */
export function BacklinksPanel({items,onOpen}:{items:Backlink[];onOpen:(path:string)=>void}){
 return <section className="backlinks" aria-label="Backlinks">
  <h2>Backlinks <span className="backlinks-count">{items.length}</span></h2>
  {items.length===0
   ?<p className="backlinks-empty">None yet. Type @ in another note to cite this one.</p>
   :<ul>{items.map(b=><li key={b.path}><button type="button" onClick={()=>onOpen(b.path)}>
     <span className="backlink-title">{b.title}</span><span className="backlink-meta">{b.path} · {b.count} {b.count===1?'link':'links'}</span>
     {b.snippet&&<span className="backlink-snippet">{b.snippet}</span>}
    </button></li>)}</ul>}
 </section>;
}
