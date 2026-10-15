import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isValidSuiObjectId } from '@mysten/sui/utils';

// Old browser tabs must not keep collecting through the shared merchant.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (typeof req.body?.allowanceId !== 'string' || !isValidSuiObjectId(req.body.allowanceId)) {
    return res.status(400).json({ error: 'A valid allowance ID is required.' });
  }
  return res.status(410).json({ code: 'SharedMerchantRetired', error: 'The shared merchant has been retired. Reload to create your personal demo merchant. You can revoke older permissions in the updated app.' });
}
