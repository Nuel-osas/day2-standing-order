import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { isValidSuiObjectId } from '@mysten/sui/utils';

import { GRPC_URL, NETWORK } from '../shared/constants.js';
import { charge } from '../shared/merchant.js';

const client = new SuiGrpcClient({ network: NETWORK, baseUrl: GRPC_URL });

export default async function handler(req: VercelRequest, res: VercelResponse) {
	if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
	const secret = process.env.MERCHANT_SECRET_KEY;
	if (!secret) return res.status(500).json({ error: 'MERCHANT_SECRET_KEY not set' });
	const { allowanceId, subscriptionId, deliver } = (req.body ?? {}) as Record<string, unknown>;
	if (typeof allowanceId !== 'string' || !isValidSuiObjectId(allowanceId)) return res.status(400).json({ error: 'allowanceId required' });
	if (subscriptionId !== undefined && (typeof subscriptionId !== 'string' || !isValidSuiObjectId(subscriptionId))) {
		return res.status(400).json({ error: 'bad subscriptionId' });
	}
	const signer = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(secret).secretKey);
	// Amount is fixed server-side to the plan price. The browser cannot ask for more.
	const result = await charge(client, signer, { allowanceId, subscriptionId: subscriptionId as string | undefined, deliver: deliver === true });
	return res.status(result.ok ? 200 : 409).json(result);
}
