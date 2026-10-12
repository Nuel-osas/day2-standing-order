// The monthly cron. Usage:
//   pnpm charge <allowanceId>                       direct allowance
//   pnpm charge <allowanceId> <subscriptionId>      app-bound, delivers a period then charges
//   pnpm charge                                     every entry in scripts/subscribers.json
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { charge, type ChargeRequest } from '../shared/merchant.js';
import { client, merchant, ROOT } from './env.js';

const [allowanceId, subscriptionId] = process.argv.slice(2);
const list: ChargeRequest[] = allowanceId
	? [{ allowanceId, subscriptionId, deliver: !!subscriptionId }]
	: existsSync(resolve(ROOT, 'scripts/subscribers.json'))
		? JSON.parse(readFileSync(resolve(ROOT, 'scripts/subscribers.json'), 'utf8'))
		: [];
if (!list.length) console.log('Nothing to charge. Pass an allowance id or fill scripts/subscribers.json.');

const signer = merchant();
for (const req of list) {
	const r = await charge(client, signer, req);
	if (r.ok) console.log(`charged ${r.amount} from ${r.funder.slice(0, 10)} (${r.kind}): ${r.digest}`);
	else if (r.abort?.name === 'EExceedsRateLimit') console.log(`${req.allowanceId.slice(0, 10)}: already charged this window, retry next window`);
	else console.log(`${req.allowanceId.slice(0, 10)}: ${r.stage} refused: ${r.abort ? `${r.abort.module}::${r.abort.name}` : r.error}`);
}
