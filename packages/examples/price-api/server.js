// Paid price API: GET /api/price costs 0.01 USDV (spec §4: example).
// Standalone run: FACILITATOR_URL=http://127.0.0.1:3001 PAY_TO=0x… node server.js
// The same wiring is exercised in-process by demo.mjs.
import http from 'node:http';
import { paywall } from '../../server/src/index.js';

const PAY_TO = process.env.PAY_TO || '0x1111111111111111111111111111111111111111';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'http://127.0.0.1:3001';

const paid = paywall({
  price: '0.01', asset: 'USDV', payTo: PAY_TO,
  facilitatorUrl: FACILITATOR_URL,
  settleMode: process.env.SETTLE_MODE || 'optimistic',
  description: 'SVP market summary feed',
}, async () => ({ btc: 63524.59, eth: 3120.11, ts: new Date().toISOString() }));

const server = http.createServer((req, res) => {
  const out = {
    set: (k, v) => (res.setHeader(k, v), out),
    status: (c) => ((res.statusCode = c), out),
    json: (b) => (res.setHeader('Content-Type', 'application/json'), res.end(JSON.stringify(b))),
  };
  if (req.url === '/health') return out.json({ ok: true });
  if (req.url.startsWith('/api/price')) {
    return paid({ method: req.method, url: req.url, headers: req.headers }, out, () => {});
  }
  res.statusCode = 404;
  res.end('not found');
});

const port = Number(process.env.PORT || 3100);
if (process.env.LISTEN !== '0') {
  server.listen(port, () => console.log(`price-api :${port} (0.01 USDV/call)`));
}
export { server };
