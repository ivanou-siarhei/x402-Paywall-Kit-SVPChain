import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalsByDay, topPayers, filterByAsset, human } from '../src/stats.js';

const P = [
  { from: '0xA', asset: 'USDV', amount: '10000', ts: Date.parse('2026-09-28T10:00:00Z') },
  { from: '0xB', asset: 'USDV', amount: '20000', ts: Date.parse('2026-09-28T12:00:00Z') },
  { from: '0xA', asset: 'USDC', amount: '50000', ts: Date.parse('2026-09-29T10:00:00Z') },
];

test('human converts 6-decimal base units', () => {
  assert.equal(human('10000'), 0.01);
});

test('totalsByDay groups by UTC day', () => {
  const rows = totalsByDay(P);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { day: '2026-09-28', total: '30000', count: 2 });
  assert.deepEqual(rows[1], { day: '2026-09-29', total: '50000', count: 1 });
});

test('topPayers sorts desc + filters by asset', () => {
  assert.deepEqual(topPayers(P, null).map((t) => t.from), ['0xA', '0xB']);
  assert.deepEqual(topPayers(P, 'USDV').map((t) => t.from), ['0xB', '0xA']);
});

test('filterByAsset ALL passthrough', () => {
  assert.equal(filterByAsset(P, 'ALL').length, 3);
  assert.equal(filterByAsset(P, 'USDC').length, 1);
});
