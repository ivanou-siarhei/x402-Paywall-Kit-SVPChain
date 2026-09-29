import express from 'express';
import { CONFIG } from './config.js';
import { verifyPayment } from './verify.js';
import { settlePayment, pendingCount } from './settle.js';

export const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/supported', (_req, res) => {
  res.json({
    x402Version: CONFIG.x402Version,
    networks: [CONFIG.network],
    schemes: ['exact'],
    assets: Object.entries(CONFIG.assets).map(([symbol, a]) => ({
      symbol, address: a.address, decimals: a.decimals,
      assetTransferMethods: a.eip3009 ? ['eip3009', 'settlement'] : ['settlement'],
      extra: a.eip712 ?? undefined,
    })),
    settleModes: ['sync', 'optimistic'],
    settleMode: CONFIG.settleMode,
  });
});

app.post('/verify', async (req, res) => {
  const result = await verifyPayment(req.body ?? {});
  res.json(result);
});

app.post('/settle', async (req, res) => {
  const { paymentPayload, paymentRequirements } = req.body ?? {};
  const check = await verifyPayment({ paymentPayload, paymentRequirements });
  if (!check.isValid) return res.status(402).json({ success: false, error: check.invalidReason });
  const out = await settlePayment({ paymentPayload, paymentRequirements, path: check.path });
  if (!out.success) return res.status(402).json(out);
  res.json(out);
});

app.get('/health', (_req, res) => res.json({ ok: true, pending: pendingCount() }));

const port = Number(process.env.PORT || 3001);
if (process.env.FACILITATOR_LISTEN !== '0') {
  app.listen(port, () => console.log(`facilitator :${port} mode=${CONFIG.settleMode}`));
}
