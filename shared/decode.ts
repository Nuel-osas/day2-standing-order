// Human names for every abort a Standing Order transaction can hit.
const ALLOWANCE: Record<number, [string, string]> = {
	0: ['ENotSpender', 'Transaction sender is not this allowance\'s spender'],
	1: ['EWrongApp', 'Allowance is not bound to this app'],
	2: ['EExpired', 'Allowance has expired'],
	3: ['EExceedsLifetimeCap', 'Spend would exceed the lifetime cap'],
	4: ['EExceedsRateLimit', 'Spend would exceed the current rate-limit window'],
	5: ['ENoLimit', 'Allowance must have a lifetime cap or a rate limit'],
	6: ['EWrongAllowance', 'Withdrawal was issued for a different allowance'],
	7: ['EBadRateLimit', 'Rate limit needs a positive period and limit'],
	8: ['ENotStarted', 'Allowance is not active yet'],
	9: ['EHasApp', 'App-bound allowance: spend through app_balance_spend'],
	10: ['EWrongFunder', 'Withdrawal debits a different address than the funder'],
	11: ['EWrongCap', 'Cap does not match this allowance'],
	12: ['ENameTooLong', 'Name exceeds 128 bytes'],
	13: ['EZeroLifetimeCap', 'Lifetime cap must be greater than zero'],
	14: ['EBadTimeWindow', 'Expiration must be after the start time'],
	15: ['ENoExpiration', 'Allowance must have an expiration or a rate limit'],
	16: ['ENotEnabled', 'Allowances are not enabled on this network'],
};
const MERCHANT: Record<number, [string, string]> = {
	10: ['EWrongSpender', 'Proposal must name the merchant\'s spender'],
	11: ['ENoRateLimit', 'Proposal must carry a rate limit'],
	12: ['ERateLimitBelowPrice', 'Rate limit is below the price of one period'],
	20: ['EWrongMerchant', 'Object belongs to a different merchant'],
	21: ['EWrongSubscriber', 'Allowance is funded by someone other than the subscriber'],
	22: ['EWrongAllowance', 'Subscription is bound to a different allowance'],
	30: ['ENothingDue', 'No delivered period is waiting to be charged'],
	31: ['EWrongAmount', 'Pull must equal the price'],
};

export interface DecodedAbort {
	module: string;
	code: number | null;
	name: string;
	meaning: string;
	raw: string;
}

/** Accepts an SDK ExecutionError (or anything with a message) and names the abort. */
export function decodeAbort(err: unknown): DecodedAbort {
	const e = err as {
		message?: string;
		MoveAbort?: {
			abortCode?: string;
			location?: { module?: string };
			cleverError?: { errorCode?: number; constantName?: string };
		};
	};
	const raw = e?.message ?? String(err);
	// Refused before execution (signing-time input checks): no gas spent, no Move abort.
	const pre: [RegExp, string, string][] = [
		[/Invalid withdraw reservation: Insufficient address balance/, 'InsufficientFunderBalance', 'Funder\'s address balance is below the declared amount. Checked before the rate limit, costs no gas'],
		[/Invalid withdraw reservation: Transaction sender is not the spender/, 'NotSpender', 'Sender is not this allowance\'s spender. Refused at signing, costs no gas'],
		[/Object 0x[0-9a-f]+ not found|deleted/i, 'AllowanceGone', 'The allowance no longer exists (revoked). Refused before execution'],
	];
	for (const [re, name, meaning] of pre) if (re.test(raw)) return { module: 'pre-execution', code: null, name, meaning, raw };
	const mod = e?.MoveAbort?.location?.module ?? /0x[0-9a-f]+::(\w+)::\w+'/i.exec(raw)?.[1] ?? '';
	const clever = e?.MoveAbort?.cleverError;
	let code: number | null = clever?.errorCode ?? null;
	if (code === null && e?.MoveAbort?.abortCode) {
		const n = BigInt(e.MoveAbort.abortCode);
		// Clever errors pack the error code in the low 16 bits when the top bit is set.
		code = n >= 1n << 63n ? Number(n & 0xffffn) : Number(n);
	}
	const table = mod === 'allowance' ? ALLOWANCE : mod === 'merchant' ? MERCHANT : {};
	const quoted = /MoveAbort[^']*'(E\w+)'/.exec(raw)?.[1];
	if (code === null && quoted) {
		const found = Object.entries(table).find(([, v]) => v[0] === quoted);
		if (found) code = Number(found[0]);
	}
	if (code === null) {
		const m = /abort code:?\s*(\d+)/i.exec(raw);
		if (m) code = Number(m[1]);
	}
	const hit2 = code !== null ? table[code] : undefined;
	const name = clever?.constantName ?? quoted ?? hit2?.[0] ?? 'Unknown';
	return { module: mod, code, name, meaning: hit2?.[1] ?? raw, raw };
}
