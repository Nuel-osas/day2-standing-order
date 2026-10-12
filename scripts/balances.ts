import { COINS, fromUnits } from '../shared/constants.js';
import { client, day2, merchant, namedKey } from './env.js';

const who = { day2: day2().toSuiAddress(), merchant: merchant().toSuiAddress(), child: namedKey('child').toSuiAddress() };
for (const [name, owner] of Object.entries(who)) {
	for (const c of Object.values(COINS)) {
		const { balance } = await client.getBalance({ owner, coinType: c.type });
		console.log(name.padEnd(9), owner.slice(0, 10), c.symbol.padEnd(4), 'coins', fromUnits(balance.coinBalance, c.decimals).padEnd(12), 'address', fromUnits(balance.addressBalance, c.decimals));
	}
}
