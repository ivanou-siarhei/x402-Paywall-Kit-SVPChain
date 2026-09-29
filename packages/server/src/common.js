// Shared helpers: token registry, amount conversion, resource binding.
import { ethers } from 'ethers';

export const SVP_TESTNET = {
  chainId: 2517,
  caip2: 'eip155:2517',
  legacyNetwork: 'svp-testnet',
  explorer: 'https://explorer.svpchain.com',
};

export const ASSETS = {
  USDV: {
    address: '0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951',
    decimals: 6, symbol: 'USDV', eip3009: true,
    eip712: { name: 'VanToken', version: '1.2.0' },
  },
  USDC: {
    address: '0x732F6Ea7AfD5EdC02e7ba052075dd0780e285489',
    decimals: 6, symbol: 'USDC', eip3009: false,
  },
};

export function resolveAsset(input) {
  if (!input) throw new Error('asset required: "USDV" | "USDC" | 0x-address');
  const upper = String(input).toUpperCase();
  if (ASSETS[upper]) return { symbol: upper, ...ASSETS[upper] };
  return { symbol: 'CUSTOM', address: input, decimals: 6, eip3009: false };
}

/// "0.01" -> "10000" (base units). Accepts human string or base-unit string with {base:true}.
export function toBaseUnits(amount, decimals) {
  return ethers.parseUnits(String(amount), decimals).toString();
}

/// resourceHash binds payment to METHOD + path, e.g. "GET /api/price".
/// Server and @svp402/client compute it identically.
export function resourceHashFor(method, url) {
  const path = String(url).split('?')[0];
  const pathname = path.startsWith('http') ? new URL(path).pathname : path;
  return ethers.keccak256(ethers.toUtf8Bytes(`${String(method).toUpperCase()} ${pathname}`));
}

export const b64e = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
export const b64d = (s) => JSON.parse(Buffer.from(String(s), 'base64').toString('utf8'));
