import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DEPLOYMENT } from '../shared/deployment.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  return res.json({ network: 'testnet', merchant: DEPLOYMENT.merchantAddress, configured: !!process.env.MERCHANT_SECRET_KEY });
}
