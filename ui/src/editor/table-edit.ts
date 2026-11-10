// Pure text operations for editing a GFM table in place. Everything works on the original Markdown lines and returns plain changes
// (never a re-serialised table), so spacing, alignment markers and any quote prefix are preserved byte for byte outside the edit.
import type {ChangeSpec, Text} from '@codemirror/state';

export interface Cell {from:number;to:number}
export interface TableLine {from:number;to:number;text:string}

const QUOTE=/^(?:[ \t]{0,3}>[ \t]?)*/;
/** Cell ranges of one row, relative to the line start: the text between the pipes (surrounding spaces included). */
export function splitRow(line:string):Cell[]{
 const start=QUOTE.exec(line)![0].length,pipes:number[]=[];
 for(let i=start;i<line.length;i++){const ch=line[i];if(ch==='\\'){i++;continue;}if(ch==='|')pipes.push(i);}
 const firstSolid=line.slice(start).search(/\S/)+start,lastSolid=line.trimEnd().length-1;
 const lead=pipes.length>0&&pipes[0]===firstSolid,trail=pipes.length>(lead?1:0)&&pipes[pipes.length-1]===lastSolid;
 const seps=[...(lead?[]:[start-1]),...pipes,...(trail?[]:[line.length])];
 const cells:Cell[]=[];for(let i=0;i+1<seps.length;i++)cells.push({from:seps[i]+1,to:seps[i+1]});
 return cells;
}
/** The lines of the table that spans [from, to] in the document. */
export function tableLines(doc:Text,from:number,to:number):TableLine[]{
 const a=doc.lineAt(from).number,b=doc.lineAt(Math.min(to,doc.length)).number,out:TableLine[]=[];
 for(let n=a;n<=b;n++){const l=doc.line(n);out.push({from:l.from,to:l.to,text:l.text});}
 return out;
}
/** Text as it is stored in a cell: one line, `|` escaped, trimmed. */
export const escapeCell=(raw:string)=>raw.replace(/\s*\n\s*/g,' ').replace(/(\\.)|\|/g,(m,esc)=>esc??'\\|').trim();
/** The text of a cell as the author wrote it (escapes kept), trimmed. */
export function cellText(line:TableLine,col:number):string{const c=splitRow(line.text)[col];return c?line.text.slice(c.from,c.to).trim():'';}
export const columnCount=(lines:TableLine[])=>splitRow(lines[0].text).length;

/** Replace the text of one cell (line index 0 is the header, 1 the delimiter row, 2 and up the body). */
export function setCell(lines:TableLine[],lineIndex:number,col:number,raw:string):ChangeSpec|null{
 const line=lines[lineIndex],c=line?splitRow(line.text)[col]:undefined;if(!c)return null;
 const text=escapeCell(raw),next=text?` ${text} `:'  ';
 return line.text.slice(c.from,c.to)===next?null:{from:line.from+c.from,to:line.from+c.to,insert:next};
}
/** A new empty body row after the last line. */
export function addRow(lines:TableLine[]):ChangeSpec{
 const last=lines[lines.length-1],prefix=QUOTE.exec(last.text)![0],n=columnCount(lines);
 return {from:last.to,insert:'\n'+prefix+'|'+Array(n).fill('  ').join('|')+'|'};
}
/** A new column on the right: a header name, a delimiter and empty cells. */
export function addColumn(lines:TableLine[]):ChangeSpec[]{
 const n=columnCount(lines);
 return lines.map((line,i)=>{
  const cell=i===0?` Column ${n+1} `:i===1?' --- ':'  ',at=line.from+line.text.trimEnd().length,closed=/(?<!\\)\|\s*$/.test(line.text);
  return {from:at,insert:closed?cell+'|':' |'+cell};
 });
}
/** Remove a body row. The header and delimiter rows stay. */
export function deleteRow(lines:TableLine[],lineIndex:number):ChangeSpec|null{
 if(lineIndex<2||lineIndex>=lines.length)return null;
 const line=lines[lineIndex];return {from:line.from-1,to:line.to};
}
/** Remove one column from every row. The last remaining column cannot be removed. */
export function deleteColumn(lines:TableLine[],col:number):ChangeSpec[]|null{
 if(columnCount(lines)<2||col<0||col>=columnCount(lines))return null;
 return lines.flatMap(line=>{
  const c=splitRow(line.text)[col];if(!c)return [];
  return line.text[c.to]==='|'?[{from:line.from+c.from,to:line.from+c.to+1}]:[{from:line.from+c.from-1,to:line.from+c.to}];
 });
}
/** A starter table for the slash menu: three columns, two empty rows. */
export const STARTER_TABLE='| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';
