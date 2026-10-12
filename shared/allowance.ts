import { Transaction, type TransactionArgument } from '@mysten/sui/transactions';

import { DEPLOYMENT } from './deployment.js';

export type RateLimitSpec =
	| { kind: 'none' }
	| { kind: 'periodic'; periodMs: number; limit: bigint }
	| { kind: 'monthly' | 'quarterly' | 'yearly'; limit: bigint }
	| { kind: 'calendar'; months: number; limit: bigint };

export interface AllowanceTerms {
	coinType: string;
	name: string;
	spender: string;
	lifetimeCap: bigint | null;
	startMs: number | null;
	expiryMs: number | null;
	rateLimit: RateLimitSpec;
}

const RATE_LIMIT = '0x2::allowance::RateLimit';
export const balanceType = (coinType: string) => `0x2::balance::Balance<${coinType}>`;
export const MERCHANT_APP = () => `${DEPLOYMENT.packageId}::merchant::MerchantApp`;

function rateLimitArg(tx: Transaction, spec: RateLimitSpec): TransactionArgument {
	if (spec.kind === 'none') {
		return tx.moveCall({ target: '0x1::option::none', typeArguments: [RATE_LIMIT] });
	}
	const rl =
		spec.kind === 'periodic'
			? tx.moveCall({
					target: '0x2::allowance::periodic_rate_limit',
					arguments: [tx.pure.u64(spec.periodMs), tx.pure.u256(spec.limit)],
				})
			: spec.kind === 'calendar'
				? tx.moveCall({
						target: '0x2::allowance::calendar_rate_limit',
						arguments: [tx.pure.u8(spec.months), tx.pure.u256(spec.limit)],
					})
				: tx.moveCall({
						target: `0x2::allowance::${spec.kind}_rate_limit`,
						arguments: [tx.pure.u256(spec.limit)],
					});
	return tx.moveCall({ target: '0x1::option::some', typeArguments: [RATE_LIMIT], arguments: [rl] });
}

function termArgs(tx: Transaction, t: AllowanceTerms) {
	return [
		tx.pure.string(t.name),
		tx.pure.address(t.spender),
		tx.pure.option('u256', t.lifetimeCap),
		tx.pure.option('u64', t.startMs),
		tx.pure.option('u64', t.expiryMs),
		rateLimitArg(tx, t.rateLimit),
	];
}

/** Direct allowance: the spender's signature alone is enough to pull within the limits. */
export function issueDirect(t: AllowanceTerms, tx = new Transaction()) {
	tx.moveCall({
		target: '0x2::allowance::new',
		typeArguments: [balanceType(t.coinType)],
		arguments: termArgs(tx, t),
	});
	return tx;
}

/** App-bound allowance: propose for MerchantApp, and the merchant module issues it in the same PTB. */
export function subscribeAppBound(t: AllowanceTerms, tx = new Transaction()) {
	const proposal = tx.moveCall({
		target: '0x2::allowance::propose_for_app',
		typeArguments: [balanceType(t.coinType), MERCHANT_APP()],
		arguments: termArgs(tx, t),
	});
	tx.moveCall({
		target: `${DEPLOYMENT.packageId}::merchant::subscribe`,
		typeArguments: [t.coinType],
		arguments: [tx.object(DEPLOYMENT.merchantId), proposal],
	});
	return tx;
}

/** Spender side, direct allowance. Never falls back to the spender's own funds. */
export function spendDirect(
	{ allowanceId, funder, coinType, amount, recipient }: {
		allowanceId: string;
		funder?: string;
		coinType: string;
		amount: bigint;
		recipient: string;
	},
	tx = new Transaction(),
) {
	const paid = tx.balance({
		allowance: funder ? { objectId: allowanceId, funder } : allowanceId,
		balance: amount,
		type: coinType,
	});
	tx.moveCall({
		target: '0x2::balance::send_funds',
		typeArguments: [coinType],
		arguments: [paid, tx.pure.address(recipient)],
	});
	return tx;
}

/** Merchant side, app-bound allowance. The only path that can spend it is merchant::charge. */
export function chargeAppBound(
	{ allowanceId, subscriptionId, funder, coinType, amount }: {
		allowanceId: string;
		subscriptionId: string;
		funder: string;
		coinType: string;
		amount: bigint;
	},
	tx = new Transaction(),
) {
	const withdrawal = tx.withdrawal({
		amount,
		type: coinType,
		from: 'allowance',
		allowance: allowanceId,
		funder,
	});
	tx.moveCall({
		target: `${DEPLOYMENT.packageId}::merchant::charge`,
		typeArguments: [coinType],
		arguments: [
			tx.object(DEPLOYMENT.merchantId),
			tx.object(subscriptionId),
			tx.object(allowanceId),
			withdrawal,
			tx.object.clock(),
		],
	});
	return tx;
}

export function deliver(subscriptionId: string, tx = new Transaction()) {
	tx.moveCall({
		target: `${DEPLOYMENT.packageId}::merchant::deliver`,
		arguments: [tx.object(DEPLOYMENT.merchantCapId), tx.object(subscriptionId)],
	});
	return tx;
}

export function revoke(
	{ capId, allowanceId, coinType }: { capId: string; allowanceId: string; coinType: string },
	tx = new Transaction(),
) {
	tx.moveCall({
		target: '0x2::allowance::revoke',
		typeArguments: [balanceType(coinType)],
		arguments: [tx.object(capId), tx.object(allowanceId)],
	});
	return tx;
}
