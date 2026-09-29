// Hackathon demo (spec §11, 3 min): agent builds a market summary by buying
// paid APIs. 402 -> pay USDV -> dashboard revenue grows. Budget breach rejected.
// Settle stays optimistic-queued (no hot wallet in demo); on-chain ≥50 tx is Etapa 7.
import http from 'node:http';
import { ethers } from 'ethers';

process.env.FACILITATOR_LISTEN = '0';
process.env.SETTLEMENT_ADDRESS = '0x00000000000000000000000000000000000000A9';
process.env.SETTLE_MODE = 'optimistic';
process.env.LISTEN = '0';

const { app: facApp } = await import('../../facilitator/src/index.js');
const { SvpPayingClient } = await import('../../client/src/index.js');

const fac = facApp.listen(0);
await new Promise((r) => fac.on('listening', r));
process.env.FACILITATOR_URL = `http://127.0.0.1:${fac.address().port}`;

// NOTE: server.js reads FACILITATOR_URL at import time — import after env is set.
const { server: apiServer } = await import('./server.js');

apiServer.listen(0);
await new Promise((r) => apiServer.on('listening', r));
const API = `http://127.0.0.1:${apiServer.address().port}`;
const pay = async (path) => (await fetch(`${API}${path}`));

console.log('1. Agent requests /api/price without payment...');
console.log('   ->', (await pay('/api/price')).status, '(402 Payment Required)');

console.log('2. Agent pays 0.01 USDV x3 and builds the summary...');
const agent = new SvpPayingClient({ signer: ethers.Wallet.createRandom(), maxPerCall: '0.05', dailyBudget: '2' });
for (let i = 0; i < 3; i++) {
  const r = await agent.get(`${API}/api/price`);
  const j = await r.json();
  console.log(`   call ${i + 1}: ${r.status}, btc=${j.data.btc}`);
}

console.log('3. Seller revenue grows (facilitator queue)...');
let pending = 0;
for (let i = 0; i < 30 && pending !== 3; i++) {
  await new Promise((r) => setTimeout(r, 100));
  pending = (await (await fetch(`${process.env.FACILITATOR_URL}/health`)).json()).pending;
}
console.log('   queued settlements:', pending);
if (pending !== 3) { console.log('   ERROR: expected 3'); process.exitCode = 1; }

console.log('4. Greedy request (maxPerCall 0.001) is rejected locally...');
const greedy = new SvpPayingClient({ signer: ethers.Wallet.createRandom(), maxPerCall: '0.001' });
try {
  await greedy.get(`${API}/api/price`);
  console.log('   ERROR: should have thrown');
  process.exitCode = 1;
} catch (e) {
  console.log('   rejected:', e.message);
}

apiServer.closeAllConnections?.(); fac.closeAllConnections?.();
apiServer.close(); fac.close();
console.log('DEMO OK');
