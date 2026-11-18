export function ReviewedHistory({text,summary='Reviewed history for the fresh context'}:{text:string;summary?:string}){
 return <details className="chat-reviewed-history"><summary>{summary}</summary><pre>{text}</pre></details>;
}
