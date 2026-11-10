/** Deterministic insertion gate; returns categories only, never matched values. */
export function secretKinds(text:string):('private_key'|'key_like')[]{
 const kinds:('private_key'|'key_like')[]=[];
 if(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(text))kinds.push('private_key');
 if(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{25,})\b/.test(text)
  ||/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_+\/-]{12,}/i.test(text)
  ||/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\b(?:xox[baprs]-|glpat-)[A-Za-z0-9_-]{16,}/.test(text))kinds.push('key_like');
 return kinds;
}
