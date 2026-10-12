// Funds a demo burner from the merchant key so the projector demo never depends on a faucet.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { isValidSuiAddress } from '@mysten/sui/utils';

import { GRPC_URL, NETWORK, SUI, USDC } from '../shared/constants.js';

const client = new SuiGrpcClient({ network: NETWORK, baseUrl: GRPC_URL });

export default async function handler(req: VercelRequest, res: VercelResponse) {
	if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
	const { address, passcode, usdc = true } = (req.body ?? {}) as { address?: string; passcode?: string; usdc?: boolean };
	if (!process.env.DEMO_PASSCODE || passcode !== process.env.DEMO_PASSCODE) return res.status(401).json({ error: 'wrong passcode' });
	if (!address || !isValidSuiAddress(address)) return res.status(400).json({ error: 'bad address' });
	const { balance } = await client.getBalance({ owner: address, coinType: SUI });
	if (BigInt(balance.balance) > 50_000_000n) return res.status(200).json({ skipped: 'already has SUI' });

	const signer = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.MERCHANT_SECRET_KEY!).secretKey);
	const tx = new Transaction();
	tx.moveCall({ target: '0x2::balance::send_funds', typeArguments: [SUI], arguments: [tx.balance({ balance: 100_000_000n }), tx.pure.address(address)] });
	if (usdc) tx.moveCall({ target: '0x2::balance::send_funds', typeArguments: [USDC], arguments: [tx.balance({ type: USDC, balance: 300_000n }), tx.pure.address(address)] });
	const r = await client.signAndExecuteTransaction({ transaction: tx, signer });
	if (r.$kind === 'FailedTransaction') return res.status(500).json({ error: r.FailedTransaction.status.error?.message });
	await client.waitForTransaction({ result: r });
	return res.status(200).json({ digest: r.Transaction.digest, sent: { sui: '0.1', usdc: usdc ? "0.3" : "0" } });
}
