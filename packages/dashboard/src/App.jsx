import { useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { api, EXPLORER_TX } from './api.js';
import { totalsByDay, topPayers, filterByAsset, human } from './stats.js';

function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  if (!isConnected) {
    return <button className="btn" onClick={() => connect({ connector: injected() })}>Connect wallet</button>;
  }
  return (
    <span className="wallet">
      {address.slice(0, 6)}…{address.slice(-4)}
      <button className="btn btn-ghost" onClick={() => disconnect()}>×</button>
    </span>
  );
}

function Endpoints({ endpoints, onToggle }) {
  return (
    <section>
      <h2>Endpoints</h2>
      <div className="cards">
        {endpoints.map((e) => (
          <div className="card" key={e.path}>
            <div className="card-title">{e.path}</div>
            <div className="card-row"><span>Price</span><b>{e.price} {e.asset}</b></div>
            <div className="card-row"><span>Status</span><b className={e.status}>{e.status}</b></div>
            <div className="card-row"><span>Calls</span><b>{e.calls}</b></div>
            <button className="btn btn-ghost" onClick={() => onToggle(e.path)}>
              {e.status === 'live' ? 'Pause' : 'Resume'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Revenue({ payments }) {
  const [asset, setAsset] = useState('ALL');
  const [range, setRange] = useState(7);
  const rows = useMemo(() => {
    const cutoff = Date.now() - range * 86400000;
    return totalsByDay(filterByAsset(payments, asset).filter((p) => p.ts >= cutoff));
  }, [payments, asset, range]);
  const tops = useMemo(() => topPayers(payments, asset === 'ALL' ? null : asset, 5), [payments, asset]);
  const max = Math.max(1, ...rows.map((r) => human(r.total)));
  const total = rows.reduce((s, r) => s + human(r.total), 0);
  return (
    <section>
      <h2>Revenue</h2>
      <div className="toolbar">
        <select value={asset} onChange={(e) => setAsset(e.target.value)}>
          <option value="ALL">USDV + USDC</option>
          <option value="USDV">USDV</option>
          <option value="USDC">USDC</option>
        </select>
        <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
          <option value={1}>Day</option>
          <option value={7}>Week</option>
        </select>
        <b className="total">{total.toFixed(2)} stable</b>
      </div>
      <div className="bars">
        {rows.map((r) => (
          <div className="bar-col" key={r.day} title={`${r.day}: ${human(r.total)} (${r.count})`}>
            <div className="bar" style={{ height: `${(human(r.total) / max) * 120}px` }} />
            <span>{r.day.slice(5)}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="muted">No payments in range.</p>}
      </div>
      <h3>Top payers</h3>
      <table>
        <thead><tr><th>Agent</th><th>Paid</th><th>Calls</th></tr></thead>
        <tbody>
          {tops.map((t) => (
            <tr key={t.from}><td className="mono">{t.from.slice(0, 10)}…</td><td>{human(t.total).toFixed(2)}</td><td>{t.count}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Receipts({ payments }) {
  const [asset, setAsset] = useState('ALL');
  const rows = filterByAsset(payments, asset).slice().sort((a, b) => b.ts - a.ts);
  return (
    <section>
      <h2>Receipts</h2>
      <div className="toolbar">
        <select value={asset} onChange={(e) => setAsset(e.target.value)}>
          <option value="ALL">All assets</option>
          <option value="USDV">USDV</option>
          <option value="USDC">USDC</option>
        </select>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Endpoint</th><th>From</th><th>Asset</th><th>Amount</th><th>Tx</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{new Date(p.ts).toLocaleString()}</td>
              <td className="mono">{p.endpoint}</td>
              <td className="mono">{p.from.slice(0, 10)}…</td>
              <td>{p.asset}</td>
              <td>{human(p.amount).toFixed(2)}</td>
              <td><a href={EXPLORER_TX(p.txHash)} target="_blank" rel="noreferrer" className="mono">{p.txHash.slice(0, 8)}…</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Settings({ settings, onSave }) {
  const [form, setForm] = useState(settings);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const snippet = `paywall({ price: "0.01", asset: "${form.asset}", payTo: "${form.payTo || '0x…'}" })`;
  return (
    <section>
      <h2>Settings</h2>
      <label>PayTo address
        <input value={form.payTo} onChange={set('payTo')} placeholder="0x…" className="input" />
      </label>
      <div className="radio-row">
        Stablecoin:
        {['USDV', 'USDC'].map((a) => (
          <label key={a}><input type="radio" name="asset" checked={form.asset === a}
            onChange={() => setForm({ ...form, asset: a })} /> {a}</label>
        ))}
      </div>
      <div className="radio-row">
        Settle mode:
        {['sync', 'optimistic'].map((m) => (
          <label key={m}><input type="radio" name="mode" checked={form.settleMode === m}
            onChange={() => setForm({ ...form, settleMode: m })} /> {m}</label>
        ))}
      </div>
      <label>Facilitator URL
        <input value={form.facilitatorUrl} onChange={set('facilitatorUrl')} className="input" />
      </label>
      <label>Webhook (optional)
        <input value={form.webhook} onChange={set('webhook')} placeholder="https://…" className="input" />
      </label>
      <div className="toolbar">
        <button className="btn" onClick={() => { onSave(form); }}>Save</button>
      </div>
      <h3>Paywall snippet</h3>
      <pre className="snippet">{snippet}</pre>
    </section>
  );
}

export default function App() {
  const [tab, setTab] = useState('endpoints');
  const [endpoints, setEndpoints] = useState(api.getEndpoints);
  const [settings, setSettings] = useState(api.getSettings);
  const payments = useMemo(api.getPayments, [tab]);
  return (
    <div className="app">
      <header>
        <h1>svp402 <span className="muted">seller dashboard · SVP testnet 2517</span></h1>
        <ConnectButton />
      </header>
      <nav>
        {['endpoints', 'revenue', 'receipts', 'settings'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      <main>
        {tab === 'endpoints' && <Endpoints endpoints={endpoints} onToggle={(p) => setEndpoints(api.toggleEndpoint(p))} />}
        {tab === 'revenue' && <Revenue payments={payments} />}
        {tab === 'receipts' && <Receipts payments={payments} />}
        {tab === 'settings' && <Settings settings={settings} onSave={(s) => { api.saveSettings(s); setSettings(s); }} />}
      </main>
    </div>
  );
}
