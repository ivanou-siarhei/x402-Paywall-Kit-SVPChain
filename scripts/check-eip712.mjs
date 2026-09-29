// scripts/check-eip712.mjs — Этап 1: EIP-712 domain USDV + Permit2 presence на 2517.
const RPC = 'https://svp-dataseed1-testnet.svpchain.org';
async function rpc(m, p) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${m}: ${JSON.stringify(j.error)}`);
  return j.result;
}
const strip = (hex) => {
  const b = Buffer.from(hex.slice(2), 'hex');
  const len = parseInt(b.subarray(32, 64).toString('hex'), 16);
  return b.subarray(64, 64 + len).toString('utf8');
};
const USDV = '0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951';
const out = {};
out.DOMAIN_SEPARATOR = await rpc('eth_call', [{ to: USDV, data: '0x3644e515' }, 'latest']);
out.name = strip(await rpc('eth_call', [{ to: USDV, data: '0x06fdde03' }, 'latest']));
out.version = strip(await rpc('eth_call', [{ to: USDV, data: '0x54fd4d50' }, 'latest']));
// EIP712Domain() full decode: fields name,version,chainId,verifyingContract(,salt,extensions)
const raw = await rpc('eth_call', [{ to: USDV, data: '0x84b0196e' }, 'latest']);
out.EIP712Domain_raw_len = (raw.length - 2) / 2;
const b = Buffer.from(raw.slice(2), 'hex');
const words = [];
for (let i = 0; i + 32 <= b.length; i += 32) words.push(b.subarray(i, i + 32));
out.EIP712Domain_fields = words[0]?.toString('hex'); // bitmask of fields present
console.log(JSON.stringify(out, null, 2));
// Permit2 candidates
for (const p2 of [
  '0x000000000022D473030F116dDEE9F6B43aC15F7',
  '0x000000000022D473030F116dDEE9F6B43aC015f7',
]) {
  try {
    const code = await rpc('eth_getCode', [p2, 'latest']);
    console.log('Permit2', p2, 'codeLen=' + ((code.length - 2) / 2));
  } catch (e) { console.log('Permit2', p2, 'ERR ' + e.message); }
}
