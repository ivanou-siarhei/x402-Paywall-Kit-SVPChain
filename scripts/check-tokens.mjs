// scripts/check-tokens.mjs
// Этап 0: проверка USDV/USDC на SVPChain testnet 2517 через raw JSON-RPC.
// Без Foundry/cast: только node fetch + eth_call/eth_getCode.
import { SVP_TESTNET } from '../packages/network/index.js';

const SEL = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
};

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  try {
    const b = Buffer.from(hex.slice(2), 'hex');
    // ABI string: offset(32) + len(32) + data
    if (b.length < 64) return b.toString('utf8').replace(/\0/g, '');
    const len = parseInt(b.subarray(32, 64).toString('hex'), 16);
    return b.subarray(64, 64 + len).toString('utf8');
  } catch {
    return null;
  }
}

async function checkToken(rpcUrl, address) {
  const out = { address };
  out.code = await rpc(rpcUrl, 'eth_getCode', [address, 'latest']);
  out.hasCode = out.code && out.code !== '0x' && out.code.length > 10;
  for (const [k, sel] of Object.entries(SEL)) {
    try {
      const raw = await rpc(rpcUrl, 'eth_call', [{ to: address, data: sel }, 'latest']);
      out[k] = k === 'decimals' ? (raw === '0x' ? null : parseInt(raw, 16)) : (decodeString(raw) ?? raw);
      out[`${k}_raw`] = raw;
    } catch (e) {
      out[k] = `ERR: ${e.message}`;
    }
  }
  return out;
}

const results = { rpcUsed: null, chainId: null };
let lastErr = null;
for (const url of [...SVP_TESTNET.rpc, ...SVP_TESTNET.rpcLegacy]) {
  try {
    results.chainId = await rpc(url, 'eth_chainId', []);
    results.rpcUsed = url;
    lastErr = null;
    break;
  } catch (e) {
    lastErr = e.message;
  }
}
if (!results.rpcUsed) {
  console.error(JSON.stringify({ error: 'RPC unreachable', lastErr }));
  process.exit(1);
}
results.chainIdDec = parseInt(results.chainId, 16);
results.tokens = {};
for (const [sym, a] of Object.entries(SVP_TESTNET.assets)) {
  results.tokens[sym] = await checkToken(results.rpcUsed, a.address);
}
// EIP-3009 note: transferWithAuthorization has no single getter selector;
// full check requires contract ABI/bytecode scan on Этапе 1 (Hardhat).
// Here we report code presence + ERC20 metadata as go/no-go for next step.
results.eip3009Note =
  'Run Etapa 1 with Hardhat: check transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32) selector 0xe3ee160e + nonces(bytes32) 0x7ecebe00 via eth_call.';
console.log(JSON.stringify(results, null, 2));
