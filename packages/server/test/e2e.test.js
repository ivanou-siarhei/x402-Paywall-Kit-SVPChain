// E2E: SvpPayingClient -> node:http -> paywall(USDC, optimistic) -> facilitator /verify.
// Settle itself stays queued (no FACILITATOR_KEY / no deployed settlement) —
// proves the full 402 -> sign -> verify -> data loop with real signatures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ethers } from 'ethers';

process.env.FACILITATOR_LISTEN = '0';
process.env.SETTLEMENT_ADDRESS = '0x00000000000000000000000000000000000000A9';
process.env.SETTLE_MODE = 'optimistic';

const { app: facApp } = await import('../../facilitator/src/index.js');
const { paywall } = await import('../src/index.js');
const { SvpPayingClient } = await import('../../client/src/index.js');

const PAY_TO = '0x1111111111111111111111111111111111111111';

test('e2e: client pays USDC paywall and reads data', async () => {
  const facServer = facApp.listen(0);
  await new Promise((r) => facServer.on('listening', r));
  const facUrl = `http://127.0.0.1:${facServer.address().port}`;

  const mw = paywall({
    price: '0.01', asset: 'USDC', payTo: PAY_TO,
    facilitatorUrl: facUrl, settleMode: 'optimistic',
    settlementAddress: process.env.SETTLEMENT_ADDRESS,
  }, async () => ({ price: 123.45 }));

  const srv = http.createServer((nodeReq, nodeRes) => {
    let body = '';
    nodeReq.on('data', (c) => (body += c));
    nodeReq.on('end', async () => {
      const res = {
        set(k, v) { nodeRes.setHeader(k, v); return this; },
        status(c) { nodeRes.statusCode = c; return this; },
        json(b) { nodeRes.setHeader('Content-Type', 'application/json'); nodeRes.end(JSON.stringify(b)); },
      };
      await mw({ method: nodeReq.method, url: nodeReq.url, headers: nodeReq.headers }, res, () => {});
    });
  });
  srv.listen(0);
  await new Promise((r) => srv.on('listening', r));
  const apiUrl = `http://127.0.0.1:${srv.address().port}/api/price`;

  const payer = ethers.Wallet.createRandom();
  const client = new SvpPayingClient({ signer: payer });
  const res = await client.get(apiUrl);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.price, 123.45);

  // optimistic settle lands in background — poll
  let pending = 0;
  for (let i = 0; i < 30 && pending !== 1; i++) {
    await new Promise((r) => setTimeout(r, 100));
    pending = (await (await fetch(`${facUrl}/health`)).json()).pending;
  }
  assert.equal(pending, 1); // optimistic settle queued

  srv.closeAllConnections?.();
  facServer.closeAllConnections?.();
  srv.close();
  facServer.close();
});
