// Strict validation of the natural-language builder's output. The model proposes; this decides.
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';

import { COINS, DAY_MS, toUnits, WEEK_MS, type CoinKey } from './constants.js';

export const PERIODS = ['day', 'week', 'month', 'quarter', 'year', 'once'] as const;
export type Period = (typeof PERIODS)[number];

export interface AllowanceIntent {
	label: string;
	spenderName: string | null;
	spender: string | null;
	coin: CoinKey;
	amount: string;
	amountUnits: string;
	period: Period;
	expiryMs: number | null;
	startMs: number | null;
	warnings: string[];
}

const MAX_AMOUNT: Record<CoinKey, number> = { USDC: 100, SUI: 10 };
const MAX_HORIZON_MS = 2 * 365 * DAY_MS;

function dateMs(v: unknown, field: string, now: number): number | null {
	if (v === null || v === undefined || v === '') return null;
	if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${field} must be YYYY-MM-DD or null`);
	const ms = Date.parse(`${v}T00:00:00Z`);
	if (Number.isNaN(ms)) throw new Error(`${field} is not a real date`);
	if (ms > now + MAX_HORIZON_MS) throw new Error(`${field} is more than 2 years out`);
	return ms;
}

/** Throws on anything it does not fully understand. Never fills gaps with guesses. */
export function validateIntent(raw: unknown, contacts: Record<string, string>, now = Date.now()): AllowanceIntent {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Model output is not an object');
	const o = raw as Record<string, unknown>;
	const allowed = new Set(['label', 'spender_name', 'spender_address', 'coin', 'amount', 'period', 'expiry_date', 'start_date']);
	for (const k of Object.keys(o)) if (!allowed.has(k)) throw new Error(`Unexpected field: ${k}`);

	const coin = o.coin;
	if (coin !== 'USDC' && coin !== 'SUI') throw new Error('coin must be USDC or SUI');
	const amount = typeof o.amount === 'number' ? String(o.amount) : o.amount;
	if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount)) throw new Error('amount must be a positive decimal');
	if ((amount.split('.')[1]?.length ?? 0) > COINS[coin].decimals) throw new Error('amount has too many decimals');
	const units = toUnits(amount, COINS[coin].decimals);
	if (units <= 0n) throw new Error('amount must be greater than zero');
	if (Number(amount) > MAX_AMOUNT[coin]) throw new Error(`amount above the ${MAX_AMOUNT[coin]} ${coin} demo ceiling`);

	if (!PERIODS.includes(o.period as Period)) throw new Error(`period must be one of ${PERIODS.join(', ')}`);
	const period = o.period as Period;

	const warnings: string[] = [];
	const expiryMs = dateMs(o.expiry_date, 'expiry_date', now);
	const startMs = dateMs(o.start_date, 'start_date', now);
	if (expiryMs !== null && expiryMs <= now) throw new Error('expiry_date is in the past');
	if (startMs !== null && expiryMs !== null && startMs >= expiryMs) throw new Error('start_date must be before expiry_date');
	if (period === 'once' && expiryMs === null) throw new Error('a one-off allowance needs an expiry date');
	if (expiryMs === null) warnings.push('No end date. Bounded only by the rate limit until you revoke it.');

	const spenderName = typeof o.spender_name === 'string' && o.spender_name.trim() ? o.spender_name.trim().slice(0, 40) : null;
	let spender: string | null = null;
	if (typeof o.spender_address === 'string' && o.spender_address) {
		if (!isValidSuiAddress(o.spender_address)) throw new Error('spender_address is not a Sui address');
		spender = normalizeSuiAddress(o.spender_address);
	} else if (spenderName) {
		const hit = Object.entries(contacts).find(([n]) => n.toLowerCase() === spenderName.toLowerCase());
		if (hit && isValidSuiAddress(hit[1])) spender = normalizeSuiAddress(hit[1]);
		else warnings.push(`"${spenderName}" is not in your contacts. Paste their address before signing.`);
	}
	const label = (typeof o.label === 'string' && o.label.trim() ? o.label.trim() : `${spenderName ?? 'Allowance'}: ${amount} ${coin}/${period}`).slice(0, 120);

	return { label, spenderName, spender, coin, amount, amountUnits: units.toString(), period, expiryMs, startMs, warnings };
}

export const periodRateLimit = (period: Period, limit: bigint) =>
	period === 'once'
		? ({ kind: 'none' } as const)
		: period === 'day'
			? ({ kind: 'periodic', periodMs: DAY_MS, limit } as const)
			: period === 'week'
				? ({ kind: 'periodic', periodMs: WEEK_MS, limit } as const)
				: period === 'month'
					? ({ kind: 'monthly', limit } as const)
					: period === 'quarter'
						? ({ kind: 'quarterly', limit } as const)
						: ({ kind: 'yearly', limit } as const);

export const SYSTEM_PROMPT = `You turn one sentence about giving someone a spending allowance into JSON. Output only a JSON object with exactly these keys:
label: short human label, string
spender_name: the person or service being given the allowance, string or null
spender_address: a 0x Sui address only if the sentence contains one, else null
coin: "USDC" or "SUI" (default "USDC" when money is mentioned without a coin)
amount: the amount per period as a decimal string, for example "2" or "0.05"
period: one of "day","week","month","quarter","year","once"
expiry_date: "YYYY-MM-DD" in UTC or null. The allowance stops at 00:00 UTC on this date. "until December" means through the end of December, so use the 1st of the following January. "until Friday" means through Friday, so use the Saturday
start_date: "YYYY-MM-DD" or null
Never invent addresses. If something is not stated, use null.`;
