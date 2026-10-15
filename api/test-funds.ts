import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isValidSuiAddress } from '@mysten/sui/utils';
import { requestSuiFromFaucetV3, FaucetError, FaucetRateLimitError } from '@mysten/sui/faucet';
import { client } from '../src/lib/chain.js';
import { SUI } from '../shared/constants.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const address = req.body?.address;
  if (typeof address !== 'string' || !isValidSuiAddress(address)) return res.status(400).json({ error: 'A valid testnet address is required.' });
  try {
    const { balance } = await client.getBalance({ owner: address, coinType: SUI });
    if (BigInt(balance.balance) >= 100_000_000n) return res.json({ ok: true, alreadyFunded: true });
    // V3 solves the public faucet's proof-of-work and credits the address balance.
    // No merchant funds or credentials are used. Never retry a payout automatically.
    const data = await requestSuiFromFaucetV3({ host: 'https://faucet.testnet.sui.io', recipient: address, timeout: 150_000 });
    return res.json({ ok: true, digest: data.digest });
  } catch (error) {
    if (error instanceof FaucetError && error.digest) {
      return res.status(202).json({ ok: true, digest: error.digest });
    }
    if (error instanceof FaucetRateLimitError) return res.status(429).json({ error: 'The public faucet is busy. Wait before trying again, or use the Sui faucet link below.' });
    return res.status(503).json({ error: 'The faucet did not confirm funding. Refresh your balance before retrying, or use the Sui faucet link below.' });
  }
}
