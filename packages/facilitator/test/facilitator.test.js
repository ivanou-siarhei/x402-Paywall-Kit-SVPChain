import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

process.env.FACILITATOR_LISTEN = '0';
process.env.SETTLEMENT_ADDRESS = '0x00000000000000000000000000000000000000A9';

const { app } = await import('../src/index.js');
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (p, b) => (await fetch(base + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
})).json();

const USDV = '0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951';
const USDC = '0x732F6Ea7AfD5EdC02e7ba052075dd0780e285489';

test('GET /supported lists 2517 + USDV/USDC', async () => {
  const r = await (await fetch(base + '/supported')).json();
  assert.equal(r.networks[0], 'eip155:2517');
  assert.deepEqual(r.schemes, ['exact']);
  const syms = r.assets.map((a) => a.symbol).sort();
  assert.deepEqual(syms, ['USDC', 'USDV']);
});

test('POST /verify settlement-path: valid signature passes (USDC)', async () => {
  const payer = ethers.Wallet.createRandom();
  const payTo = ethers.Wallet.createRandom().address;
  const auth = {
    from: payer.address, to: payTo, asset: USDC, amount: '10000',
    nonce: ethers.id('t1'), validBefore: Math.floor(Date.now() / 1000) + 300,
    resourceHash: ethers.id('GET /api/data'),
  };
  const sig = await payer.signTypedData(
    { name: 'Svp402Settlement', version: '1', chainId: 2517, verifyingContract: process.env.SETTLEMENT_ADDRESS },
    { PaymentAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }, { name: 'validBefore', type: 'uint64' },
      { name: 'resourceHash', type: 'bytes32' },
    ] },
    auth,
  );
  const r = await post('/verify', {
    x402Version: 2,
    paymentPayload: { accepted: { scheme: 'exact' }, payload: { signature: sig, authorization: auth } },
    paymentRequirements: {
      scheme: 'exact', network: 'eip155:2517', amount: '10000',
      asset: USDC, payTo, maxTimeoutSeconds: 60,
    },
  });
  assert.equal(r.isValid, true, JSON.stringify(r));
  assert.equal(r.path, 'settlement');
});

test('POST /verify: amount mismatch rejected', async () => {
  const payer = ethers.Wallet.createRandom();
  const payTo = ethers.Wallet.createRandom().address;
  const auth = {
    from: payer.address, to: payTo, asset: USDC, amount: '10000',
    nonce: ethers.id('t2'), validBefore: Math.floor(Date.now() / 1000) + 300,
    resourceHash: ethers.id('r'),
  };
  const sig = await payer.signTypedData(
    { name: 'Svp402Settlement', version: '1', chainId: 2517, verifyingContract: process.env.SETTLEMENT_ADDRESS },
    { PaymentAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }, { name: 'validBefore', type: 'uint64' },
      { name: 'resourceHash', type: 'bytes32' },
    ] },
    auth,
  );
  const r = await post('/verify', {
    x402Version: 2,
    paymentPayload: { accepted: { scheme: 'exact' }, payload: { signature: sig, authorization: auth } },
    paymentRequirements: {
      scheme: 'exact', network: 'eip155:2517', amount: '9999',
      asset: USDC, payTo, maxTimeoutSeconds: 60,
    },
  });
  assert.equal(r.isValid, false);
  assert.match(r.invalidReason, /amount mismatch/);
});

test('POST /verify eip3009-path: valid USDV authorization passes', async () => {
  const payer = ethers.Wallet.createRandom();
  const payTo = ethers.Wallet.createRandom().address;
  const auth = {
    from: payer.address, to: payTo, value: '10000',
    validAfter: String(Math.floor(Date.now() / 1000) - 10),
    validBefore: String(Math.floor(Date.now() / 1000) + 55),
    nonce: ethers.id('e1'),
  };
  const sig = await payer.signTypedData(
    { name: 'VanToken', version: '1.2.0', chainId: 2517, verifyingContract: USDV },
    { TransferWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] },
    auth,
  );
  const r = await post('/verify', {
    x402Version: 2,
    paymentPayload: {
      accepted: { scheme: 'exact', extra: { assetTransferMethod: 'eip3009' } },
      payload: { signature: sig, authorization: auth },
    },
    paymentRequirements: {
      scheme: 'exact', network: 'eip155:2517', amount: '10000',
      asset: USDV, payTo, maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: 'eip3009', name: 'VanToken', version: '1.2.0' },
    },
  });
  assert.equal(r.isValid, true, JSON.stringify(r));
  assert.equal(r.path, 'eip3009');
});

test('POST /settle without FACILITATOR_KEY fails cleanly', async () => {
  const payer = ethers.Wallet.createRandom();
  const payTo = ethers.Wallet.createRandom().address;
  const auth = {
    from: payer.address, to: payTo, asset: USDC, amount: '10000',
    nonce: ethers.id('t3'), validBefore: Math.floor(Date.now() / 1000) + 300,
    resourceHash: ethers.id('r'),
  };
  const sig = await payer.signTypedData(
    { name: 'Svp402Settlement', version: '1', chainId: 2517, verifyingContract: process.env.SETTLEMENT_ADDRESS },
    { PaymentAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }, { name: 'validBefore', type: 'uint64' },
      { name: 'resourceHash', type: 'bytes32' },
    ] },
    auth,
  );
  const res = await fetch(base + '/settle', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: { accepted: { scheme: 'exact' }, payload: { signature: sig, authorization: auth } },
      paymentRequirements: {
        scheme: 'exact', network: 'eip155:2517', amount: '10000',
        asset: USDC, payTo, maxTimeoutSeconds: 60,
      },
    }),
  });
  assert.equal(res.status, 402);
  const r = await res.json();
  assert.equal(r.success, false);
  assert.match(r.error, /FACILITATOR_KEY|SETTLEMENT_ADDRESS/);
  server.close();
});
