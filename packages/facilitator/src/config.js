// Shared x402/SVP network + asset config for the facilitator.
// Asset metadata mirrors packages/network (single source of truth lives there;
// this file keeps the facilitator runnable standalone).
export const CONFIG = {
  x402Version: 2,
  network: 'eip155:2517',
  chainId: 2517,
  rpc: process.env.SVP_RPC || 'https://svp-dataseed1-testnet.svpchain.org',
  explorer: 'https://explorer.svpchain.com',
  settleMode: process.env.SETTLE_MODE || 'sync', // 'sync' | 'optimistic'
  settlementAddress: process.env.SETTLEMENT_ADDRESS || null, // Svp402Settlement (deployed Etapa 1)
  assets: {
    USDV: {
      address: '0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951',
      decimals: 6,
      symbol: 'USDV',
      eip3009: true,
      eip712: { name: 'VanToken', version: '1.2.0' },
    },
    USDC: {
      address: '0x732F6Ea7AfD5EdC02e7ba052075dd0780e285489',
      decimals: 6,
      symbol: 'USDC',
      eip3009: false,
    },
  },
};

export function assetByAddress(address) {
  const lower = String(address).toLowerCase();
  for (const [symbol, a] of Object.entries(CONFIG.assets)) {
    if (a.address.toLowerCase() === lower) return { symbol, ...a };
  }
  return null;
}
