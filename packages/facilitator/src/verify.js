// Pure x402 payment verification (no secrets, no sending). Two paths:
// - 'eip3009': USDV native TransferWithAuthorization (exact scheme)
// - 'settlement': Svp402Settlement PaymentAuthorization (USDC, or USDV fallback)
import { ethers } from 'ethers';
import { CONFIG, assetByAddress } from './config.js';

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const SETTLEMENT_TYPES = {
  PaymentAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'validBefore', type: 'uint64' },
    { name: 'resourceHash', type: 'bytes32' },
  ],
};

async function rpcCall(method, params) {
  const res = await fetch(CONFIG.rpc, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

async function verifyEip3009(payload, req) {
  const { signature, authorization: a } = payload;
  const asset = assetByAddress(req.asset);
  if (!asset || !asset.eip3009) return fail('asset does not support EIP-3009');
  if (String(a.value) !== String(req.amount)) return fail('amount mismatch');
  if (String(a.to).toLowerCase() !== String(req.payTo).toLowerCase()) return fail('payTo mismatch');
  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validAfter) > now) return fail('authorization not yet valid');
  if (Number(a.validBefore) <= now) return fail('authorization expired');
  if (Number(a.validBefore) - now > Number(req.maxTimeoutSeconds) + 300) {
    return fail('validBefore exceeds maxTimeoutSeconds');
  }
  const domain = {
    name: asset.eip712.name, version: asset.eip712.version,
    chainId: CONFIG.chainId, verifyingContract: asset.address,
  };
  const recovered = ethers.verifyTypedData(domain, EIP3009_TYPES, a, signature);
  if (recovered.toLowerCase() !== String(a.from).toLowerCase()) {
    return fail('signature does not recover to payer');
  }
  // Optional on-chain: EIP-3009 authorizationState(authorizer, nonce) must be false (unused).
  try {
    const sel = ethers.id('authorizationState(address,bytes32)').slice(0, 10);
    const data = sel
      + ethers.zeroPadValue(a.from, 32).slice(2)
      + (a.nonce.startsWith('0x') ? a.nonce.slice(2).padStart(64, '0') : a.nonce.padStart(64, '0'));
    const raw = await rpcCall('eth_call', [{ to: asset.address, data }, 'latest']);
    if (raw !== '0x' && BigInt(raw) !== 0n) return fail('authorization already used');
  } catch { /* RPC/ABI mismatch -> skip, signature check already passed */ }
  return { isValid: true, invalidReason: null, path: 'eip3009' };
}

async function verifySettlement(payload, req) {
  const { signature, authorization: a } = payload;
  if (!CONFIG.settlementAddress) return fail('settlement contract not configured');
  if (String(a.amount) !== String(req.amount)) return fail('amount mismatch');
  if (String(a.asset).toLowerCase() !== String(req.asset).toLowerCase()) return fail('asset mismatch');
  if (String(a.to).toLowerCase() !== String(req.payTo).toLowerCase()) return fail('payTo mismatch');
  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validBefore) <= now) return fail('authorization expired');
  const domain = {
    name: 'Svp402Settlement', version: '1',
    chainId: CONFIG.chainId, verifyingContract: CONFIG.settlementAddress,
  };
  const recovered = ethers.verifyTypedData(domain, SETTLEMENT_TYPES, a, signature);
  if (recovered.toLowerCase() !== String(a.from).toLowerCase()) {
    return fail('signature does not recover to payer');
  }
  try {
    const sel = ethers.id('isNonceUsed(address,bytes32)').slice(0, 10);
    const data = sel
      + ethers.zeroPadValue(a.from, 32).slice(2)
      + (a.nonce.startsWith('0x') ? a.nonce.slice(2).padStart(64, '0') : a.nonce.padStart(64, '0'));
    const raw = await rpcCall('eth_call', [{ to: CONFIG.settlementAddress, data }, 'latest']);
    if (raw !== '0x' && BigInt(raw) !== 0n) return fail('nonce already used');
  } catch { /* settlement not deployed yet -> skip */ }
  return { isValid: true, invalidReason: null, path: 'settlement' };
}

function fail(reason) {
  return { isValid: false, invalidReason: reason, path: null };
}

export async function verifyPayment({ paymentPayload, paymentRequirements }) {
  if (!paymentPayload || !paymentRequirements) return fail('missing paymentPayload/paymentRequirements');
  const method = paymentPayload?.accepted?.extra?.assetTransferMethod
    || paymentRequirements?.extra?.assetTransferMethod
    || (assetByAddress(paymentRequirements.asset)?.eip3009 ? 'eip3009' : 'settlement');
  try {
    if (method === 'eip3009') return await verifyEip3009(paymentPayload.payload, paymentRequirements);
    return await verifySettlement(paymentPayload.payload, paymentRequirements);
  } catch (e) {
    return fail('verify error: ' + e.message);
  }
}
