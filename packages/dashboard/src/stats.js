// Pure stats helpers (tested with node:test — no DOM).
export const DECIMALS = 6; // USDV + USDC on SVP testnet

export function human(baseUnits) {
  return Number(baseUnits) / 10 ** DECIMALS;
}

/// Group payments by UTC day: [{ day: 'YYYY-MM-DD', total, count }]
export function totalsByDay(payments) {
  const map = new Map();
  for (const p of payments) {
    const day = new Date(p.ts).toISOString().slice(0, 10);
    const e = map.get(day) ?? { day, total: 0n, count: 0 };
    e.total += BigInt(p.amount);
    e.count += 1;
    map.set(day, e);
  }
  return [...map.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map(({ day, total, count }) => ({ day, total: total.toString(), count }));
}

/// Top payers: [{ from, total, count }] sorted desc, optional asset filter.
export function topPayers(payments, asset = null, limit = 10) {
  const map = new Map();
  for (const p of payments) {
    if (asset && p.asset !== asset) continue;
    const e = map.get(p.from) ?? { from: p.from, total: 0n, count: 0 };
    e.total += BigInt(p.amount);
    e.count += 1;
    map.set(p.from, e);
  }
  return [...map.values()]
    .sort((a, b) => (a.total > b.total ? -1 : 1))
    .slice(0, limit)
    .map(({ from, total, count }) => ({ from, total: total.toString(), count }));
}

export function filterByAsset(payments, asset) {
  if (!asset || asset === 'ALL') return payments;
  return payments.filter((p) => p.asset === asset);
}
