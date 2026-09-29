import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { SvpPayingClient, parse402 } from '../src/index.js';

const USDV = '0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951';
const USDC = '0x732F6Ea7AfD5EdC02e7ba052075dd0780e285489';
const PAY_TO = '0x1111111111111111111111111111111111111111';
const SETTLEMENT = '0x00000000000000000000000000000000000000A9';
const b64e = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

function res402(body) {
  return { status: 402, headers: { get: () => null }, json: async () => body };
}

test('v1 402 USDV -> pays via eip3009 and retries', async () => {
  const payer = ethers.Wallet.createRandom();
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, headers: init?.headers ?? {} });
    if (seen.length === 1) {
      return res402({
        x402Version: 1,
        accepts: [{ scheme: 'exact', network: 'svp-testnet', maxAmountRequired: '10000',
          resource: '/api/price', payTo: PAY_TO, maxTimeoutSeconds: 60, asset: USDV,
          extra: { assetTransferMethod: 'eip3009', name: 'VanToken', version: '1.2.0' } }],
      });
    }
    return { status: 200, json: async () => ({ data: { price: 1 } }) };
  };
  const c = new SvpPayingClient({ signer: payer, fetchFn });
  const r = await c.get('https://api.example.com/api/price');
  assert.equal(r.status, 200);
  const sent = JSON.parse(Buffer.from(seen[1].headers['PAYMENT-SIGNATURE'], 'base64').toString());
  assert.equal(sent.payload.authorization.from, payer.address);
  assert.equal(sent.payload.authorization.value, '10000');
  // signature must recover to payer under VanToken domain
  const rec = ethers.verifyTypedData(
    { name: 'VanToken', version: '1.2.0', chainId: 2517, verifyingContract: USDV },
    { TransferWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] },
    sent.payload.authorization, sent.payload.signature,
  );
  assert.equal(rec, payer.address);
});

test('v1 402 USDC -> pays via settlement (X-PAYMENT)', async () => {
  const payer = ethers.Wallet.createRandom();
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push(init?.headers ?? {});
    if (seen.length === 1) {
      return res402({
        x402Version: 1,
        accepts: [{ scheme: 'exact', network: 'svp-testnet', maxAmountRequired: '10000',
          resource: '/api/data', payTo: PAY_TO, maxTimeoutSeconds: 60, asset: USDC,
          extra: { assetTransferMethod: 'settlement', settlement: SETTLEMENT } }],
      });
    }
    return { status: 200, json: async () => ({ ok: true }) };
  };
  const c = new SvpPayingClient({ signer: payer, fetchFn });
  const r = await c.get('https://api.example.com/api/data');
  assert.equal(r.status, 200);
  assert.ok(seen[1]['X-PAYMENT']);
});

test('exceeding maxPerCall throws before signing', async () => {
  const payer = ethers.Wallet.createRandom();
  const fetchFn = async () => res402({
    x402Version: 1,
    accepts: [{ scheme: 'exact', network: 'svp-testnet', maxAmountRequired: '999999999',
      resource: '/api/x', payTo: PAY_TO, maxTimeoutSeconds: 60, asset: USDV, extra: {} }],
  });
  const c = new SvpPayingClient({ signer: payer, maxPerCall: '0.05', fetchFn });
  await assert.rejects(() => c.get('https://api.example.com/api/x'), /exceeds maxPerCall/);
});

test('daily budget enforced across calls', async () => {
  const payer = ethers.Wallet.createRandom();
  const fetchFn = async () => res402({
    x402Version: 1,
    accepts: [{ scheme: 'exact', network: 'svp-testnet', maxAmountRequired: '10000',
      resource: '/api/x', payTo: PAY_TO, maxTimeoutSeconds: 60, asset: USDV, extra: {} }],
  });
  // Mock retry as success to accumulate spend
  let n = 0;
  const fetchFn2 = async (url, init) => {
    n += 1;
    if (!init?.headers?.['PAYMENT-SIGNATURE']) return fetchFn(url, init);
    return { status: 200, json: async () => ({}) };
  };
  const c = new SvpPayingClient({ signer: payer, dailyBudget: '0.015', fetchFn: fetchFn2 });
  await c.get('https://api.example.com/api/x'); // spends 0.01
  await assert.rejects(() => c.get('https://api.example.com/api/x'), /exceeds dailyBudget/);
  assert.equal(n, 3); // second call: 402 fetched, retry blocked by budget (no extra fetch)
});

test('parse402 supports v2 header', async () => {
  const v2 = { x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:2517',
    amount: '500', asset: USDC, payTo: PAY_TO, maxTimeoutSeconds: 60, extra: {} }] };
  const req = parse402({ headers: { get: (k) => (k === 'payment-required' ? b64e(v2) : null) } }, null);
  assert.equal(req.amount, '500');
  assert.equal(req.v, 2);
});
