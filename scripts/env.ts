import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

import { GRPC_URL, NETWORK } from '../shared/constants.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Keys live outside the repo, in account-layer-week/.secrets.
export const SECRETS = resolve(ROOT, '..', '.secrets');

export const client = new SuiGrpcClient({ network: NETWORK, baseUrl: GRPC_URL });

export function keypairFrom(secret: string): Ed25519Keypair {
	if (secret.startsWith('suiprivkey')) return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(secret).secretKey);
	// Sui keystore format: base64(flag || 32-byte secret).
	const raw = Buffer.from(secret.trim(), 'base64');
	return Ed25519Keypair.fromSecretKey(raw.length === 33 ? raw.subarray(1) : raw);
}

export function day2(): Ed25519Keypair {
	const { suiAddress } = JSON.parse(readFileSync(resolve(SECRETS, 'day2.json'), 'utf8'));
	const kp = keypairFrom(readFileSync(resolve(SECRETS, `${suiAddress}.key`), 'utf8'));
	if (kp.toSuiAddress() !== suiAddress) throw new Error('day2 key does not match day2.json');
	return kp;
}

/** A named extra key for this day (merchant, child). Created once, stored in .secrets. */
export function namedKey(name: string): Ed25519Keypair {
	const file = resolve(SECRETS, `day2-${name}.json`);
	if (!existsSync(file)) {
		const kp = new Ed25519Keypair();
		writeFileSync(file, JSON.stringify({ address: kp.toSuiAddress(), secret: kp.getSecretKey() }, null, 2), { mode: 0o600 });
	}
	return keypairFrom(JSON.parse(readFileSync(file, 'utf8')).secret);
}

export function merchant(): Ed25519Keypair {
	if (process.env.MERCHANT_SECRET_KEY) return keypairFrom(process.env.MERCHANT_SECRET_KEY);
	return namedKey('merchant');
}
