// On-chain settlement submitted by the facilitator hot wallet (pays gas, min 2 Gwei on SVP).
import { ethers } from 'ethers';
import { CONFIG } from './config.js';

const USDV_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
];
const SETTLEMENT_ABI = [
  'function settle((address from, address to, address asset, uint256 amount, bytes32 nonce, uint64 validBefore, bytes32 resourceHash), bytes)',
];

const queue = []; // optimistic-mode pending settlements

function wallet() {
  const key = process.env.FACILITATOR_KEY;
  if (!key) return null;
  const provider = new ethers.JsonRpcProvider(CONFIG.rpc);
  return new ethers.Wallet(key, provider);
}

export async function settlePayment({ paymentPayload, paymentRequirements, path }) {
  const networkId = CONFIG.network;
  if (CONFIG.settleMode === 'optimistic') {
    queue.push({ at: Date.now(), paymentPayload, paymentRequirements, path });
    return { success: true, txHash: null, queued: true, networkId };
  }
  const w = wallet();
  if (!w) return { success: false, error: 'FACILITATOR_KEY not configured', networkId };
  try {
    if (path === 'eip3009') {
      const token = new ethers.Contract(paymentRequirements.asset, USDV_ABI, w);
      const a = paymentPayload.payload.authorization;
      const { v, r, s } = ethers.Signature.from(paymentPayload.payload.signature);
      const tx = await token.transferWithAuthorization(
        a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s,
      );
      const rc = await tx.wait();
      return { success: true, txHash: rc.hash, networkId };
    }
    if (!CONFIG.settlementAddress) {
      return { success: false, error: 'SETTLEMENT_ADDRESS not configured', networkId };
    }
    const s = new ethers.Contract(CONFIG.settlementAddress, SETTLEMENT_ABI, w);
    const tx = await s.settle(
      paymentPayload.payload.authorization, paymentPayload.payload.signature,
    );
    const rc = await tx.wait();
    return { success: true, txHash: rc.hash, networkId };
  } catch (e) {
    return { success: false, error: String(e.shortMessage || e.message), networkId };
  }
}

export function pendingCount() {
  return queue.length;
}
