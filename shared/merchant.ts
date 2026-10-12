// Merchant-side pull logic shared by /api/charge and the `pnpm charge` cron. Node only.
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Keypair } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';

import * as A from './allowance.js';
import { USDC } from './constants.js';
import { decodeAbort, type DecodedAbort } from './decode.js';
import { DEPLOYMENT } from './deployment.js';

// Prefix of Allowance<T>: id, then Settings { funder, spender, app, ... }. Same trick the SDK uses.
const AllowanceHead = bcs.struct('AllowanceHead', {
	id: bcs.Address,
	funder: bcs.Address,
	spender: bcs.option(bcs.Address),
	app: bcs.option(bcs.string()),
});

export interface ChargeRequest {
	allowanceId: string;
	/** Set for an app-bound subscription: the pull goes through merchant::charge. */
	subscriptionId?: string;
	/** App-bound only: record a delivered period in the same PTB before charging. */
	deliver?: boolean;
	amount?: string;
}

export type ChargeResult =
	| { ok: true; digest: string; kind: 'direct' | 'app'; amount: string; funder: string }
	| { ok: false; stage: 'validate' | 'simulate' | 'execute'; error: string; abort?: DecodedAbort; digest?: string };

export async function readAllowance(client: ClientWithCoreApi, allowanceId: string) {
	const { object } = await client.core.getObject({ objectId: allowanceId, include: { content: true } });
	const expected = normalizeStructTag(`0x2::allowance::Allowance<0x2::balance::Balance<${USDC}>>`);
	if (object.type !== expected) throw new Error(`Not a USDC allowance: ${object.type}`);
	return AllowanceHead.parse(object.content!);
}

export async function charge(client: ClientWithCoreApi, signer: Keypair, req: ChargeRequest): Promise<ChargeResult> {
	const me = signer.toSuiAddress();
	const amount = BigInt(req.amount ?? DEPLOYMENT.priceUnits);
	let head;
	try {
		head = await readAllowance(client, req.allowanceId);
	} catch (e) {
		return { ok: false, stage: 'validate', error: (e as Error).message };
	}
	if (head.spender !== me) return { ok: false, stage: 'validate', error: `Allowance spender is ${head.spender}, not this merchant (${me})` };
	if (!!head.app !== !!req.subscriptionId) {
		return { ok: false, stage: 'validate', error: head.app ? 'App-bound allowance: pass subscriptionId' : 'Direct allowance: do not pass subscriptionId' };
	}

	const tx = new Transaction();
	tx.setSender(me);
	if (req.subscriptionId) {
		if (req.deliver) A.deliver(req.subscriptionId, tx);
		A.chargeAppBound({ allowanceId: req.allowanceId, subscriptionId: req.subscriptionId, funder: head.funder, coinType: USDC, amount }, tx);
	} else {
		A.spendDirect({ allowanceId: req.allowanceId, funder: head.funder, coinType: USDC, amount, recipient: DEPLOYMENT.merchantAddress }, tx);
	}

	// Simulate first: a refused pull costs nothing and comes back as a named abort.
	const sim = await client.core.simulateTransaction({ transaction: tx }).catch((e: Error) => e);
	if (sim instanceof Error) return { ok: false, stage: 'simulate', error: sim.message, abort: decodeAbort(sim) };
	if (sim.$kind === 'FailedTransaction') {
		const err = sim.FailedTransaction.status.error;
		return { ok: false, stage: 'simulate', error: err?.message ?? 'failed', abort: decodeAbort(err) };
	}

	const r = await client.core.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true } });
	if (r.$kind === 'FailedTransaction') {
		const err = r.FailedTransaction.status.error;
		return { ok: false, stage: 'execute', error: err?.message ?? 'failed', abort: decodeAbort(err), digest: r.FailedTransaction.digest };
	}
	await client.core.waitForTransaction({ digest: r.Transaction.digest });
	return { ok: true, digest: r.Transaction.digest, kind: req.subscriptionId ? 'app' : 'direct', amount: amount.toString(), funder: head.funder };
}
