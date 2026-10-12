import type { VercelRequest, VercelResponse } from '@vercel/node';

import { SYSTEM_PROMPT, validateIntent } from '../shared/intent.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
	if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
	const { text, contacts = {} } = (req.body ?? {}) as { text?: string; contacts?: Record<string, string> };
	if (typeof text !== 'string' || !text.trim() || text.length > 300) return res.status(400).json({ error: 'text: 1 to 300 characters' });
	const key = process.env.DEEPSEEK_API_KEY;
	if (!key) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not set' });

	const today = new Date().toISOString().slice(0, 10);
	const r = await fetch('https://api.deepseek.com/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'deepseek-flash',
			response_format: { type: 'json_object' },
			temperature: 0,
			messages: [
				{ role: 'system', content: `${SYSTEM_PROMPT}\nToday is ${today}.` },
				{ role: 'user', content: text },
			],
		}),
	});
	if (!r.ok) return res.status(502).json({ error: `DeepSeek ${r.status}` });
	const body = (await r.json()) as { choices?: { message?: { content?: string } }[] };
	const content = body.choices?.[0]?.message?.content ?? '';
	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch {
		return res.status(422).json({ error: 'Model did not return JSON', content });
	}
	try {
		// Only validated, typed params leave the server. The client still asks the user to confirm and sign.
		return res.status(200).json({ intent: validateIntent(raw, contacts), raw });
	} catch (e) {
		return res.status(422).json({ error: (e as Error).message, raw });
	}
}
