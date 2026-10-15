import { bcs } from '@mysten/sui/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { normalizeStructTag } from '@mysten/sui/utils';

import { COINS, GRPC_OPTIONS } from '../../shared/constants.js';

export const client = new SuiGrpcClient(GRPC_OPTIONS);

// Full layout of sui::allowance::Allowance<T>, read straight from BCS.
const Window = bcs.enum('Window', { PeriodicMs: bcs.u64(), CalendarMonths: bcs.u8() });
const RateLimit = bcs.enum('RateLimit', {
	Windowed: bcs.struct('Windowed', {
		limit: bcs.u256(),
		spent: bcs.u256(),
		anchor_ms: bcs.option(bcs.u64()),
		index: bcs.u64(),
		window: Window,
	}),
});
export const AllowanceBcs = bcs.struct('Allowance', {
	id: bcs.Address,
	settings: bcs.struct('Settings', {
		funder: bcs.Address,
		spender: bcs.option(bcs.Address),
		app: bcs.option(bcs.string()),
		lifetime_cap: bcs.option(bcs.u256()),
		start_timestamp_ms: bcs.option(bcs.u64()),
		expiration_timestamp_ms: bcs.option(bcs.u64()),
		rate_limit: bcs.option(RateLimit),
		name: bcs.string(),
	}),
	current_spend: bcs.u256(),
});
export type AllowanceState = ReturnType<typeof AllowanceBcs.parse> & { coinType: string; capId?: string };

export function coinOf(type: string) {
	return Object.values(COINS).find((c) => normalizeStructTag(c.type) === normalizeStructTag(type)) ?? { type, decimals: 9, symbol: '?' };
}

export async function readAllowance(id: string): Promise<AllowanceState | null> {
	const r = await client.getObjects({ objectIds: [id], include: { content: true } });
	const o = r.objects[0];
	if (o instanceof Error || !o.content) return null;
	const coinType = /Balance<(.+)>>$/.exec(o.type)?.[1] ?? '';
	return { ...AllowanceBcs.parse(o.content), coinType };
}

/** Every allowance this funder granted, found through the AllowanceCaps it owns. */
export async function listFunderAllowances(owner: string): Promise<AllowanceState[]> {
	const caps = await client.listOwnedObjects({ owner, type: '0x2::allowance::AllowanceCap', include: { content: true } });
	const pairs = caps.objects.map((c) => ({ capId: c.objectId, allowanceId: bcs.struct('Cap', { id: bcs.Address, allowance: bcs.Address }).parse(c.content!).allowance }));
	const out: AllowanceState[] = [];
	for (const p of pairs) {
		const a = await readAllowance(p.allowanceId);
		if (a) out.push({ ...a, capId: p.capId });
	}
	return out;
}

export async function balances(owner: string) {
	const out: Record<string, { coin: string; address: string }> = {};
	for (const c of Object.values(COINS)) {
		const { balance } = await client.getBalance({ owner, coinType: c.type });
		out[c.symbol] = { coin: balance.coinBalance, address: balance.addressBalance };
	}
	return out;
}

export async function txDetails(digest: string) {
	const r = await client.waitForTransaction({ digest, include: { effects: true, objectTypes: true, balanceChanges: true } });
	const t = r.$kind === 'Transaction' ? r.Transaction : r.FailedTransaction;
	const createdOf = (frag: string) =>
		t.effects?.changedObjects.find((c) => c.idOperation === 'Created' && (t.objectTypes?.[c.objectId] ?? '').includes(frag))?.objectId;
	return { t, createdOf };
}
