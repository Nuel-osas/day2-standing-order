// The funder is either the connected wallet (a student's Slush) or a burner key kept in this browser.
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import { useMemo, useState } from 'react';

import { decodeAbort, type DecodedAbort } from '../../shared/decode.js';
import { client, txDetails } from './chain';

export function burner(name: string): Ed25519Keypair {
	const key = `standing-order:${name}`;
	let secret: string | null = null;
	try { secret = localStorage.getItem(key); } catch { /* storage blocked */ }
	if (secret) return Ed25519Keypair.fromSecretKey(secret);
	const kp = new Ed25519Keypair();
	try { localStorage.setItem(key, kp.getSecretKey()); } catch { /* storage blocked */ }
	return kp;
}

export type ExecResult =
	| { ok: true; digest: string; details: Awaited<ReturnType<typeof txDetails>> }
	| { ok: false; error: string; abort?: DecodedAbort; digest?: string };

export async function execWithKey(tx: Transaction, kp: Ed25519Keypair): Promise<ExecResult> {
	try {
		const r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp });
		if (r.$kind === 'FailedTransaction') {
			const err = r.FailedTransaction.status.error;
			return { ok: false, error: err?.message ?? 'failed', abort: decodeAbort(err), digest: r.FailedTransaction.digest };
		}
		return { ok: true, digest: r.Transaction.digest, details: await txDetails(r.Transaction.digest) };
	} catch (e) {
		return { ok: false, error: (e as Error).message, abort: decodeAbort(e) };
	}
}

export function useFunder() {
	const account = useCurrentAccount();
	const dAppKit = useDAppKit();
	const [demo, setDemo] = useState(() => {
		try { return localStorage.getItem('standing-order:mode') !== 'wallet'; } catch { return true; }
	});
	const demoKey = useMemo(() => burner('funder'), []);
	const useWallet = !demo && !!account;
	const address = useWallet ? account!.address : demo ? demoKey.toSuiAddress() : null;

	async function exec(tx: Transaction): Promise<ExecResult> {
		if (!useWallet) return execWithKey(tx, demoKey);
		try {
			const r = await dAppKit.signAndExecuteTransaction({ transaction: tx });
			if (r.$kind === 'FailedTransaction') {
				return { ok: false, error: String(r.FailedTransaction.status.error?.message ?? 'failed'), digest: r.FailedTransaction.digest };
			}
			return { ok: true, digest: r.Transaction.digest, details: await txDetails(r.Transaction.digest) };
		} catch (e) {
			return { ok: false, error: (e as Error).message, abort: decodeAbort(e) };
		}
	}

	function setMode(d: boolean) {
		setDemo(d);
		try { localStorage.setItem('standing-order:mode', d ? 'demo' : 'wallet'); } catch { /* ignore */ }
	}
	return { address, demo, setMode, exec, isWallet: useWallet };
}
