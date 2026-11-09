// Only this lazy module owns the English data. No dictionary, WASM or remote service at startup.
// dictionary-en's public JS entry uses node:fs; import its installed data files directly for the browser.
import aff from '../../node_modules/dictionary-en/index.aff?raw';
import dic from '../../node_modules/dictionary-en/index.dic?raw';
import {createDictionaryCorrector} from './smart-dictionary.ts';
export const ready=createDictionaryCorrector(aff,dic);
