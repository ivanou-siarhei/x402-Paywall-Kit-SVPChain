# x402 Paywall Kit

Any API becomes payable for AI agents in a couple of lines — via **x402 (HTTP 402 Payment Required)** on **SVPChain**. A companion client lets an agent meet a `402`, pay within budget, and retry.

```js
// seller: one line per endpoint
app.get('/api/price', paywall({ price: '0.01', asset: 'USDV', payTo: process.env.PAY_TO }), handler);
```

```python
# buyer agent: pays automatically, never over budget
client = SvpPayingClient(signer=account, max_per_call="0.05", daily_budget="2")
status, _, body = client.get("https://api.example.com/api/price")
```

## Why

- x402 is native to SVPChain's agent economy, but developers need ready middleware, a client, a facilitator, and revenue tracking — this kit is the reference implementation.
- Sellers pick the stablecoin per endpoint: **USDV or USDC** (dashboard radio).
- Hybrid protocol: **x402 v1** (spec: `X-PAYMENT`, `maxAmountRequired`) + **v2 adapter** (`PAYMENT-*` headers, `eip155:2517`) for standard Coinbase clients.

## How it works

```
1. Agent      -> GET /api/price
2. API        <- 402 { accepts: [{ scheme:"exact", network, amount, payTo, asset, extra }] }
3. Agent         signs EIP-712 (USDV: EIP-3009 TransferWithAuthorization;
                                USDC: Svp402Settlement PaymentAuthorization, needs approve)
4. Agent      -> GET /api/price + X-PAYMENT / PAYMENT-SIGNATURE
5. API        -> facilitator POST /verify (signature, amount, payTo, expiry, nonce/balance)
6. API           serves data + facilitator POST /settle (on-chain) -> receipt { txHash }
```

Settle modes: **sync** (settle first, then respond — expensive calls) and **optimistic**
(respond, settle queued — cheap calls, per-payer unsettled cap).

## Packages

| Package | What | Tests |
|---|---|---|
| `packages/contracts` | `Svp402Settlement.sol` (pull-settlement for plain ERC-20s like USDC; EIP-712 `PaymentAuthorization`, batch, fee bps, nonce cancel) | Hardhat 8/8 |
| `packages/facilitator` | `GET /supported`, `POST /verify`, `POST /settle`, `GET /health`; sync/optimistic | node:test 5/5 |
| `packages/server` | `@svp402/server`: `paywall()` (Express-native) + `paywallFastify` + `paywallNext` | 7/7 incl. e2e |
| `packages/client` | `@svp402/client`: `SvpPayingClient`, `wrapFetch` (budgets enforced before signing) | 5/5 |
| `python/svp402` | Same client in Python + FastAPI `paywall_dependency` + LangChain tool + MCP `pay_and_fetch` | pytest 12/12 |
| `packages/dashboard` | Seller dashboard: endpoints, revenue, receipts (explorer links), settings (USDV\|USDC) — Vite + React + wagmi/viem + SCSS | 4/4 + build |
| `packages/examples/price-api` | Paid price feed ($0.01/call) + TS/Python buyers + 3-minute demo (`node demo.mjs` → DEMO OK) | demo |

## Quickstart (local, 2 min)

```bash
# 1. facilitator (optimistic = no key needed)
cd packages/facilitator && npm install
SETTLE_MODE=optimistic SETTLEMENT_ADDRESS=0x00000000000000000000000000000000000000A9 node src/index.js &

# 2. paid API
cd ../examples/price-api && npm install
PAY_TO=0xYourAddress PORT=3100 node server.js &

# 3. buy it
node buyer-ts.mjs
# or full narrated scenario:
node demo.mjs  # -> DEMO OK
```

Full 5-minute tutorial: [`TUTORIAL.md`](TUTORIAL.md). Production hosting (Vercel + Neon): [`INSTRUCTION.md`](INSTRUCTION.md).

## Networks & assets (SVPChain testnet, chain ID `2517`)

- RPC `https://svp-dataseed1-testnet.svpchain.org` · Explorer `https://explorer.svpchain.com` · Faucet `https://www.svpchain.org/faucet` · gas ≥ 2 Gwei
- **USDV** `0x013a61E622e6ABFCaB64F52D274C3Fc0aA37f951` (dec 6, EIP-712 `VanToken/1.2.0`, supports EIP-3009 → gasless native path)
- **USDC** `0x732F6Ea7AfD5EdC02e7ba052075dd0780e285489` (dec 6, plain ERC-20 → via `Svp402Settlement`, approve first)
- Permit2 is **not** deployed on 2517, so the custom settlement contract is required for USDC.

Docs: https://svpchain.gitbook.io/svpchain-docs · GitHub: https://github.com/svpchain · x402: https://www.svpchain.org/x402

## Status

- [x] Contract + tests; deploy + verify pending (needs funded testnet key)
- [x] Facilitator + TS/Python SDKs + agent tools + dashboard + example + demo
- [ ] ≥ 50 real testnet payments (needs `FACILITATOR_KEY` + deployed settlement)
- [ ] npm / PyPI publish, Vercel + Neon go-live (see `INSTRUCTION.md`)
