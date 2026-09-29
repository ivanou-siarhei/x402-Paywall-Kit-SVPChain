// Data layer. MockAdapter serves seeded demo data from localStorage today;
// NeonAdapter (Etapa 7, after Neon provisioning) will implement the same
// interface over REST: GET /api/endpoints, /api/revenue, /api/receipts.
const SEED = [
  { id: 'p1', endpoint: '/api/price', from: '0xAgent00111111111111111111111111111111111111', asset: 'USDV', amount: '10000', txHash: '0xaaa', ts: Date.now() - 86400000 * 1 },
  { id: 'p2', endpoint: '/api/price', from: '0xAgent00222222222222222222222222222222222222', asset: 'USDV', amount: '10000', txHash: '0xbbb', ts: Date.now() - 86400000 * 1 },
  { id: 'p3', endpoint: '/api/stats', from: '0xAgent00111111111111111111111111111111111111', asset: 'USDC', amount: '50000', txHash: '0xccc', ts: Date.now() - 3600000 },
];

const DEFAULT_ENDPOINTS = [
  { path: '/api/price', price: '0.01', asset: 'USDV', status: 'live', calls: 128 },
  { path: '/api/stats', price: '0.05', asset: 'USDC', status: 'live', calls: 42 },
];

const DEFAULT_SETTINGS = {
  payTo: '',
  asset: 'USDV',
  settleMode: 'sync',
  webhook: '',
  facilitatorUrl: 'http://127.0.0.1:3001',
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export const api = {
  getPayments: () => load('svp402.payments', SEED),
  getEndpoints: () => load('svp402.endpoints', DEFAULT_ENDPOINTS),
  getSettings: () => ({ ...DEFAULT_SETTINGS, ...load('svp402.settings', {}) }),
  saveSettings: (s) => localStorage.setItem('svp402.settings', JSON.stringify(s)),
  toggleEndpoint: (path) => {
    const eps = load('svp402.endpoints', DEFAULT_ENDPOINTS).map((e) =>
      e.path === path ? { ...e, status: e.status === 'live' ? 'paused' : 'live' } : e,
    );
    localStorage.setItem('svp402.endpoints', JSON.stringify(eps));
    return eps;
  },
};

export const EXPLORER_TX = (h) => `https://explorer.svpchain.com/tx/${h}`;
