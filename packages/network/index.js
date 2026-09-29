// Single source of truth for SVPChain testnet + x402 assets.
// Canonical docs: https://svpchain.gitbook.io/svpchain-docs/chain/networks.md
// Testnet contracts: https://svpchain.gitbook.io/svpchain-docs/reference/testnet-contracts.md

export const SVP_TESTNET = {
  chainId: 2517,
  chainIdHex: '0x9d5',
  caip2: 'eip155:2517',
  cosmosChainId: 'svp-2517-1',
  rpc: [
    'https://svp-dataseed1-testnet.svpchain.org',
    'https://svp-dataseed2-testnet.svpchain.org',
    'https://svp-dataseed3-testnet.svpchain.org',
  ],
  // Legacy endpoint, kept as fallback:
  rpcLegacy: ['https://svp-dataseeds-testnet.svpchain.org'],
  explorer: 'https://explorer.svpchain.com',
  faucet: 'https://www.svpchain.org/faucet',
  faucetContract: '0x8b52753dCbad46925821F02B7B7d90BAd8804bfE',
  minGasPriceGwei: '2',
  assets: {
    USDV: {
      address: '0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951',
      decimals: 6,
      symbol: 'USDV',
      status: 'confirmed-docs',
    },
    USDC: {
      // Candidate from explorer tokens list, network not confirmed in docs.
      // Must be verified by scripts/check-tokens.mjs on Этапе 0.
      address: '0x732F6Ea7AfD5EdC02e7ba052075dd0780e285489',
      decimals: null,
      symbol: 'USDC',
      status: 'candidate-explorer-unverified',
    },
  },
};

export function getNetworkConfig() {
  return SVP_TESTNET;
}

export function resolveAsset(input) {
  if (!input) return SVP_TESTNET.assets.USDV;
  const upper = String(input).toUpperCase();
  if (SVP_TESTNET.assets[upper]) return SVP_TESTNET.assets[upper];
  // raw address fallback
  return { address: input, decimals: null, symbol: 'CUSTOM', status: 'custom' };
}
