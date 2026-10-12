// One-time setup from the day2 key: fund the merchant, publish, create the Merchant<USDC>.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Transaction } from '@mysten/sui/transactions';

import { SUI, USDC } from '../shared/constants.js';
import { DEPLOYMENT } from '../shared/deployment.js';
import { client, day2, merchant, ROOT } from './env.js';
import { created, run } from './tx.js';

const owner = day2();
const me = owner.toSuiAddress();
const merchantAddr = merchant().toSuiAddress();
const dep: Record<string, string> = { ...DEPLOYMENT, merchantAddress: merchantAddr };

// 1. Allowances spend from address balances, so move day2's USDC coins into its address balance.
const { objects: coins } = await client.listCoins({ owner: me, coinType: USDC });
if (coins.length) {
	const tx = new Transaction();
	const [first, ...rest] = coins.map((c) => tx.object(c.objectId));
	if (rest.length) tx.mergeCoins(first, rest);
	tx.moveCall({ target: '0x2::coin::send_funds', typeArguments: [USDC], arguments: [first, tx.pure.address(me)] });
	await run(tx, owner, 'usdc coin -> address balance');
}

// 2. Fund the merchant key (spender + faucet for demo burners) from day2's address balance.
const { balance: mb } = await client.getBalance({ owner: merchantAddr, coinType: SUI });
if (BigInt(mb.balance) === 0n) {
	const tx = new Transaction();
	tx.moveCall({ target: '0x2::balance::send_funds', typeArguments: [SUI], arguments: [tx.balance({ balance: 1_500_000_000n }), tx.pure.address(merchantAddr)] });
	tx.moveCall({ target: '0x2::balance::send_funds', typeArguments: [USDC], arguments: [tx.balance({ type: USDC, balance: 1_000_000n }), tx.pure.address(merchantAddr)] });
	await run(tx, owner, 'fund merchant 1.5 SUI + 1 USDC');
}

// 3. Publish.
if (!dep.packageId) {
	const out = execFileSync('sui', ['move', 'build', '--dump-bytecode-as-base64', '--path', resolve(ROOT, 'move/standing_order')], { encoding: 'utf8' });
	const { modules, dependencies } = JSON.parse(out.slice(out.indexOf('{')));
	const tx = new Transaction();
	const cap = tx.publish({ modules, dependencies });
	tx.transferObjects([cap], me);
	const t = await run(tx, owner, 'publish');
	dep.packageId = t.effects.changedObjects.find((c: any) => c.idOperation === 'Created' && t.objectTypes?.[c.objectId] === 'package')?.objectId
		?? Object.entries(t.objectTypes ?? {}).find(([, ty]) => ty === 'package')?.[0] ?? '';
	dep.upgradeCapId = created(t, '::package::UpgradeCap') ?? '';
	if (!dep.packageId) throw new Error('no package id in effects');
}

// 4. Merchant<USDC>: price 0.05 USDC, treasury and spender are the merchant key, cap goes to it.
if (!dep.merchantId) {
	const tx = new Transaction();
	const cap = tx.moveCall({
		target: `${dep.packageId}::merchant::create`,
		typeArguments: [USDC],
		arguments: [tx.pure.u64(BigInt(dep.priceUnits)), tx.pure.address(merchantAddr), tx.pure.address(merchantAddr)],
	});
	tx.transferObjects([cap], merchantAddr);
	const t = await run(tx, owner, 'create merchant');
	dep.merchantId = created(t, '::merchant::Merchant<') ?? '';
	dep.merchantCapId = created(t, '::merchant::MerchantCap') ?? '';
}

const file = resolve(ROOT, 'shared/deployment.ts');
const src = readFileSync(file, 'utf8');
writeFileSync(file, src.replace(/export const DEPLOYMENT = \{[\s\S]*?\} as const;/, `export const DEPLOYMENT = ${JSON.stringify(dep, null, '\t').replace(/"(\w+)":/g, '$1:').replace(/"/g, "'")} as const;`));
console.log(dep);
