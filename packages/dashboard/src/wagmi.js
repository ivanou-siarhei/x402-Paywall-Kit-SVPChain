import { http, createConfig } from 'wagmi';
import { defineChain } from 'viem';
import { QueryClient } from '@tanstack/react-query';

export const svpTestnet = defineChain({
  id: 2517,
  name: 'SVPChain Testnet',
  nativeCurrency: { name: 'SVP', symbol: 'SVP', decimals: 18 },
  rpcUrls: { default: { http: ['https://svp-dataseed1-testnet.svpchain.org'] } },
  blockExplorers: { default: { name: 'SVP Explorer', url: 'https://explorer.svpchain.com' } },
});

export const wagmiConfig = createConfig({
  chains: [svpTestnet],
  transports: { [svpTestnet.id]: http() },
});

export const queryClient = new QueryClient();
