import type { Keypair } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';

import { decodeAbort } from '../shared/decode.js';
import { client } from './env.js';

/** Sign, execute, wait, and throw a decoded abort on failure. */
export async function run(tx: Transaction, signer: Keypair, label: string) {
	const result = await client.signAndExecuteTransaction({
		transaction: tx,
		signer,
		include: { effects: true, objectTypes: true, balanceChanges: true, events: true },
	});
	if (result.$kind === 'FailedTransaction') {
		const d = decodeAbort(result.FailedTransaction.status.error);
		throw Object.assign(new Error(`${label} failed: ${d.module}::${d.name} ${d.meaning}`), {
			digest: result.FailedTransaction.digest,
			decoded: d,
		});
	}
	await client.waitForTransaction({ result });
	const t = result.Transaction;
	console.log(`${label}: ${t.digest}`);
	return t;
}

export function created(t: { effects: any; objectTypes?: Record<string, string> }, typeIncludes: string) {
	const hit = t.effects.changedObjects.find(
		(c: any) => c.idOperation === 'Created' && (t.objectTypes?.[c.objectId] ?? '').includes(typeIncludes),
	);
	return hit?.objectId as string | undefined;
}
