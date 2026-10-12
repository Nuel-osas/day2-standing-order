// Runs every Standing Order flow on testnet and records digests to scripts/out/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Keypair } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

import * as A from '../shared/allowance.js';
import { DAY_MS, SUI, USDC, WEEK_MS } from '../shared/constants.js';
import { decodeAbort } from '../shared/decode.js';
import { DEPLOYMENT } from '../shared/deployment.js';
import { client, day2, merchant, namedKey, ROOT } from './env.js';
import { created, run } from './tx.js';

const funder = day2();
const shop = merchant();
const child = namedKey('child');
const F = funder.toSuiAddress(), M = shop.toSuiAddress(), C = child.toSuiAddress();
const PRICE = BigInt(DEPLOYMENT.priceUnits);
const log: Record<string, unknown> = { at: new Date().toISOString(), package: DEPLOYMENT.packageId };

async function expectReject(label: string, tx: Transaction, signer: Keypair, onChain = false) {
	tx.setSenderIfNotSet(signer.toSuiAddress());
	const sim = await client.simulateTransaction({ transaction: tx, include: { effects: true } }).catch((e: Error) => e);
	let entry: Record<string, unknown>;
	if (sim instanceof Error) entry = { stage: 'build/simulate', error: sim.message, decoded: decodeAbort(sim) };
	else if (sim.$kind === 'FailedTransaction') entry = { stage: 'simulate', error: sim.FailedTransaction.status.error?.message, decoded: decodeAbort(sim.FailedTransaction.status.error) };
	else throw new Error(`${label}: expected a rejection, simulation succeeded`);
	if (onChain) {
		tx.setGasBudget(20_000_000n);
		const r = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true } }).catch((e: Error) => e);
		if (r instanceof Error) entry.onChain = { error: r.message };
		else if (r.$kind === 'FailedTransaction') entry.onChain = { digest: r.FailedTransaction.digest, error: r.FailedTransaction.status.error?.message };
		else throw new Error(`${label}: executed successfully, expected failure`);
		if (r && !(r instanceof Error) && r.$kind === 'FailedTransaction') await client.waitForTransaction({ digest: r.FailedTransaction.digest });
	}
	console.log(`${label}: REJECTED`, JSON.stringify(entry, null, 1));
	log[label] = entry;
}

// --- 1. Direct subscription: monthly 0.05 USDC, funder day2, spender merchant ---
{
	const t = await run(A.issueDirect({
		coinType: USDC, name: 'Standing Order: monthly plan', spender: M,
		lifetimeCap: PRICE * 12n, startMs: null, expiryMs: Date.now() + 365 * DAY_MS,
		rateLimit: { kind: 'monthly', limit: PRICE },
	}), funder, 'direct.create');
	const allowanceId = created(t, '::allowance::Allowance<')!;
	const capId = created(t, '::allowance::AllowanceCap<')!;
	log['direct.create'] = { digest: t.digest, allowanceId, capId };

	const c1 = await run(A.spendDirect({ allowanceId, coinType: USDC, amount: PRICE, recipient: M }), shop, 'direct.charge1');
	log['direct.charge1'] = { digest: c1.digest, balanceChanges: c1.balanceChanges };

	await expectReject('direct.charge2.rateLimited', A.spendDirect({ allowanceId, funder: F, coinType: USDC, amount: PRICE, recipient: M }), shop, true);
	await expectReject('direct.wrongSpender', A.spendDirect({ allowanceId, funder: F, coinType: USDC, amount: 1n, recipient: C }), child);
}

