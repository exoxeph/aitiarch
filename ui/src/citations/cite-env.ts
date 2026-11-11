// What an editor pane needs to know to treat @ links as citations: which note it is, which notes exist, and how to open or preview one.
// Provided per pane through a compartment, so a new note list rebuilds the chips. Nothing here edits the document.
import {Facet} from '@codemirror/state';
import type {CiteNote} from './citation-model.ts';

export interface CiteEnv {
 /** The note this pane shows: citations are relative to it. */
 from:string;
 has(path:string):boolean;
 open(path:string,heading:string|null):void;
 notes():Promise<CiteNote[]>;
 preview(path:string):Promise<string|null>;
}
export const citeEnv=Facet.define<CiteEnv,CiteEnv|null>({combine:v=>v[0]??null});
