# Monetize your API in 5 minutes (x402 on SVPChain testnet)

Charge AI agents per API call. No accounts, no Stripe — just HTTP 402 + on-chain settlement.

## 0. Prerequisites (1 min)

- Node 22+, Python 3.12+
- This repo (`npm` workspaces; no `pnpm` needed)
- Testnet SVP for gas (later, for on-chain settle): https://www.svpchain.org/faucet

```bash
git clone <repo> && cd <repo>
```

## 1. Start the facilitator (30 s)

The facilitator verifies payment signatures and settles on-chain.
Demo runs in `optimistic` mode (no private key needed):

```bash
cd packages/facilitator && npm install
SETTLE_MODE=optimistic \
SETTLEMENT_ADDRESS=0x00000000000000000000000000000000000000A9 \
node src/index.js
# facilitator :3001 mode=optimistic
```

Check: `curl localhost:3001/supported` lists `eip155:2517`, `exact`, USDV + USDC.

## 2. Put a paywall on your API (1 min)

```js
// server.js
import http from 'node:http';
import { paywall } from '@svp402/server';

const paid = paywall(
  { price: '0.01', asset: 'USDV', payTo: process.env.PAY_TO,
    facilitatorUrl: 'http://127.0.0.1:3001', settleMode: 'optimistic' },
  async () => ({ btc: 63524.59 }), // your handler
);

http.createServer((req, res) => {
  const out = {
    set: (k, v) => (res.setHeader(k, v), out),
    status: (c) => ((res.statusCode = c), out),
    json: (b) => res.end(JSON.stringify(b)),
  };
  paid({ method: req.method, url: req.url, headers: req.headers }, out, () => {});
}).listen(3100);
```

A ready-made version lives in `packages/examples/price-api/server.js`:

```bash
cd ../examples/price-api && npm install
PAY_TO=0xYourAddress PORT=3100 node server.js
```

FastAPI flavor (same 402 semantics, `paywall_dependency`):

```python
from fastapi import Depends, FastAPI
from svp402.server import paywall_dependency

app = FastAPI()
guard = paywall_dependency(price="0.01", asset="USDV", payTo=PAY_TO,
                           facilitator_url="http://127.0.0.1:3001")

@app.get("/api/price")
async def price(receipt=Depends(guard)):
    return {"data": {"btc": 63524.59}, "payment": receipt}
```

Unpaid request now returns `402` with the price (`maxAmountRequired: "10000"` = 0.01 USDV).

## 3. Buy it as an agent (1 min)

TypeScript:

```js
import { SvpPayingClient } from '@svp402/client';

const client = new SvpPayingClient({ signer: wallet, maxPerCall: '0.05', dailyBudget: '2' });
const res = await client.get('http://127.0.0.1:3100/api/price'); // 402 -> signs -> retries
console.log(await res.json()); // { data: { btc: ... }, payment: {...} }
```

Python (same semantics):

```python
from svp402 import SvpPayingClient
client = SvpPayingClient(signer=account, max_per_call="0.05", daily_budget="2")
status, _, body = client.get("http://127.0.0.1:3100/api/price")
```

Or run both shipped buyers: `node buyer-ts.mjs` and `python buyer-py.py` (see `packages/examples/price-api/`).

LangChain / MCP agents get one tool: `pay_and_fetch(url, max_amount)` —
`python/svp402/tools_langchain.py` and `tools_mcp.py`.

## 4. Watch the money (30 s)

```bash
cd ../dashboard && npm install && npm run dev
# open http://localhost:5173 — Endpoints / Revenue / Receipts / Settings
```

Settings → stablecoin radio switches the whole endpoint between **USDV and USDC**,
and generates the matching `paywall({...})` snippet.

## 5. Go on-chain (production path)

1. Deploy the settlement contract (needed for USDC; optional for USDV which has native EIP-3009):
   ```bash
   cd ../contracts
   PRIVATE_KEY=0xYourTestnetKey npm run deploy:testnet
   ```
   Verify source in https://explorer.svpchain.com → Code → Verify & Publish.
2. Restart the facilitator with a funded hot wallet + real address:
   ```bash
   SETTLE_MODE=sync SETTLEMENT_ADDRESS=0xDeployed \
   FACILITATOR_KEY=0xHotWalletKey node src/index.js
   ```
3. Flip the API to `settleMode: 'sync'`. Receipts now carry real `txHash` links to the explorer.

Full hosting guide (Vercel + Neon): see `INSTRUCTION.md`.