// --- 2. Family: weekly 0.1 USDC to child, child spends, parent revokes ---
{
	const fund = new Transaction();
	fund.moveCall({ target: '0x2::balance::send_funds', typeArguments: [SUI], arguments: [fund.balance({ balance: 100_000_000n }), fund.pure.address(C)] });
	await run(fund, funder, 'family.gasForChild');

	const t = await run(A.issueDirect({
		coinType: USDC, name: 'Pocket money: Tobi', spender: C,
		lifetimeCap: null, startMs: null, expiryMs: Date.UTC(2026, 11, 31),
		rateLimit: { kind: 'periodic', periodMs: WEEK_MS, limit: 100_000n },
	}), funder, 'family.create');
	const allowanceId = created(t, '::allowance::Allowance<')!;
	const capId = created(t, '::allowance::AllowanceCap<')!;
	log['family.create'] = { digest: t.digest, allowanceId, capId, storage: t.effects.gasUsed };

	const s = await run(A.spendDirect({ allowanceId, coinType: USDC, amount: 30_000n, recipient: M }), child, 'family.childSpend');
	log['family.childSpend'] = { digest: s.digest };
	await expectReject('family.overWeekly', A.spendDirect({ allowanceId, funder: F, coinType: USDC, amount: 80_000n, recipient: M }), child);

	const r = await run(A.revoke({ capId, allowanceId, coinType: USDC }), funder, 'family.revoke');
	log['family.revoke'] = { digest: r.digest, gasUsed: r.effects.gasUsed };
	await expectReject('family.spendAfterRevoke', A.spendDirect({ allowanceId, funder: F, coinType: USDC, amount: 1n, recipient: M }), child);
}

// --- 3. App-bound: subscribe through merchant::subscribe, charge through merchant::charge ---
{
	const t = await run(A.subscribeAppBound({
		coinType: USDC, name: 'Standing Order: app-bound plan', spender: M,
		lifetimeCap: PRICE * 12n, startMs: null, expiryMs: Date.now() + 365 * DAY_MS,
		rateLimit: { kind: 'monthly', limit: PRICE },
	}), funder, 'app.subscribe');
	const allowanceId = created(t, '::allowance::Allowance<')!;
	const capId = created(t, '::allowance::AllowanceCap<')!;
	const subscriptionId = created(t, '::merchant::Subscription')!;
	log['app.subscribe'] = { digest: t.digest, allowanceId, capId, subscriptionId };
	const args = { allowanceId, subscriptionId, funder: F, coinType: USDC, amount: PRICE };

	await expectReject('app.chargeBeforeDelivery', A.chargeAppBound(args), shop);
	const d1 = await run(A.deliver(subscriptionId), shop, 'app.deliver1');
	log['app.deliver1'] = { digest: d1.digest };
	const c1 = await run(A.chargeAppBound(args), shop, 'app.charge1');
	log['app.charge1'] = { digest: c1.digest, events: c1.events?.map((e: any) => e.eventType) };

	// Direct spend path refuses an app-bound allowance.
	const bypass = new Transaction();
	const w = bypass.withdrawal({ amount: PRICE, type: USDC, from: 'allowance', allowance: allowanceId, funder: F });
	const b = bypass.moveCall({ target: '0x2::allowance::balance_spend', typeArguments: [USDC], arguments: [bypass.object(allowanceId), w, bypass.object.clock()] });
	bypass.moveCall({ target: '0x2::balance::send_funds', typeArguments: [USDC], arguments: [b, bypass.pure.address(M)] });
	await expectReject('app.bypassDirectSpend', bypass, shop);

	const d2 = await run(A.deliver(subscriptionId), shop, 'app.deliver2');
	log['app.deliver2'] = { digest: d2.digest };
	await expectReject('app.charge2.rateLimited', A.chargeAppBound(args), shop, true);

	// Rotate the spender key without the funder, then rotate back.
	const next = namedKey('merchant-next');
	const rot = (to: string) => {
		const tx = new Transaction();
		tx.moveCall({ target: `${DEPLOYMENT.packageId}::merchant::rotate_spender`, typeArguments: [USDC], arguments: [tx.object(DEPLOYMENT.merchantCapId), tx.object(DEPLOYMENT.merchantId), tx.object(allowanceId), tx.pure.address(to)] });
		return tx;
	};
	const r1 = await run(rot(next.toSuiAddress()), shop, 'app.rotateToNext');
	await expectReject('app.oldKeyAfterRotate', A.chargeAppBound(args), shop);
	const r2 = await run(rot(M), shop, 'app.rotateBack');
	log['app.rotate'] = { toNext: r1.digest, back: r2.digest, nextKey: next.toSuiAddress() };

	const rv = await run(A.revoke({ capId, allowanceId, coinType: USDC }), funder, 'app.revoke');
	log['app.revoke'] = { digest: rv.digest, gasUsed: rv.effects.gasUsed };
}

mkdirSync(resolve(ROOT, 'scripts/out'), { recursive: true });
const file = resolve(ROOT, `scripts/out/e2e-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(log, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log('wrote', file);
