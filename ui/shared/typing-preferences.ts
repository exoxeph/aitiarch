// Personal spelling choices contain words only, never document text or arbitrary JSON.
export function validNeverCorrect(value:unknown):value is string[]{return Array.isArray(value)&&value.length<=10000&&value.every(word=>typeof word==='string'&&/^[a-z]{1,64}(?:['’][a-z]{1,16})?$/.test(word));}
