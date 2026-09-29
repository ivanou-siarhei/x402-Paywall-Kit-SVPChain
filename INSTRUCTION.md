# INSTRUCTION.md — Deploy to Vercel + Neon

Production topology:

- **Dashboard** → Vercel (static Vite build)
- **Database** → Neon Postgres (dashboard receipts/revenue only; facilitator stays stateless)
- **Facilitator** → always-on host (Railway / Render / VPS). See §3 why not plain Vercel serverless.
- **Settlement contract** → SVPChain testnet 2517 (one deploy)

## 1. Neon database (10 min)

1. Create a project at https://neon.tech → copy `DATABASE_URL` (pooled).
2. Apply the schema locally:
   ```bash
   psql "$DATABASE_URL" -f packages/dashboard/db/schema.sql
   ```
   Tables: `endpoints`, `payments`, `webhook_deliveries` (amounts as text = BigInt-safe).
3. Verify:
   ```sql
   \dt   -- endpoints, payments, webhook_deliveries
   ```
4. Create a read-write role for the dashboard API and a read-only role if you expose analytics.
   Never commit `DATABASE_URL` — `.env` is gitignored.

## 2. Dashboard on Vercel (10 min)

1. `vercel import` the repo (or Connect via dashboard).
2. **Root Directory:** `packages/dashboard` (monorepo!). Framework preset: Vite.
   Build: `npm run build`, Output: `dist`.
3. Environment variables (Project → Settings → Environment Variables):
   | Var | Value |
   |-----|-------|
   | `VITE_PAY_TO` | seller address `0x…` |
   | `VITE_FACILITATOR_URL` | public facilitator URL from §3 |
   | `VITE_DEFAULT_ASSET` | `USDV` |
   | `DATABASE_URL` | Neon pooled URL (used by the API layer, not the static build) |
4. Deploy. SPA has no server routes, so no rewrites needed.
5. After the first deploy, switch `packages/dashboard/src/api.js` from `MockAdapter`
   to the Neon-backed adapter (same interface: `getPayments/getEndpoints/getSettings`),
   reading through a tiny API route that uses `DATABASE_URL`.

## 3. Facilitator — always-on host (15 min)

The facilitator holds `FACILITATOR_KEY` and (in `optimistic` mode) an in-memory queue,
so plain Vercel serverless functions are a bad fit (cold starts, 10–60 s timeout,
queue lost between invocations). Use Railway / Render / a VPS:

```bash
# on the host
cd packages/facilitator && npm install --omit=dev
SETTLE_MODE=sync \
SETTLEMENT_ADDRESS=0xDeployedSettlement \
FACILITATOR_KEY=0xHotWalletWithTestnetSVP \
PORT=3001 node src/index.js
```

Environment:
| Var | Required | Purpose |
|-----|----------|---------|
| `SETTLEMENT_ADDRESS` | yes | `Svp402Settlement` from §4 |
| `FACILITATOR_KEY` | yes for `sync` settle | hot wallet, pays gas (min 2 Gwei) |
| `SETTLE_MODE` | no (`sync`) | `sync` = settle before response; `optimistic` = respond, settle queued |
| `SVP_RPC` | no (default dataseed1) | fallback: dataseed2/3 |
| `PORT` | no (3001) | listen port |

Ops checklist:
- Fund the hot wallet via https://www.svpchain.org/faucet; set a balance alert
  (below ~0.2 SVP) — every settle burns gas.
- Health: `GET /health` → `{ ok, pending }`. Alert if `pending` grows (RPC down).
- Process manager: `pm2 start src/index.js --name svp402-facilitator` (or systemd unit).
- If you must use Vercel: set `maxDuration`, keep `SETTLE_MODE=sync`,
  and drain the optimistic queue into Neon `payments(status='pending')` instead of memory
  (code change required — the `queue` in `src/settle.js` is the seam).

## 4. Settlement contract (5 min + faucet wait)

```bash
cd packages/contracts && npm install
PRIVATE_KEY=0xYourTestnetKey npm run deploy:testnet
# Svp402Settlement deployed at 0x…  → copy into §3 + dashboard Settings
```

Verify source: https://explorer.svpchain.com/address/0x… → Code → Verify & Publish
(solc `0.8.24`, EVM `cancun`, OpenZeppelin 5.x). Constructor args: `feeBps=0`, `feeRecipient=<deployer>`.

## 5. Wiring checklist (go-live)

- [ ] Contract deployed + verified; address in facilitator env + dashboard Settings
- [ ] Facilitator `/supported` reachable publicly; `/health` monitored
- [ ] Price API uses `settleMode: 'sync'` and the public `facilitatorUrl`
- [ ] Dashboard points at the public facilitator; Neon `DATABASE_URL` set
- [ ] Test buy of 0.01 USDV end-to-end → receipt `txHash` opens in the explorer
- [ ] Hot wallet funded; low-balance alert set
