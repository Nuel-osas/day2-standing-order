// Runs the natural-language builder against a few sentences, including ones it must refuse.
import 'dotenv/config';
import handler from '../api/parse.js';
const texts = ['Give Tobi 2 USDC a week until December', 'let ada spend 0.5 sui per day for the next two weeks', 'Send 1000000 USDC to Bob every month', 'pay netflix forever', 'Give 0x' + 'ab'.repeat(32) + ' 3 USDC once, valid until Friday'];
for (const text of texts) {
	await handler({ method: 'POST', body: { text, contacts: { Tobi: '0x' + '11'.repeat(32) } } } as any, {
		status(c: number) { return { json: (j: any) => console.log(c, text, '\n ', JSON.stringify(j.intent ?? j)) }; },
	} as any);
}
