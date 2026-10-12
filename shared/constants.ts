export const NETWORK = 'testnet' as const;
export const GRPC_URL = 'https://fullnode.testnet.sui.io:443';
export const USDC =
	'0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
export const SUI = '0x2::sui::SUI';

export const COINS = {
	USDC: { type: USDC, decimals: 6, symbol: 'USDC' },
	SUI: { type: SUI, decimals: 9, symbol: 'SUI' },
} as const;
export type CoinKey = keyof typeof COINS;

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export function toUnits(amount: string | number, decimals: number): bigint {
	const [whole, frac = ''] = String(amount).trim().split('.');
	if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(frac)) throw new Error(`Bad amount: ${amount}`);
	return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0').slice(0, decimals) || '0');
}

export function fromUnits(units: bigint | string | number, decimals: number): string {
	const v = BigInt(units);
	const base = 10n ** BigInt(decimals);
	const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
	return frac ? `${v / base}.${frac}` : `${v / base}`;
}

export const explorer = (kind: 'tx' | 'object' | 'account', id: string) =>
	`https://suiscan.xyz/testnet/${kind}/${id}`;
