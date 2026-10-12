// A merchant retry that double-fires. Both pulls are built and signed while the window is open;
// the chain executes both and the rate limit fails the second, so it lands on chain with a digest.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as A from '../shared/allowance.js';
import { DAY_MS, USDC } from '../shared/constants.js';
import { decodeAbort } from '../shared/decode.js';
import { DEPLOYMENT } from '../shared/deployment.js';
import { client, day2, merchant, ROOT } from './env.js';
import { created, run } from './tx.js';

const funder = day2(), shop = merchant();
const F = funder.toSuiAddress(), M = shop.toSuiAddress();
const PRICE = BigInt(DEPLOYMENT.priceUnits);

const t = await run(A.issueDirect({
	coinType: USDC, name: 'Standing Order: double-charge demo', spender: M,
	lifetimeCap: PRICE * 12n, startMs: null, expiryMs: Date.now() + 30 * DAY_MS,
	rateLimit: { kind: 'monthly', limit: PRICE },
}), funder, 'create');
const allowanceId = created(t, '::allowance::Allowance<')!;
const capId = created(t, '::allowance::AllowanceCap<')!;

async function signed(budget: bigint) {
	const tx = A.spendDirect({ allowanceId, funder: F, coinType: USDC, amount: PRICE, recipient: M });
	tx.setSender(M);
	tx.setGasBudget(budget);
	const bytes = await tx.build({ client });
	return { bytes, signature: (await shop.signTransaction(bytes)).signature };
}
// Built and signed before either executes, so both pass resolution.
const first = await signed(10_000_000n);
const retry = await signed(10_000_001n);

const out: Record<string, unknown> = { allowanceId, create: t.digest };
for (const [label, s] of [['first', first], ['retry', retry]] as const) {
	const r = await client.executeTransaction({ transaction: s.bytes, signatures: [s.signature], include: { effects: true } });
	if (r.$kind === 'FailedTransaction') {
		const d = decodeAbort(r.FailedTransaction.status.error);
		out[label] = { digest: r.FailedTransaction.digest, status: 'failed', abort: `${d.module}::${d.name}`, error: r.FailedTransaction.status.error?.message, gasUsed: r.FailedTransaction.effects?.gasUsed };
		await client.waitForTransaction({ digest: r.FailedTransaction.digest });
	} else {
		out[label] = { digest: r.Transaction.digest, status: 'success' };
		await client.waitForTransaction({ digest: r.Transaction.digest });
	}
	console.log(label, out[label]);
}
const rv = await run(A.revoke({ capId, allowanceId, coinType: USDC }), funder, 'revoke');
out.revoke = rv.digest;
mkdirSync(resolve(ROOT, 'scripts/out'), { recursive: true });
writeFileSync(resolve(ROOT, `scripts/out/double-charge-${Date.now()}.json`), JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
