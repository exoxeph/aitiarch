import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createProvider, prepareRequest, type Configuration } from '../server/providers/index.ts';
import { assessCapabilities } from '../server/providers/capabilities.ts';
import { validateProductResult } from '../server/product-validation.ts';
import { textHash } from '../server/anchor-cache.ts';
import { redact } from '../server/providers/index.ts';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })));
const script = fileURLToPath(new URL('./fixtures/provider-cli.mjs', import.meta.url));
const request = { id: 'product', action: 'think' as const, question: '', selection: 'Synthetic.', note: 'Synthetic.', decisions: [], turns: [] };
const config = (scenario: string): Configuration => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aitiarch-verified-fake-')); roots.push(dir);
  return { provider: 'claude', command: process.execPath, prefixArgs: [script, scenario, path.join(dir, 'record'), 'claude'],
    contract: 'claude-canary-2.1.205' as Configuration['contract'],failureLog:{write:async()=>{}} };
};
it('accepts the canary-verified Claude profile only after checking flags and structured registries', async () => {
  const cli = createProvider(config('verified-success'));
  expect(await cli.checkAvailability()).toMatchObject({ available: true });
  expect(await cli.invoke(request)).toMatchObject({ answer: 'Answer for product', usage: { inputTokens: 12, outputTokens: 8 } });
});
for (const scenario of ['verified-tools', 'verified-hook', 'verified-hook-prefixed', 'verified-benign-subtype', 'verified-mcp', 'verified-plugin', 'verified-attempt', 'verified-incomplete', 'verified-unknown',
  'verified-fence-multiple','verified-fence-prose-before','verified-fence-prose-after','verified-fence-unclosed','verified-fence-in-string','verified-fence-wrong-keys','verified-thinking-text','verified-thinking-long']) {
  it(`rejects ${scenario} without accepting an answer`, async () => {
    await expect(createProvider(config(scenario)).invoke(request)).rejects.toMatchObject({ code: 'invalid_response' });
  });
}
it('accepts thinking_tokens by exact name with a valid numeric metadata payload',async()=>{
  await expect(createProvider(config('verified-thinking-numeric')).invoke(request)).resolves.toMatchObject({answer:'Answer for product'});
});
for(const scenario of ['verified-fence-json','verified-fence-bare']){
  it(`accepts only a single complete fenced JSON answer: ${scenario}`,async()=>{
    await expect(createProvider(config(scenario)).invoke(request)).resolves.toMatchObject({answer:'Answer for product',claims:[]});
  });
}
it('tightens Think to JSON only while preserving the rest of the existing contract',()=>{
  const think=prepareRequest(request).instruction;
  const ask=prepareRequest({...request,action:'ask',question:'Explain this.'}).instruction;
  expect(think).toContain('Return only one JSON object. No code fences or text before or after the JSON.');
  expect(think.replace('\nReturn only one JSON object. No code fences or text before or after the JSON.','')).toBe(ask);
});
it.each(['think','ask'] as const)('specifies the exact quote contract for %s',action=>{
  const prompt=prepareRequest({...request,action,question:action==='ask'?'Explain.':''}).instruction;
  expect(prompt).toContain('{"sourceId":"N1","quote":"<verbatim substring of source N1, at most 240 characters>"}');
  expect(prompt).toContain('The field is named exactly "quote"');
  expect(prompt).toContain('character for character from the named source');
  expect(prompt).toContain('No other fields are allowed in a claim.');
  expect(prompt).toContain('one JSON object with answer (string), claims (array), and optionally diagram');
});
it('accepts the exact quote key and rejects the field-names-only regression shape without renaming',()=>{
  const shape=JSON.parse(readFileSync(new URL('./fixtures/claim-field-names.json',import.meta.url),'utf8'));
  const source='A wholly synthetic sentence.';
  const base={id:'synthetic',provider:'claude' as const,model:null,answer:'Synthetic answer.',usage:null};
  const check=(claims:unknown[])=>validateProductResult({...base,claims},base.id,{note:source,decisions:[]},redact,textHash);
  expect(check([{sourceId:'N1',quote:source}]).evidence).toHaveLength(1);
  expect(shape.claimFields).toEqual([['sourceId','quotation'],['sourceId','quotation']]);
  for(const fields of shape.claimFields){
    const claim=Object.fromEntries(fields.map((field:string)=>[field,field==='sourceId'?'N1':source]));
    try{check([claim]);throw new Error('Must reject alias');}
    catch(error){expect(error).toMatchObject({record:{rule:'claim_quote_type'}});}
    expect(Object.hasOwn(claim,'quote')).toBe(false);
  }
});
it('accepts a newer CLI only with the same verified capability declarations and an untested notice', async () => {
  expect(await createProvider(config('verified-version-change')).checkAvailability()).toMatchObject({available:true,warnings:expect.arrayContaining(['untested version: tested 2.1.205, found 2.1.206'])});
});
it('recognizes the actual 2.1.205 hook lifecycle wording with wrapped lines', async () => {
  expect(await createProvider(config('verified-real-hook-wording')).checkAvailability()).toMatchObject({ available: true });
});
for (const scenario of ['verified-missing-hook-flag', 'verified-wrong-hook-meaning', 'verified-hook-mention-elsewhere']) {
  it(`fails closed for ${scenario} before sending context`, async () => {
    const cli = createProvider(config(scenario));
    expect(await cli.checkAvailability()).toMatchObject({ available: false, message: expect.stringContaining('--include-hook-events') });
    await expect(cli.invoke(request)).rejects.toMatchObject({ code: 'unsupported_cli' });
  });
}
