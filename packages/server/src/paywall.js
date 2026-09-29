// paywall(opts, handler) — Express-style middleware factory.
// Works with Express out of the box (uses only req.method/url/headers,
// res.status().json()/set()). Thin adapters for Fastify/Next.js below.
//
// opts: { price: "0.01" (human units), asset: "USDV"|"USDC"|address,
//         payTo: "0x…", facilitatorUrl, settleMode: "sync"|"optimistic",
//         description?, maxTimeoutSeconds? (default 60),
//         settlementAddress? (for USDC path, echoed in extra),
//         fetchFn? (default global fetch, injectable in tests) }
import { SVP_TESTNET, resolveAsset, toBaseUnits, resourceHashFor, b64e, b64d } from './common.js';

export function buildRequirements(opts, resource) {
  const asset = resolveAsset(opts.asset);
  const amount = toBaseUnits(opts.price, asset.decimals);
  const maxTimeoutSeconds = opts.maxTimeoutSeconds ?? 60;
  const extra = asset.eip3009
    ? { assetTransferMethod: 'eip3009', name: asset.eip712.name, version: asset.eip712.version }
    : { assetTransferMethod: 'settlement', settlement: opts.settlementAddress ?? null };
  // v1 body (project spec §5): exact + maxAmountRequired + resource in accepts.
  const v1 = {
    x402Version: 1,
    error: 'Payment required to access this resource',
    accepts: [{
      scheme: 'exact',
      network: SVP_TESTNET.legacyNetwork,
      maxAmountRequired: amount,
      resource,
      description: opts.description ?? `Access to ${resource}`,
      mimeType: 'application/json',
      payTo: opts.payTo,
      maxTimeoutSeconds,
      asset: asset.address,
      extra,
    }],
  };
  // v2 header (Coinbase compat): CAIP-2 + amount + PAYMENT-REQUIRED.
  const v2 = {
    x402Version: 2,
    error: 'PAYMENT-SIGNATURE header is required',
    resource: { url: resource, description: opts.description ?? '', mimeType: 'application/json' },
    accepts: [{
      scheme: 'exact', network: SVP_TESTNET.caip2, amount,
      asset: asset.address, payTo: opts.payTo, maxTimeoutSeconds, extra,
    }],
  };
  const paymentRequirements = v2.accepts[0]; // facilitator speaks v2
  return { v1, v2, paymentRequirements, asset, amount, maxTimeoutSeconds };
}

/// Normalize client payment headers (v1 X-PAYMENT or v2 PAYMENT-SIGNATURE)
///
/// -> { paymentPayload, scheme } or null when absent/invalid.
export function parsePaymentHeader(headers) {
  const h = headers ?? {};
  const raw = h['x-payment'] ?? h['X-PAYMENT'] ?? h['payment-signature'] ?? h['PAYMENT-SIGNATURE'];
  if (!raw) return null;
  try {
    const p = b64d(raw);
    if (p.scheme && p.payload) return { paymentPayload: { accepted: { scheme: p.scheme }, payload: p.payload }, v: 1 };
    if (p.accepted && p.payload) return { paymentPayload: p, v: 2 };
    return null;
  } catch {
    return null;
  }
}

export function paywall(opts, handler) {
  const fetchFn = opts.fetchFn ?? fetch;
  const facilitatorUrl = (opts.facilitatorUrl ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
  const settleMode = opts.settleMode ?? 'sync';
  if (!opts.payTo) throw new Error('paywall: payTo required');

  return async function paywallMiddleware(req, res, next) {
    const resource = req.originalUrl ?? req.url;
    const { v1, v2, paymentRequirements } = buildRequirements(opts, resource);
    const parsed = parsePaymentHeader(req.headers);

    if (!parsed) {
      res.set('PAYMENT-REQUIRED', b64e(v2));
      return res.status(402).json(v1);
    }

    const verifyRes = await fetchFn(`${facilitatorUrl}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: parsed.paymentPayload,
        paymentRequirements,
      }),
    });
    const check = await verifyRes.json();
    if (!check.isValid) {
      res.set('PAYMENT-REQUIRED', b64e(v2));
      return res.status(402).json({ ...v1, error: `Invalid payment: ${check.invalidReason}` });
    }

    const doSettle = () => fetchFn(`${facilitatorUrl}/settle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: parsed.paymentPayload,
        paymentRequirements,
      }),
    }).then((r) => r.json()).catch((e) => ({ success: false, error: String(e.message) }));

    let receipt = null;
    if (settleMode === 'sync') {
      receipt = await doSettle();
      if (!receipt?.success) {
        return res.status(402).json({ ...v1, error: `Settlement failed: ${receipt?.error}` });
      }
    }

    const data = await handler(req, { payer: parsed.paymentPayload.payload?.authorization?.from ?? null });
    const envelope = { data, payment: receipt ? { txHash: receipt.txHash, networkId: receipt.networkId } : undefined };
    if (receipt?.txHash) {
      res.set('X-PAYMENT-RESPONSE', b64e({ txHash: receipt.txHash }));
      res.set('PAYMENT-RESPONSE', b64e({ txHash: receipt.txHash, networkId: receipt.networkId }));
    }
    if (settleMode === 'optimistic') {
      doSettle().then((r) => { if (r?.txHash) res.set('PAYMENT-RESPONSE', b64e(r)); }).catch(() => {});
    }
    return res.json(envelope);
  };
}

/// Fastify: app.get('/api/price', { preHandler: paywallFastify(opts) }, handler)
export function paywallFastify(opts, handler) {
  const mw = paywall(opts, async (req) => handler(req));
  return async (req, reply) => {
    const res = {
      _headers: {},
      set(k, v) { this._headers[k] = v; reply.header(k, v); return this; },
      status(c) { this._code = c; reply.code(c); return this; },
      json(b) { reply.send(b); },
    };
    await mw({ method: req.method, url: req.url, originalUrl: req.url, headers: req.headers }, res, () => {});
  };
}

/// Next.js App Router: export const GET = paywallNext(opts, async () => Response.json({...}))
export function paywallNext(opts, handler) {
  const mw = paywall(opts, async (req) => handler(req));
  return async (request) => {
    let out;
    const res = {
      set(k, v) { (this._h ??= {})[k] = v; return this; },
      status(c) { this._code = c; return this; },
      json(b) { out = { status: this._code ?? 200, headers: this._h ?? {}, body: b }; },
    };
    const req = {
      method: request.method,
      url: new URL(request.url).pathname,
      headers: Object.fromEntries(request.headers.entries()),
    };
    await mw(req, res, () => {});
    return new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: { 'Content-Type': 'application/json', ...out.headers },
    });
  };
}

export { resourceHashFor };
