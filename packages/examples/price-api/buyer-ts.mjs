// TS buyer agent: buys /api/price within budget (spec §8 DX goal).
// Run: API=http://127.0.0.1:3100 node buyer-ts.mjs
import { ethers } from 'ethers';
import { SvpPayingClient } from '../../client/src/index.js';

const API = process.env.API || 'http://127.0.0.1:3100';
const payer = new ethers.Wallet(process.env.PAYER_KEY || ethers.Wallet.createRandom().privateKey);
const client = new SvpPayingClient({ signer: payer, maxPerCall: '0.05', dailyBudget: '2' });

for (let i = 0; i < 3; i++) {
  const res = await client.get(`${API}/api/price`);
  console.log(`call ${i + 1}:`, res.status, JSON.stringify(await res.json()).slice(0, 120));
}
