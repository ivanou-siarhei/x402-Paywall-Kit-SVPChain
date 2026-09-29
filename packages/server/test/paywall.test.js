import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paywall, buildRequirements, resourceHashFor } from '../src/index.js';

const PAY_TO = '0x1111111111111111111111111111111111111111';

function fakeRes() {
  return {
    headers: {}, code: 200, body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const req = (headers = {}) => ({ method: 'GET', url: '/api/price', headers });

test('no payment -> 402 with v1 body + v2 header', async () => {
  const mw = paywall({ price: '0.01', asset: 'USDV', payTo: PAY_TO, fetchFn: async () => { throw new Error('no call'); } });
  const res = fakeRes();
  await mw(req(), res, () => {});
  assert.equal(res.code, 402);
  assert.equal(res.body.x402Version, 1);
  assert.equal(res.body.accepts[0].maxAmountRequired, '10000'); // 0.01 * 1e6
  assert.equal(res.body.accepts[0].asset, '0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951');
  assert.ok(res.headers['PAYMENT-REQUIRED']);
});

test('valid payment (sync) -> handler runs + receipt header', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push(url);
    const body = url.endsWith('/verify')
      ? { isValid: true, path: 'settlement' }
      : { success: true, txHash: '0xabc', networkId: 'eip155:2517' };
    return { json: async () => body };
  };
  const mw = paywall({
    price: '0.01', asset: 'USDC', payTo: PAY_TO, fetchFn,
    settlementAddress: '0x00000000000000000000000000000000000000A9',
  }, async () => ({ price: 42 }));
  const { b64e } = await import('../src/common.js');
  const payment = b64e({ x402Version: 1, scheme: 'exact', network: 'svp-testnet', payload: { signature: '0x', authorization: {} } });
  const res = fakeRes();
  await mw(req({ 'x-payment': payment }), res, () => {});
  assert.deepEqual(calls, ['http://127.0.0.1:3001/verify', 'http://127.0.0.1:3001/settle']);
  assert.equal(res.code, 200);
  assert.equal(res.body.payment.txHash, '0xabc');
  assert.ok(res.headers['X-PAYMENT-RESPONSE']);
});

test('invalid payment -> 402 with reason', async () => {
  const fetchFn = async () => ({ json: async () => ({ isValid: false, invalidReason: 'amount mismatch' }) });
  const mw = paywall({ price: '0.01', asset: 'USDV', payTo: PAY_TO, fetchFn });
  const { b64e } = await import('../src/common.js');
  const res = fakeRes();
  await mw(req({ 'payment-signature': b64e({ x402Version: 2, accepted: {}, payload: {} }) }), res, () => {});
  assert.equal(res.code, 402);
  assert.match(res.body.error, /amount mismatch/);
});

test('resourceHashFor binds method+path (ignores query)', async () => {
  const a = resourceHashFor('GET', '/api/price?x=1');
  const b = resourceHashFor('get', '/api/price');
  assert.equal(a, b);
  assert.notEqual(a, resourceHashFor('POST', '/api/price'));
  // pinned cross-language value (python/tests/test_client.py asserts the same)
  assert.equal(a, '0xa92981978b949f943cd2da1b28a9ea8f383dfd313972e68dcef27a8918102975');
});

test('buildRequirements USDC extra carries settlement address', async () => {
  const { paymentRequirements } = buildRequirements(
    { price: '1', asset: 'USDC', payTo: PAY_TO, settlementAddress: '0xS' }, '/api/x',
  );
  assert.equal(paymentRequirements.extra.assetTransferMethod, 'settlement');
});
