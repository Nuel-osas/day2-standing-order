import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Transaction } from '@mysten/sui/transactions';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as A from '../shared/allowance.js';
import { COINS, DAY_MS, explorer, fromUnits, toUnits, USDC, WEEK_MS, type CoinKey } from '../shared/constants.js';
import type { DecodedAbort } from '../shared/decode.js';
import { DEPLOYMENT } from '../shared/deployment.js';
import { periodRateLimit, type AllowanceIntent } from '../shared/intent.js';
import { balances, client, coinOf, listFunderAllowances, type AllowanceState } from './lib/chain';
import { burner, execWithKey, useFunder, type ExecResult } from './lib/funder';

const PRICE = BigInt(DEPLOYMENT.priceUnits);
const short = (s: string) => `${s.slice(0, 6)}...${s.slice(-4)}`;
const when = (ms: number | bigint | string | null | undefined) => (ms == null ? 'none' : new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 16) + ' UTC');

interface LogLine { at: string; label: string; ok: boolean; digest?: string; detail?: string; abort?: DecodedAbort }
interface Sub { kind: 'direct' | 'app'; allowanceId: string; capId: string; subscriptionId?: string }

function load<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

export default function App() {
	const funder = useFunder();
	const child = useMemo(() => burner('child'), []);
	const [log, setLog] = useState<LogLine[]>([]);
	const [bal, setBal] = useState<Awaited<ReturnType<typeof balances>> | null>(null);
	const [allowances, setAllowances] = useState<AllowanceState[]>([]);
	const [sub, setSub] = useState<Sub | null>(() => load('standing-order:sub', null));
	const [busy, setBusy] = useState('');
	const [tab, setTab] = useState<'subscribe' | 'family' | 'builder'>('subscribe');

	const push = (l: Omit<LogLine, 'at'>) => setLog((x) => [{ at: new Date().toLocaleTimeString(), ...l }, ...x].slice(0, 40));
	const report = (label: string, r: ExecResult) =>
		r.ok ? push({ label, ok: true, digest: r.digest }) : push({ label, ok: false, digest: r.digest, detail: r.error, abort: r.abort });

	const refresh = useCallback(async () => {
		if (!funder.address) return;
		const [b, a] = await Promise.all([balances(funder.address), listFunderAllowances(funder.address)]);
		setBal(b);
		setAllowances(a);
	}, [funder.address]);
	useEffect(() => { refresh(); }, [refresh]);

	async function step<T>(name: string, fn: () => Promise<T>) {
		setBusy(name);
		try { return await fn(); } finally { setBusy(''); refresh(); }
	}

	// --- funder utilities ---
	async function fundBurner() {
		const passcode = prompt('Demo passcode');
		if (!passcode) return;
		await step('fund', async () => {
			const r = await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: funder.address, passcode }) });
			const j = await r.json();
			push({ label: 'Fund demo funder', ok: r.ok, digest: j.digest, detail: j.error ?? j.skipped });
		});
	}
	async function coinsToAddressBalance() {
		await step('sweep', async () => {
			const { objects } = await client.listCoins({ owner: funder.address!, coinType: USDC });
			if (!objects.length) return push({ label: 'No USDC coin objects to move', ok: true });
			const tx = new Transaction();
			const [first, ...rest] = objects.map((c) => tx.object(c.objectId));
			if (rest.length) tx.mergeCoins(first, rest);
			tx.moveCall({ target: '0x2::coin::send_funds', typeArguments: [USDC], arguments: [first, tx.pure.address(funder.address!)] });
			report('USDC coins -> address balance', await funder.exec(tx));
		});
	}

	// --- 1. subscribe ---
	async function subscribe(kind: 'direct' | 'app') {
		await step('subscribe', async () => {
			const terms: A.AllowanceTerms = {
				coinType: USDC, name: kind === 'app' ? 'Standing Order Pro (app-bound)' : 'Standing Order Pro',
				spender: DEPLOYMENT.merchantAddress, lifetimeCap: PRICE * 12n, startMs: null,
				expiryMs: Date.now() + 365 * DAY_MS, rateLimit: { kind: 'monthly', limit: PRICE },
			};
			const r = await funder.exec(kind === 'app' ? A.subscribeAppBound(terms) : A.issueDirect(terms));
			report(`Subscribe (${kind})`, r);
			if (!r.ok) return;
			const s: Sub = {
				kind,
				allowanceId: r.details.createdOf('::allowance::Allowance<')!,
				capId: r.details.createdOf('::allowance::AllowanceCap<')!,
				subscriptionId: r.details.createdOf('::merchant::Subscription'),
			};
			setSub(s);
			save('standing-order:sub', s);
		});
	}
	async function merchantCharge(deliver: boolean) {
		if (!sub) return;
		await step('charge', async () => {
			const r = await fetch('/api/charge', {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ allowanceId: sub.allowanceId, subscriptionId: sub.subscriptionId, deliver }),
			});
			const j = await r.json();
			const label = sub.kind === 'app' ? (deliver ? 'Merchant: deliver + charge' : 'Merchant: charge (nothing delivered)') : 'Merchant: charge';
			push({ label, ok: !!j.ok, digest: j.digest, detail: j.ok ? `${fromUnits(j.amount, 6)} USDC pulled` : `${j.stage}: ${j.error}`, abort: j.abort });
		});
	}

	// --- 2. family ---
	const [famAmount, setFamAmount] = useState('0.1');
	const [famCoin, setFamCoin] = useState<CoinKey>('USDC');
	const [famAllowance, setFamAllowance] = useState<{ allowanceId: string; capId: string; coin: CoinKey } | null>(() => load('standing-order:family', null));
	async function giveAllowance() {
		await step('family', async () => {
			const c = COINS[famCoin];
			const tx = A.issueDirect({
				coinType: c.type, name: 'Pocket money', spender: child.toSuiAddress(), lifetimeCap: null, startMs: null,
				expiryMs: Date.UTC(2026, 11, 31), rateLimit: { kind: 'periodic', periodMs: WEEK_MS, limit: toUnits(famAmount, c.decimals) },
			});
			// Same signature: a little SUI so the child can pay gas for their own spends.
			tx.moveCall({ target: '0x2::balance::send_funds', typeArguments: [COINS.SUI.type], arguments: [tx.balance({ balance: 30_000_000n }), tx.pure.address(child.toSuiAddress())] });
			const r = await funder.exec(tx);
			report(`Give child ${famAmount} ${famCoin}/week`, r);
			if (!r.ok) return;
			const f = { allowanceId: r.details.createdOf('::allowance::Allowance<')!, capId: r.details.createdOf('::allowance::AllowanceCap<')!, coin: famCoin };
			setFamAllowance(f);
			save('standing-order:family', f);
		});
	}
	async function childSpend(amount: string) {
		if (!famAllowance) return;
		await step('child', async () => {
			const c = COINS[famAllowance.coin];
			const tx = A.spendDirect({ allowanceId: famAllowance.allowanceId, coinType: c.type, amount: toUnits(amount, c.decimals), recipient: DEPLOYMENT.merchantAddress });
			report(`Child spends ${amount} ${famAllowance.coin}`, await execWithKey(tx, child));
		});
	}
	async function revoke(a: { allowanceId: string; capId: string; coinType: string }, label: string) {
		await step('revoke', async () => {
			const r = await funder.exec(A.revoke(a));
			if (r.ok) {
				const g = r.details.t.effects!.gasUsed;
				push({ label, ok: true, digest: r.digest, detail: `storage rebate ${fromUnits(g.storageRebate, 9)} SUI vs computation ${fromUnits(g.computationCost, 9)} SUI` });
			} else report(label, r);
			if (famAllowance?.allowanceId === a.allowanceId) { setFamAllowance(null); save('standing-order:family', null); }
			if (sub?.allowanceId === a.allowanceId) { setSub(null); save('standing-order:sub', null); }
		});
	}

	// --- 3. natural-language builder ---
	const [text, setText] = useState('Give Tobi 2 USDC a week until December');
	const [intent, setIntent] = useState<AllowanceIntent | null>(null);
	const [intentErr, setIntentErr] = useState('');
	const [spenderInput, setSpenderInput] = useState('');
	async function parse() {
		setIntent(null); setIntentErr('');
		await step('parse', async () => {
			const r = await fetch('/api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, contacts: { Tobi: child.toSuiAddress() } }) });
			const j = await r.json();
			if (!r.ok) return setIntentErr(j.error ?? 'failed');
			setIntent(j.intent);
			setSpenderInput(j.intent.spender ?? '');
		});
	}
	async function signIntent() {
		if (!intent) return;
		await step('intent', async () => {
			const c = COINS[intent.coin];
			const units = BigInt(intent.amountUnits);
			const tx = A.issueDirect({
				coinType: c.type, name: intent.label, spender: spenderInput, startMs: intent.startMs, expiryMs: intent.expiryMs,
				lifetimeCap: intent.period === 'once' ? units : null, rateLimit: periodRateLimit(intent.period, units),
			});
			report(`Allowance: ${intent.label}`, await funder.exec(tx));
			setIntent(null);
		});
	}

	return (
		<div className="page">
			<header>
				<div>
					<h1>Standing Order</h1>
					<p className="muted">Subscriptions without custody. Native allowances on Sui testnet.</p>
				</div>
				<ConnectButton />
			</header>

			<section className="card funder">
				<div className="row">
					<strong>Funder</strong>
					<label><input type="radio" checked={funder.demo} onChange={() => funder.setMode(true)} /> Demo burner</label>
					<label><input type="radio" checked={!funder.demo} onChange={() => funder.setMode(false)} /> Connected wallet</label>
				</div>
				{funder.address ? (
					<div className="row">
						<a href={explorer('account', funder.address)} target="_blank" rel="noreferrer"><code>{short(funder.address)}</code></a>
						{bal && Object.entries(bal).map(([k, v]) => (
							<span key={k} className="pill">{k}: {fromUnits(v.address, k === 'SUI' ? 9 : 6)} address{BigInt(v.coin) > 0n ? ` + ${fromUnits(v.coin, k === 'SUI' ? 9 : 6)} in coins` : ''}</span>
						))}
						{funder.demo && <button onClick={fundBurner} disabled={!!busy}>Fund burner</button>}
						{bal && BigInt(bal.USDC.coin) > 0n && <button onClick={coinsToAddressBalance} disabled={!!busy}>Move USDC coins to address balance</button>}
						<button className="ghost" onClick={refresh}>Refresh</button>
					</div>
				) : <p className="muted">Connect a testnet wallet or switch to the demo burner.</p>}
				<p className="muted small">Allowances spend from the funder's address balance, never from coin objects.</p>
			</section>

			<nav>
				{(['subscribe', 'family', 'builder'] as const).map((t) => (
					<button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
						{t === 'subscribe' ? '1. Subscribe' : t === 'family' ? '2. Family' : '3. Describe it'}
					</button>
				))}
			</nav>

			{tab === 'subscribe' && (
				<section className="card">
					<h2>Standing Order Pro: {fromUnits(PRICE, 6)} USDC a month</h2>
					<p className="muted">One signature creates an allowance for the merchant: monthly rate limit {fromUnits(PRICE, 6)} USDC, lifetime cap {fromUnits(PRICE * 12n, 6)} USDC, expires in a year. Nothing leaves your balance until the merchant pulls.</p>
					<div className="row">
						<button onClick={() => subscribe('direct')} disabled={!!busy || !funder.address}>Subscribe (direct)</button>
						<button onClick={() => subscribe('app')} disabled={!!busy || !funder.address}>Subscribe (app-bound)</button>
					</div>
					{sub && (
						<div className="sub">
							<p>Current: <b>{sub.kind}</b> allowance <a href={explorer('object', sub.allowanceId)} target="_blank" rel="noreferrer"><code>{short(sub.allowanceId)}</code></a>
								{sub.subscriptionId && <> subscription <a href={explorer('object', sub.subscriptionId)} target="_blank" rel="noreferrer"><code>{short(sub.subscriptionId)}</code></a></>}</p>
							<p className="muted small">Merchant server (/api/charge, holds the spender key):</p>
							<div className="row">
								{sub.kind === 'direct' ? (
									<button onClick={() => merchantCharge(false)} disabled={!!busy}>Charge this month</button>
								) : (<>
									<button onClick={() => merchantCharge(false)} disabled={!!busy}>Charge without delivering</button>
									<button onClick={() => merchantCharge(true)} disabled={!!busy}>Deliver period + charge</button>
								</>)}
								<button className="danger" onClick={() => revoke({ allowanceId: sub.allowanceId, capId: sub.capId, coinType: USDC }, 'Cancel subscription (revoke)')} disabled={!!busy}>Cancel (revoke)</button>
							</div>
						</div>
					)}
				</section>
			)}

			{tab === 'family' && (
				<section className="card">
					<h2>Pocket money</h2>
					<p className="muted">Child address (burner in this browser): <a href={explorer('account', child.toSuiAddress())} target="_blank" rel="noreferrer"><code>{short(child.toSuiAddress())}</code></a>. Weekly periodic limit, ends 31 Dec 2026, revocable in one tap.</p>
					<div className="row">
						<input value={famAmount} onChange={(e) => setFamAmount(e.target.value)} size={6} />
						<select value={famCoin} onChange={(e) => setFamCoin(e.target.value as CoinKey)}><option>USDC</option><option>SUI</option></select>
						<span>per week</span>
						<button onClick={giveAllowance} disabled={!!busy || !funder.address}>Give allowance</button>
					</div>
					{famAllowance && (
						<div className="sub">
							<p>Allowance <a href={explorer('object', famAllowance.allowanceId)} target="_blank" rel="noreferrer"><code>{short(famAllowance.allowanceId)}</code></a></p>
							<div className="row">
								<button onClick={() => childSpend('0.03')} disabled={!!busy}>Child spends 0.03 {famAllowance.coin}</button>
								<button onClick={() => childSpend(famAmount)} disabled={!!busy}>Child tries the full week again</button>
								<button className="danger" onClick={() => revoke({ allowanceId: famAllowance.allowanceId, capId: famAllowance.capId, coinType: COINS[famAllowance.coin].type }, 'Revoke pocket money')} disabled={!!busy}>Revoke</button>
							</div>
						</div>
					)}
				</section>
			)}

			{tab === 'builder' && (
				<section className="card">
					<h2>Describe the allowance</h2>
					<p className="muted">DeepSeek turns the sentence into parameters on the server. The server validates them strictly; you confirm and sign. Nothing is signed automatically. "Tobi" resolves to the child burner.</p>
					<div className="row">
						<input className="grow" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
						<button onClick={parse} disabled={!!busy}>Parse</button>
					</div>
					{intentErr && <p className="err">Rejected: {intentErr}</p>}
					{intent && (
						<div className="sub">
							<table><tbody>
								<tr><td>Label</td><td>{intent.label}</td></tr>
								<tr><td>Spender</td><td><input className="grow" value={spenderInput} onChange={(e) => setSpenderInput(e.target.value)} placeholder="0x..." /> {intent.spenderName && <span className="muted">({intent.spenderName})</span>}</td></tr>
								<tr><td>Amount</td><td>{intent.amount} {intent.coin} {intent.period === 'once' ? 'in total' : `per ${intent.period}`}</td></tr>
								<tr><td>Starts</td><td>{when(intent.startMs) === 'none' ? 'now' : when(intent.startMs)}</td></tr>
								<tr><td>Expires</td><td>{when(intent.expiryMs)}</td></tr>
							</tbody></table>
							{intent.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
							<button onClick={signIntent} disabled={!!busy || !/^0x[0-9a-fA-F]{64}$/.test(spenderInput)}>Confirm and sign</button>
						</div>
					)}
				</section>
			)}

			<section className="card">
				<h2>Allowances you granted <span className="muted small">(found through your AllowanceCaps)</span></h2>
				{allowances.length === 0 && <p className="muted">None.</p>}
				{allowances.map((a) => {
					const c = coinOf(a.coinType);
					const rl = a.settings.rate_limit?.Windowed;
					const win = rl ? (rl.window.PeriodicMs != null ? `${Number(rl.window.PeriodicMs) / DAY_MS} days` : `${rl.window.CalendarMonths} calendar month(s)`) : null;
					return (
						<div key={a.id} className="allowance">
							<div className="row"><b>{a.settings.name}</b>{a.settings.app && <span className="pill">app-bound</span>}<span className="pill">{c.symbol}</span></div>
							<div className="small muted">
								to <code>{short(a.settings.spender ?? '')}</code> · spent {fromUnits(a.current_spend, c.decimals)}
								{a.settings.lifetime_cap && <> of {fromUnits(a.settings.lifetime_cap, c.decimals)} lifetime</>}
								{rl && <> · this window {fromUnits(rl.spent, c.decimals)} / {fromUnits(rl.limit, c.decimals)} per {win} · window #{rl.index} · anchored {rl.anchor_ms ? when(rl.anchor_ms) : 'at first spend'}</>}
								{' '}· expires {when(a.settings.expiration_timestamp_ms)}
							</div>
							<button className="danger small" onClick={() => revoke({ allowanceId: a.id, capId: a.capId!, coinType: a.coinType }, `Revoke ${a.settings.name}`)} disabled={!!busy}>Revoke</button>
						</div>
					);
				})}
			</section>

			<section className="card">
				<h2>Log {busy && <span className="muted small">working: {busy}...</span>}</h2>
				{log.map((l, i) => (
					<div key={i} className={l.ok ? 'log ok' : 'log bad'}>
						<span className="muted">{l.at}</span> <b>{l.label}</b>{' '}
						{l.digest && <a href={explorer('tx', l.digest)} target="_blank" rel="noreferrer"><code>{short(l.digest)}</code></a>}
						{l.abort && l.abort.name !== 'Unknown' && <div className="abort">{l.abort.module}::{l.abort.name} (code {l.abort.code}): {l.abort.meaning}</div>}
						{l.detail && <div className="small muted">{l.detail}</div>}
					</div>
				))}
			</section>

			<footer className="muted small">
				Package <a href={explorer('object', DEPLOYMENT.packageId)} target="_blank" rel="noreferrer"><code>{short(DEPLOYMENT.packageId)}</code></a> · merchant <code>{short(DEPLOYMENT.merchantAddress)}</code> · <a href="https://github.com/Nuel-osas/day2-standing-order" target="_blank" rel="noreferrer">source</a> · Account Layer Week, SuiHub Lagos
			</footer>
		</div>
	);
}
