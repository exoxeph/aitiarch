import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {investigateLine,turnsWord,unreportedText,usd} from '../src/chat/investigate-usage.ts';
import {UsageView} from '../src/UsagePanel.tsx';
import type {InvestigateUsage,UsageSummary} from '../shared/usage.ts';

// How Investigate's usage reads: its own line in the chat footer and its own section in the usage panels, always labelled Investigate, never inside a chat budget.
const sum:InvestigateUsage={turns:6,input:17000,cached:3200,output:900,costUsd:0.4234,unreportedTurns:0};
const summary=(over:Partial<UsageSummary>={}):UsageSummary=>({since:new Date().toISOString(),hourlyCap:2,providers:[],...over});

describe('the Investigate wording',()=>{
 it('formats money quietly',()=>{expect(usd(0)).toBe('$0');expect(usd(0.0123)).toBe('$0.012');expect(usd(0.4)).toBe('$0.40');expect(usd(12)).toBe('$12.00');});
 it('says turns in the singular and the plural',()=>{expect(turnsWord(1)).toBe('1 turn');expect(turnsWord(0)).toBe('0 turns');expect(turnsWord(6)).toBe('6 turns');});
 it('is one footer line, labelled Investigate, with the cost',()=>{expect(investigateLine(sum)).toBe('Investigate: 6 turns · 17k in · 3.2k cached · 900 out · $0.42');});
 it('says when some turns did not report every count, instead of counting them as zero',()=>{
  expect(unreportedText(sum)).toBe('');
  expect(investigateLine({...sum,unreportedTurns:2})).toBe('Investigate: 6 turns · 17k in · 3.2k cached · 900 out · $0.42 (2 turns did not report every count)');
  expect(unreportedText({...sum,unreportedTurns:1})).toBe('1 turn did not report every count');
 });
});

describe('the usage panel',()=>{
 it('shows an Investigate section, separate from the chat budgets, only when there are Investigate turns',()=>{
  const without=renderToStaticMarkup(<UsageView summary={summary()}/>);expect(without).not.toContain('Investigate');
  const html=renderToStaticMarkup(<UsageView summary={summary({investigate:sum,chats:[{note:'plan.md',calls:2,input:30,cached:4,output:12,unreportedCalls:0,spent:42,reserved:0,tokenBudget:50000,rollingRequestCap:12,windowMinutes:60}]})}/>);
  expect(html).toContain('<h3>Investigate</h3>');expect(html).toContain('aria-label="Investigate usage"');
  for(const cell of ['<td>6</td>','<td>17k</td>','<td>3.2k</td>','<td>900</td>','<td>$0.42</td>'])expect(html,cell).toContain(cell);
  expect(html).toContain('Not part of any chat&#x27;s token budget');
  expect(html.indexOf('Per-note chat budgets')).toBeLessThan(html.indexOf('<h3>Investigate</h3>')); // its own section, after the chat budgets, not a row in them
  expect(html.split('plan.md').length-1).toBe(1); // no Investigate row in the chat budget table
 });
 it('names the turns that did not report every count',()=>{expect(renderToStaticMarkup(<UsageView summary={summary({investigate:{...sum,unreportedTurns:1}})}/>)).toContain('1 turn did not report every count');});
});
