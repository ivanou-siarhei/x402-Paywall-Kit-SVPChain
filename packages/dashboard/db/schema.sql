# Neon Postgres schema — dashboard only (facilitator stays stateless).
# Apply once after Neon provisioning (Etapa 7): psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS endpoints (
  id          TEXT PRIMARY KEY,          -- e.g. 'GET /api/price'
  path        TEXT NOT NULL,
  price_base  TEXT NOT NULL,             -- base units, string (bigint-safe)
  asset       TEXT NOT NULL,             -- 'USDV' | 'USDC'
  pay_to      TEXT NOT NULL,
  settle_mode TEXT NOT NULL DEFAULT 'sync',
  status      TEXT NOT NULL DEFAULT 'live',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,        -- nonce hex
  endpoint_id   TEXT NOT NULL REFERENCES endpoints(id),
  payer         TEXT NOT NULL,           -- agent address
  asset         TEXT NOT NULL,
  amount_base   TEXT NOT NULL,
  tx_hash       TEXT,                    -- null while optimistic-pending
  status        TEXT NOT NULL DEFAULT 'settled',  -- 'settled' | 'pending' | 'failed'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer);
CREATE INDEX IF NOT EXISTS idx_payments_asset ON payments(asset);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          BIGSERIAL PRIMARY KEY,
  payment_id  TEXT REFERENCES payments(id),
  url         TEXT NOT NULL,
  status_code INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
