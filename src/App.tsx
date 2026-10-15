import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Transaction } from '@mysten/sui/transactions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { issueDirect, revoke } from '../shared/allowance.js';
import { DEMO, windowState } from '../shared/demo.js';
import { explorer, fromUnits, SUI } from '../shared/constants.js';
import { balances, client, listFunderAllowances, type AllowanceState } from './lib/chain';
import { burner, useFunder, type ExecResult } from './lib/funder';
import { collectPayment } from './lib/merchant';

const short = (s: string) => `${s.slice(0, 7)}…${s.slice(-5)}`;
const units = (n: bigint | string) => fromUnits(n, 9);
const DOCS = 'https://docs.sui.io/onchain-finance/allowances/allowances-overview';
type Receipt = { id: string; at: number; title: string; detail: string; kind: 'success' | 'blocked' | 'error'; digest?: string };
type Funder = ReturnType<typeof useFunder>;
type WalletBalance = { coin: string; address: string; change: { amount: bigint; at: number } | null };
const totalBalance = (b: { coin: string; address: string }) => BigInt(b.coin) + BigInt(b.address);
function nextBalance(previous: WalletBalance | null, next: { coin: string; address: string }, at: number): WalletBalance {
  const difference = previous ? totalBalance(next) - totalBalance(previous) : 0n;
  return { ...next, change: difference !== 0n ? { amount: difference, at } : previous?.change ?? null };
}
async function readWalletBalance(owner: string) {
  const { balance } = await client.getBalance({ owner, coinType: SUI });
  return { coin: balance.coinBalance, address: balance.addressBalance };
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h16m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function Mark() {
  return <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden="true"><path d="M9 9h15l-4-4M23 23H8l4 4M25 10a10 10 0 0 1-1 12M7 22A10 10 0 0 1 8 10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function BalanceCard({ role, address, balance, loading, failed, payment, source }: { role: 'Payer' | 'Merchant'; address?: string; balance: WalletBalance | null; loading: boolean; failed: boolean; payment?: Receipt; source: string }) {
  const change = balance?.change;
  const direction = change ? change.amount > 0n ? 'increase' : 'decrease' : '';
  return <article className={`wallet-balance ${role.toLowerCase()}`} aria-label={`${role} balance`}>
    <div className="balance-card-heading"><h3>{role}</h3><span className={`flow-badge ${role === 'Payer' ? 'outgoing' : 'incoming'}`} aria-label={role === 'Payer' ? 'Outgoing payments' : 'Incoming payments'}><span aria-hidden="true">{role === 'Payer' ? '↗' : '↙'}</span>{role === 'Payer' ? 'OUT' : 'IN'}</span></div>
    <p className="balance-wallet-source">{source}</p>
    {address ? <a className="address-link mono" href={explorer('account', address)} target="_blank" rel="noreferrer" aria-label={`View ${role.toLowerCase()} account`}>{short(address)} <Arrow diagonal /></a> : <span className="balance-address-placeholder">{role === 'Payer' ? 'No wallet connected' : 'No payer selected'}</span>}
    <div className="wallet-total" aria-live="polite" aria-atomic="true">
      {balance ? <strong key={change?.at ?? 'initial'} className={direction} data-balance={totalBalance(balance).toString()}>{units(totalBalance(balance))} <span>SUI</span></strong> : <span className="balance-placeholder">{!address ? role === 'Payer' ? 'Connect a wallet' : 'Choose a payer' : loading ? 'Loading…' : 'Unavailable'}</span>}
    </div>
    <div className={`balance-change ${direction}`} aria-live="polite">
      {change ? <><b>{change.amount > 0n ? '↑ +' : '↓ −'}{units(change.amount < 0n ? -change.amount : change.amount)} SUI</b><span>Last change · {new Date(change.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></> : <span>{address ? 'Watching for balance changes' : 'Choose a wallet above'}</span>}
    </div>
    {payment?.digest && <div className={`payment-credit ${role === 'Payer' ? 'outgoing' : 'incoming'}`}><span>Last {role === 'Payer' ? 'sent' : 'received'}<small>Before gas</small></span><a href={explorer('tx', payment.digest)} target="_blank" rel="noreferrer" aria-label={`View last payment ${role === 'Payer' ? 'sent' : 'received'}`}>{role === 'Payer' ? '−' : '+'}{units(DEMO.price)} SUI <Arrow diagonal /></a></div>}
    {balance && <dl className="balance-breakdown"><div><dt>Address balance</dt><dd>{units(balance.address)} SUI</dd></div><div><dt>Coin objects</dt><dd>{units(balance.coin)} SUI</dd></div></dl>}
    {failed && <p className="balance-error" role="status">{balance ? 'Update failed. Showing the last balance.' : 'Could not load this balance.'} Try Refresh.</p>}
  </article>;
}

export default function App() {
  const funder = useFunder();
  const [busy, setBusy] = useState(false);
  return <div className="app-shell">
    <header className="topbar">
      <a href="#" className="brand"><span className="brand-mark"><Mark /></span>Standing Order<span className="brand-tag">LAB</span></a>
      <div className="header-links"><a href={DOCS} target="_blank" rel="noreferrer">Read the docs <Arrow diagonal /></a><span className="network"><i /> Sui testnet</span></div>
    </header>
    <main>
      <section className="intro">
        <div><p className="eyebrow"><span /> THE ALLOWANCE PLAYGROUND</p><h1>Permission once.<br /><span>Control, always.</span></h1><p className="intro-copy">Give a merchant permission to charge within your rules.<br className="desktop-break" /> Watch Sui enforce them. Take that permission back anytime.</p></div>
        <div className="intro-note"><div className="orbit"><Mark /></div><p>Real transactions.<br />Free test funds.<br /><b>Your rules, onchain.</b></p></div>
      </section>
      <div className="workspace-heading"><div className="workspace-title"><span className="live-dot" /> Live subscription demo</div><span className="mono">01 / NATIVE ALLOWANCES</span></div>
      <section className="wallet-strip" aria-label="Choose your wallet">
        <div className="wallet-choice"><span className="wallet-icon">↳</span><div><span className="small-label">PAYING FROM</span><div className="segmented"><button disabled={busy} aria-pressed={funder.demo} className={funder.demo ? 'selected' : ''} onClick={() => funder.setMode(true)}>Demo wallet</button><button disabled={busy} aria-pressed={!funder.demo} className={!funder.demo ? 'selected' : ''} onClick={() => funder.setMode(false)}>My wallet</button></div></div></div>
        <div className="wallet-identity">{funder.address && <a className="address-link mono" href={explorer('account', funder.address)} target="_blank" rel="noreferrer">{short(funder.address)} <Arrow diagonal /></a>}{!funder.demo && <ConnectButton />}<span className="wallet-caption">{funder.demo ? 'Created in this browser · testnet only' : funder.isWallet ? 'Connected account pays · Sui testnet' : 'Connect your wallet to use it as the payer'}</span></div>
      </section>
      <Workspace key={funder.address ?? 'disconnected'} funder={funder} onBusy={setBusy} />
      <section className="explain" id="how-it-works"><div className="explain-heading"><p className="eyebrow">WHAT JUST HAPPENED?</p><h2>A standing permission.<br />A limit on every payment.</h2><a href={DOCS} target="_blank" rel="noreferrer">Explore native allowances <Arrow diagonal /></a></div><div className="explain-steps">
        <article><span>01</span><div><h3>You grant permission</h3><p>Your signature names the spender and sets the budget. Creating an allowance doesn’t lock or transfer your funds.</p></div></article>
        <article><span>02</span><div><h3>The merchant requests a payment</h3><p>The merchant signs the charge. Sui checks the permission, available balance, time window, and limits.</p></div></article>
        <article><span>03</span><div><h3>You stay in control</h3><p>Your budget renews each period. Revoke permission to stop future charges. Completed payments aren’t reversed.</p></div></article>
      </div></section>
    </main>
    <footer><a className="brand footer-brand" href="#"><Mark /> Standing Order</a><span>Built for Account Layer Week · SuiHub Lagos</span><a href="https://github.com/Nuel-osas/day2-standing-order" target="_blank" rel="noreferrer">View source <Arrow diagonal /></a></footer>
  </div>;
}

function Workspace({ funder, onBusy }: { funder: Funder; onBusy: (v: boolean) => void }) {
  const [merchantKey] = useState(() => funder.address ? burner(`merchant:${funder.address}`) : null);
  const merchantAddress = merchantKey?.toSuiAddress();
  const receiptsKey = merchantAddress ? `standing-order:receipts:${funder.address}:${merchantAddress}` : null;
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [merchantBalance, setMerchantBalance] = useState<WalletBalance | null>(null);
  const [balanceErrors, setBalanceErrors] = useState({ payer: false, merchant: false });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [allowances, setAllowances] = useState<AllowanceState[]>([]);
  const [previousAllowances, setPreviousAllowances] = useState<AllowanceState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [revokedId, setRevokedId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>(() => {
    try { return receiptsKey ? JSON.parse(localStorage.getItem(receiptsKey) ?? '[]') : []; } catch { return []; }
  });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [auto, setAuto] = useState(false);
  const [copied, setCopied] = useState<'payer' | 'merchant' | null>(null);
  const lock = useRef(false);
  const refreshing = useRef<Promise<void> | null>(null);
  const lastAutoAttempt = useRef(0);
  const autoCharge = useRef<() => void>(() => {});
  const allowance = allowances.find(a => a.id === selected) ?? allowances[0] ?? null;
  const state = allowance ? windowState(allowance, now) : null;
  const merchantReady = merchantBalance != null && totalBalance(merchantBalance) >= 30_000_000n;
  const ready = balance != null && BigInt(balance.address) >= DEMO.lifetimeCap && totalBalance(balance) >= 30_000_000n && merchantReady;
  const totalSpent = allowance ? BigInt(allowance.current_spend) : 0n;
  const lastPayment = receipts.find(r => r.kind === 'success' && r.digest && (r.title === 'Payment collected' || r.title === 'Auto-charge completed'));
  const exhausted = !!state && state.lifetimeLeft < DEMO.price;
  const seconds = state?.nextReset ? Math.max(0, Math.ceil((state.nextReset - now) / 1000)) : null;
  const remainingPercent = state ? Math.min(100, Number(state.available) / Number(DEMO.price) * 100) : 100;

  const refresh = useCallback(async (afterAction = false) => {
    if (refreshing.current) {
      await refreshing.current;
      if (!afterAction) return;
    }
    setIsRefreshing(true);
    const request = (async () => {
      const [payer, merchant, all] = await Promise.allSettled([
        funder.address ? readWalletBalance(funder.address) : Promise.resolve(null),
        merchantAddress ? readWalletBalance(merchantAddress) : Promise.resolve(null),
        funder.address ? listFunderAllowances(funder.address) : Promise.resolve([]),
      ]);
      const at = Date.now();
      if (payer.status === 'fulfilled' && payer.value) {
        const value = payer.value;
        setBalance(previous => nextBalance(previous, value, at));
      }
      if (merchant.status === 'fulfilled' && merchant.value) {
        const value = merchant.value;
        setMerchantBalance(previous => nextBalance(previous, value, at));
      }
      setBalanceErrors({ payer: payer.status === 'rejected', merchant: merchant.status === 'rejected' });
      if (all.status === 'fulfilled') {
        const demoAllowances = all.value.filter(a => a.settings.name === DEMO.name);
        setAllowances(demoAllowances.filter(a => a.settings.spender === merchantAddress));
        setPreviousAllowances(demoAllowances.filter(a => a.settings.spender !== merchantAddress));
      }
      else setError('Could not refresh allowances on Sui testnet. Check your connection and try Refresh.');
    })();
    refreshing.current = request;
    try { await request; }
    finally { refreshing.current = null; setIsRefreshing(false); setLoading(false); }
  }, [funder.address, merchantAddress]);

  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 8000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { try { if (receiptsKey) localStorage.setItem(receiptsKey, JSON.stringify(receipts)); } catch { /* private browsing */ } }, [receipts, receiptsKey]);
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => autoCharge.current(), 1000);
    return () => clearInterval(timer);
  }, [auto]);

  function record(title: string, detail: string, kind: Receipt['kind'], digest?: string) {
    setReceipts(r => [{ id: crypto.randomUUID(), at: Date.now(), title, detail, kind, digest }, ...r].slice(0, 30));
  }
  async function action(label: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(label); onBusy(true); setError('');
    try { await fn(); }
    catch (e) { const message = e instanceof Error ? e.message : 'Something went wrong. Please try again.'; setError(message); record(label, message, 'error'); }
    finally { await refresh(true); setBusy(''); onBusy(false); lock.current = false; }
  }
  function successful(r: ExecResult) {
    if (r.ok === false) throw new Error(r.abort?.meaning ?? r.error);
    return r;
  }
  async function post(path: string, body: object) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(path === '/api/test-funds' ? 170_000 : 55_000) });
    let data;
    try { data = await r.json(); } catch { throw new Error('The demo service is unavailable. Please try again.'); }
    return { response: r, data };
  }
  function prepare() {
    void action('Preparing test funds', async () => {
      if (!funder.address || !merchantAddress) throw new Error('Connect a testnet wallet first.');
      let b = (await balances(funder.address)).SUI;
      if (BigInt(b.coin) + BigInt(b.address) < 100_000_000n) {
        const { response, data } = await post('/api/test-funds', { address: funder.address });
        if (!response.ok) throw new Error(data.error);
        if (data.digest) await client.waitForTransaction({ digest: data.digest });
        b = (await balances(funder.address)).SUI;
        record('Test funds received', 'Free SUI from the public testnet faucet. These tokens have no monetary value.', 'success', data.digest);
      }
      if (BigInt(b.address) < DEMO.deposit) {
        const amount = DEMO.deposit - BigInt(b.address);
        const tx = new Transaction();
        const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
        tx.moveCall({ target: '0x2::coin::send_funds', typeArguments: [SUI], arguments: [coin, tx.pure.address(funder.address)] });
        const r = successful(await funder.exec(tx));
        record('Spending balance ready', `${units(amount)} test SUI moved into your own address balance. It remains yours to use.`, 'success', r.digest);
      } else record('Spending balance ready', 'Your address balance already has enough test SUI for this demo.', 'success');
      await fundMerchant();
    });
  }
  async function fundMerchant() {
    if (!merchantAddress) throw new Error('Choose a payer to create your personal demo merchant.');
    const current = await readWalletBalance(merchantAddress);
    if (totalBalance(current) >= 30_000_000n) return;
    const { response, data } = await post('/api/test-funds', { address: merchantAddress });
    if (!response.ok) throw new Error(`Merchant funding: ${data.error}`);
    if (data.digest) await client.waitForTransaction({ digest: data.digest });
    record('Merchant gas funded', 'Free test SUI funded your own merchant wallet. This is gas funding, not a subscription payment.', 'success', data.digest);
  }
  function grant() {
    void action('Granting permission', async () => {
      if (!merchantAddress) throw new Error('Choose a payer first.');
      const r = successful(await funder.exec(issueDirect({
        coinType: SUI, name: DEMO.name, spender: merchantAddress,
        lifetimeCap: DEMO.lifetimeCap, startMs: null, expiryMs: Date.now() + DEMO.durationMs,
        rateLimit: { kind: 'periodic', periodMs: DEMO.periodMs, limit: DEMO.price },
      })));
      const id = r.details.createdOf('::allowance::Allowance<');
      if (!id) throw new Error(`Transaction succeeded (${r.digest}), but the allowance has not appeared yet. Refresh to recover it.`);
      setSelected(id); setRevokedId(null);
      record('Permission granted', 'You approved 0.001 SUI per minute, up to 0.006 SUI total. No subscription payment has moved yet.', 'success', r.digest);
    });
  }
  function charge(id = allowance?.id ?? revokedId, automatic = false) {
    if (!id || !merchantKey || !funder.address) return;
    void action(automatic ? 'Automatic merchant charge' : 'Requesting merchant charge', async () => {
      const data = await collectPayment(merchantKey, funder.address!, id);
      if (data.ok === false) {
        const known = ['EExceedsRateLimit', 'EExceedsLifetimeCap', 'EExpired', 'AllowanceGone'].includes(data.code);
        const title = data.code === 'EExceedsRateLimit' ? 'Extra charge blocked' : data.code === 'AllowanceGone' ? 'Revoked permission blocked' : data.code === 'EExceedsLifetimeCap' ? 'Lifetime cap enforced' : data.code === 'EExpired' ? 'Expired permission blocked' : 'Charge could not complete';
        record(title, `${data.error}${data.stage === 'simulate' ? ' Rejected in simulation; no payment or execution gas was spent.' : ''}`, known ? 'blocked' : 'error', data.digest);
        if (automatic && !known) setAuto(false);
        return;
      }
      record(automatic ? 'Auto-charge completed' : 'Payment collected', 'The merchant collected 0.001 test SUI using its own signature. Your wallet did not sign this charge.', 'success', data.digest);
    });
  }
  autoCharge.current = () => {
    if (!allowance || !state || state.expired || exhausted) { setAuto(false); return; }
    if (state.available >= DEMO.price && !lock.current && Date.now() - lastAutoAttempt.current >= 10_000) {
      lastAutoAttempt.current = Date.now(); charge(allowance.id, true);
    }
  };
  function cancel() {
    if (!allowance?.capId) return;
    const a = allowance;
    setAuto(false);
    void action('Revoking permission', async () => {
      const r = successful(await funder.exec(revoke({ allowanceId: a.id, capId: a.capId!, coinType: SUI })));
      setRevokedId(a.id); setSelected(null);
      record('Permission revoked', 'The allowance was deleted onchain. The merchant can no longer charge against it.', 'success', r.digest);
    });
  }
  function revokePrevious(a: AllowanceState) {
    if (!a.capId) return;
    void action('Revoking previous permission', async () => {
      const result = successful(await funder.exec(revoke({ allowanceId: a.id, capId: a.capId!, coinType: a.coinType })));
      record('Previous permission revoked', 'The old merchant can no longer use this allowance.', 'success', result.digest);
    });
  }
  async function copyAddress(role: 'payer' | 'merchant' = 'payer') {
    const address = role === 'payer' ? funder.address : merchantAddress;
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setCopied(role); setTimeout(() => setCopied(null), 2000); }
    catch { setError('Could not copy the address. Open the address link above to view it in the explorer.'); }
  }
  const step = !ready ? 1 : !allowance ? revokedId ? 4 : 2 : totalSpent === 0n ? 3 : 4;
  const status = !allowance ? revokedId ? 'Revoked' : 'Not authorised' : state?.expired ? 'Expired' : exhausted ? 'Budget completed' : state?.available === 0n ? 'Waiting for renewal' : 'Ready to charge';

  return <>
    <section className="payment-balances" aria-label="Live payment balances">
      <div className="section-title"><div><h2>Follow the payment</h2><p>Live wallet totals · updates every 8 seconds and after each action</p></div><button className="refresh" onClick={() => void refresh()} disabled={!!busy || isRefreshing}>{isRefreshing ? '↻ Updating…' : '↻ Refresh'}</button></div>
      <div className="balance-pair">
        <BalanceCard role="Payer" address={funder.address} balance={balance} loading={loading} failed={balanceErrors.payer} payment={lastPayment} source={funder.demo ? 'Browser demo wallet' : funder.isWallet ? 'Connected wallet' : 'Your wallet · not connected'} />
        <span className={`payment-direction ${lastPayment && now - lastPayment.at < 4000 ? 'flowing' : ''}`} aria-hidden="true"><Arrow /></span>
        <BalanceCard role="Merchant" address={merchantAddress} balance={merchantBalance} loading={loading} failed={balanceErrors.merchant} payment={lastPayment} source="Your personal demo merchant" />
      </div>
      <div className="merchant-setup"><div><span className="small-label">YOUR OWN MERCHANT</span><p>{merchantAddress ? 'Created for this payer and saved in this browser. Other students use different merchant wallets.' : 'Choose a payer to create its own merchant wallet.'}</p></div><div className="merchant-tools">{merchantReady ? <span className="gas-ready">✓ Gas funded</span> : <button className="button secondary" disabled={!!busy || !merchantAddress || loading} onClick={() => void action('Funding merchant gas', fundMerchant)}>Get merchant gas</button>}<button className="text-button" onClick={() => void copyAddress('merchant')} disabled={!merchantAddress}>{copied === 'merchant' ? 'Copied!' : 'Copy merchant address'}</button></div></div>
      <p className="balance-explanation">Each payment moves <b>0.001 SUI</b> from your address balance to your merchant. Red marks money sent; green marks money received. The merchant pays gas, which can exceed this tiny test payment and make its wallet total decrease.</p>
    </section>
    <div className="demo-grid">
      <section className="plan-card" aria-label="Subscription allowance">
        <div className="plan-top"><span className="plan-icon"><Mark /></span><div><p className="small-label">YOUR DEMO SUBSCRIPTION</p><h2>One-minute club</h2></div><span className="outline-tag">TEST SUI</span></div>
        <div className="price"><span>0.001</span><div>SUI <span>/ minute</span></div></div>
        <p className="plan-description">A real recurring budget, sped up for the classroom.<br />Every minute is a new spending window.</p>
        <div className="terms"><div><span>Maximum per minute</span><b>0.001 SUI</b></div><div><span>Total spending cap</span><b>0.006 SUI <em>· 6 payments</em></b></div><div><span>Permission expires</span><b>24 hours after approval</b></div><div><span>Cancel permission</span><b>Anytime <span className="tiny-check">✓</span></b></div></div>
        <div className="budget-panel">
          <div className="budget-heading"><span>Available this window</span><span className={`status ${allowance ? 'active' : ''}`}><i />{status}</span></div>
          <div className="budget-amount">{allowance ? units(state!.available) : '0.001'} <span>SUI</span>{seconds !== null && !state?.expired && !exhausted && <span className="countdown" aria-label="Time until budget renews">renews in <b>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</b></span>}</div>
          <div className="budget-track" role="progressbar" aria-label="Available recurring budget" aria-valuenow={allowance ? remainingPercent : 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${allowance ? remainingPercent : 0}%` }} /></div>
          <div className="budget-foot"><span>{allowance ? `${units(totalSpent)} / 0.006 SUI collected` : 'Budget starts with the first payment'}</span><span>{allowance ? `Window ${state!.index + 1}` : 'Nothing locked'}</span></div>
        </div>
        <div className="primary-action">{!allowance ? <button className="button primary" onClick={grant} disabled={!!busy || !ready || merchantReady !== true}>{busy === 'Granting permission' ? 'Waiting for approval…' : revokedId ? 'Grant a new allowance' : 'Approve this allowance'}<Arrow /></button> : <><button className="button primary" onClick={() => charge()} disabled={!!busy || merchantReady !== true}>{busy.includes('charge') ? 'Checking the allowance…' : state?.available === 0n ? 'Try another charge' : 'Collect 0.001 SUI'}<Arrow /></button><button className="button revoke" onClick={cancel} disabled={!!busy}>Revoke permission</button></>}</div>
        {revokedId && !allowance && <button className="text-button check-revoked" onClick={() => charge(revokedId)} disabled={!!busy}>Try charging the revoked allowance <Arrow /></button>}
        {!ready && <p className="action-hint">Prepare both test wallets in step 1 to get started.</p>}
        {allowance && <div className="auto-charge"><label><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} disabled={!!busy || exhausted || state?.expired || merchantReady !== true} /><span className="switch" /><span>Auto-charge when the budget renews</span></label><p>Runs while this tab is open. The merchant submits each payment; the allowance enforces the limit.</p></div>}
        {allowance && <a className="object-link mono" href={explorer('object', allowance.id)} target="_blank" rel="noreferrer">Allowance {short(allowance.id)} <Arrow diagonal /></a>}
        {allowances.length > 1 && <label className="allowance-select">Your active demo allowances<select value={allowance?.id} onChange={e => { setSelected(e.target.value); setAuto(false); }} disabled={!!busy}>{allowances.map(a => <option key={a.id} value={a.id}>{short(a.id)} · {units(a.current_spend)} SUI spent</option>)}</select></label>}
      </section>
      <aside className="guide-card">
        <div className="section-title"><h2>Try the full cycle</h2><span className="mono">~ 2 MIN</span></div>
        <ol className="guide">
          <li className={ready ? 'done' : 'current'}><span className="step-number">{ready ? '✓' : '1'}</span><div><h3>Prepare both test wallets</h3><p>Get free SUI for your payer and your own merchant. The payer needs an address balance; the merchant needs gas to collect payments.</p><button className="button secondary" onClick={prepare} disabled={!!busy || !funder.address || loading}>{busy === 'Preparing test funds' ? 'Preparing…' : ready ? 'Top up test funds' : 'Get test funds'}<Arrow /></button><div className="funding-links"><a href="https://faucet.sui.io/?network=testnet" target="_blank" rel="noreferrer">Open Sui faucet ↗</a><button onClick={() => void copyAddress()} disabled={!funder.address}>{copied === 'payer' ? 'Copied!' : 'Copy payer address'}</button></div></div></li>
          <li className={allowance || revokedId ? 'done' : step === 2 ? 'current' : ''}><span className="step-number">{allowance || revokedId ? '✓' : '2'}</span><div><h3>Approve once</h3><p>Review the limits on the left. Grant the merchant permission with one signature.</p></div></li>
          <li className={totalSpent > 0n || revokedId ? 'done' : step === 3 ? 'current' : ''}><span className="step-number">{totalSpent > 0n || revokedId ? '✓' : '3'}</span><div><h3>Charge, then try again</h3><p>The first payment succeeds. A second in the same minute is rejected by Sui.</p></div></li>
          <li className={step === 4 ? 'current' : ''}><span className="step-number">4</span><div><h3>Watch it renew. Or revoke.</h3><p>After 60 seconds the budget resets. Revoke to stop future charges immediately.</p></div></li>
        </ol>
        <div className="testnet-note"><span>ⓘ</span><p>{funder.demo ? 'Both demo keys are saved in this browser. Use them only for free testnet tokens.' : 'Your connected wallet keeps its own key. Your demo merchant’s key is saved in this browser and signs testnet charges locally.'} Clearing browser storage removes the demo keys.</p></div>
      </aside>
    </div>
    {previousAllowances.length > 0 && <section className="previous-permissions" aria-label="Previous merchant permissions"><h2>Previous merchant permissions</h2><p>These permissions belong to an older or different merchant. You can revoke them here; new payments use your personal merchant above.</p>{previousAllowances.map(a => <div key={a.id}><a className="address-link mono" href={explorer('object', a.id)} target="_blank" rel="noreferrer">{short(a.id)} <Arrow diagonal /></a><button className="button revoke" disabled={!!busy} onClick={() => revokePrevious(a)}>Revoke old permission</button></div>)}</section>}
    {error && <div className="notice" role="alert">{error}</div>}
    {busy && <div className="busy-notice" role="status"><span className="spinner" />{busy}…{(busy === 'Preparing test funds' || busy === 'Funding merchant gas') && <span className="funding-wait">The faucet can take a minute per wallet.</span>}</div>}
    <section className="activity" aria-label="Transaction activity"><div className="section-title"><h2>Activity <span className="count-badge">{receipts.length}</span></h2><span className="mono">ONCHAIN RECEIPTS</span></div><div className="activity-heading"><span>EVENT</span><span>TIME / RECEIPT</span></div>
      <div aria-live="polite">{receipts.length === 0 ? <div className="empty-activity"><span className="empty-icon">↗</span><div><h3>Your first transaction starts here.</h3><p>Prepare your wallet to see real testnet receipts. Blocked attempts appear here too.</p></div></div> : receipts.map(r => <article className="receipt" key={r.id}><span className={`receipt-icon ${r.kind}`}>{r.kind === 'success' ? '✓' : r.kind === 'blocked' ? '⊘' : '!'}</span><div className="receipt-description"><h3>{r.title}{r.kind === 'blocked' && <span className="guard-tag">RULE ENFORCED</span>}</h3><p>{r.detail}</p></div><div className="receipt-meta"><time dateTime={new Date(r.at).toISOString()}>{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>{r.digest ? <a className="mono" href={explorer('tx', r.digest)} target="_blank" rel="noreferrer">{short(r.digest)} <Arrow diagonal /></a> : <span className="no-receipt">No onchain receipt</span>}</div></article>)}</div>
    </section>
  </>;
}
