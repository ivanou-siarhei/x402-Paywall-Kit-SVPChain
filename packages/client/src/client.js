// @svp402/client — fetch wrapper that pays x402 paywalls automatically.
// Spec DX goal (§8): client = SvpPayingClient(signer, max_per_call, daily_budget); r = client.get(url).
import { ethers } from 'ethers';

const CHAIN_ID = 2517;
const KNOWN_ASSETS = {
  '0x013a61e622e6abfcab64f52d274c3fc0aa37f951': {
    symbol: 'USDV', decimals: 6, eip3009: true, eip712: { name: 'VanToken', version: '1.2.0' },
  },
  '0x732f6ea7afd5edc02e7ba052075dd0780e285489': {
    symbol: 'USDC', decimals: 6, eip3009: false },
};

const b64e = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const b64d = (s) => JSON.parse(Buffer.from(String(s), 'base64').toString('utf8'));

function assetInfo(address) {
  return KNOWN_ASSETS[String(address).toLowerCase()] ?? { symbol: 'CUSTOM', decimals: 6, eip3009: false };
}

function resourceHashFor(method, url) {
  const u = String(url);
  const pathname = u.startsWith('http') ? new URL(u).pathname : u.split('?')[0];
  return ethers.keccak256(ethers.toUtf8Bytes(`${String(method).toUpperCase()} ${pathname}`));
}

/// Parse 402 into normalized { amount, asset, payTo, method, extra, v }.
/// Supports v1 JSON body and v2 PAYMENT-REQUIRED header.
export function parse402(res, body) {
  const hdr = res.headers?.get?.('payment-required') ?? res.headers?.['payment-required'];
  if (hdr) {
    const v2 = b64d(hdr);
    const a = v2.accepts[0];
    return { amount: a.amount, asset: a.asset, payTo: a.payTo, extra: a.extra ?? {}, v: 2, raw: v2 };
  }
  const a = body?.accepts?.[0];
  if (!a) throw new Error('unparseable 402: no accepts');
  return {
    amount: a.maxAmountRequired, asset: a.asset, payTo: a.payTo,
    extra: a.extra ?? {}, v: 1, raw: body,
  };
}

async function signEip3009(signer, req, method, url) {
  const info = assetInfo(req.asset);
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: await signer.getAddress(),
    to: req.payTo,
    value: String(req.amount),
    validAfter: String(now - 10),
    validBefore: String(now + 55),
    nonce: ethers.hexlify(ethers.randomBytes(32)),
  };
  const signature = await signer.signTypedData(
    { name: info.eip712.name, version: info.eip712.version, chainId: CHAIN_ID, verifyingContract: req.asset },
    { TransferWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] },
    authorization,
  );
  return { signature, authorization, header: 'PAYMENT-SIGNATURE' };
}

async function signSettlement(signer, req, method, url, settlementAddress) {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: await signer.getAddress(),
    to: req.payTo,
    asset: req.asset,
    amount: String(req.amount),
    nonce: ethers.hexlify(ethers.randomBytes(32)),
    validBefore: now + 300,
    resourceHash: resourceHashFor(method, url),
  };
  const signature = await signer.signTypedData(
    { name: 'Svp402Settlement', version: '1', chainId: CHAIN_ID, verifyingContract: settlementAddress },
    { PaymentAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }, { name: 'validBefore', type: 'uint64' },
      { name: 'resourceHash', type: 'bytes32' },
    ] },
    authorization,
  );
  return { signature, authorization, header: 'X-PAYMENT' };
}

export class SvpPayingClient {
  /// opts: { signer (ethers Wallet), maxPerCall: "0.05" (human units),
  ///         dailyBudget: "2", settlementAddress?, fetchFn? }
  constructor(opts) {
    if (!opts?.signer) throw new Error('signer required');
    this.signer = opts.signer;
    this.maxPerCall = opts.maxPerCall ?? '0.05';
    this.dailyBudget = opts.dailyBudget ?? '2';
    this.settlementAddress = opts.settlementAddress ?? null;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.spentToday = 0n;
    this.day = new Date().toISOString().slice(0, 10);
  }

  _rollDay() {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.spentToday = 0n; }
  }

  async _payAndRetry(url, init, req402) {
    this._rollDay();
    const info = assetInfo(req402.asset);
    const amount = BigInt(req402.amount);
    const max = ethers.parseUnits(this.maxPerCall, info.decimals);
    if (amount > max) {
      throw new Error(`payment ${req402.amount} exceeds maxPerCall ${this.maxPerCall} ${info.symbol}`);
    }
    if (this.spentToday + amount > ethers.parseUnits(this.dailyBudget, info.decimals)) {
      throw new Error(`payment exceeds dailyBudget ${this.dailyBudget} ${info.symbol}`);
    }
    const method = req402.extra?.assetTransferMethod
      ?? (info.eip3009 ? 'eip3009' : 'settlement');
    const signed = method === 'eip3009'
      ? await signEip3009(this.signer, req402, init?.method ?? 'GET', url)
      : await signSettlement(
        this.signer, req402, init?.method ?? 'GET', url,
        req402.extra?.settlement ?? this.settlementAddress,
      );
    if (method !== 'eip3009' && !(req402.extra?.settlement ?? this.settlementAddress)) {
      throw new Error('settlement address unknown: pass settlementAddress or use USDV');
    }
    this.spentToday += amount;
    const payload = method === 'eip3009'
      ? { x402Version: 2, accepted: { scheme: 'exact' }, payload: { signature: signed.signature, authorization: signed.authorization } }
      : { x402Version: 1, scheme: 'exact', network: 'svp-testnet', payload: { signature: signed.signature, authorization: signed.authorization } };
    const headers = { ...(init?.headers ?? {}), [signed.header]: b64e(payload) };
    const res = await this.fetchFn(url, { ...init, headers });
    if (res.status === 402) throw new Error('payment rejected: ' + JSON.stringify(await res.json()).slice(0, 200));
    return res;
  }

  async fetch(url, init) {
    const res = await this.fetchFn(url, init);
    if (res.status !== 402) return res;
    const body = await res.json().catch(() => null);
    const req402 = parse402(res, body);
    return this._payAndRetry(url, init, req402);
  }

  get(url, init) {
    return this.fetch(url, { ...init, method: 'GET' });
  }
}

/// Wrap an existing fetch: wrapFetch(fetch, opts) -> paying fetch fn.
export function wrapFetch(fetchFn, opts) {
  const c = new SvpPayingClient({ ...opts, fetchFn });
  return (url, init) => c.fetch(url, init);
}
