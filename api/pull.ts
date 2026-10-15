import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { isValidSuiObjectId, normalizeStructTag } from '@mysten/sui/utils';
import { spendDirect } from '../shared/allowance.js';
import { DEMO } from '../shared/demo.js';
import { SUI } from '../shared/constants.js';
import { DEPLOYMENT } from '../shared/deployment.js';
import { decodeAbort } from '../shared/decode.js';
import { client, readAllowance } from '../src/lib/chain.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const id = req.body?.allowanceId;
  if (typeof id !== 'string' || !isValidSuiObjectId(id)) return res.status(400).json({ error: 'A valid allowance ID is required.' });
  if (!process.env.MERCHANT_SECRET_KEY) return res.status(503).json({ error: 'The demo merchant is not configured.' });
  try {
    const signer = Ed25519Keypair.fromSecretKey(process.env.MERCHANT_SECRET_KEY);
    if (signer.toSuiAddress() !== DEPLOYMENT.merchantAddress) throw new Error('Merchant configuration mismatch.');
    const a = await readAllowance(id);
    if (!a) return res.status(409).json({ error: 'This allowance no longer exists. It may have been revoked.', code: 'AllowanceGone' });
    const rate = a.settings.rate_limit?.Windowed;
    // The public demo endpoint can only collect its fixed, explicitly named testnet plan.
    // It never accepts an amount, recipient, funder, or coin type from the browser.
    if (normalizeStructTag(a.coinType) !== normalizeStructTag(SUI) || a.settings.app != null ||
        a.settings.spender !== signer.toSuiAddress() || a.settings.name !== DEMO.name ||
        rate?.limit !== DEMO.price.toString() || rate.window.PeriodicMs !== String(DEMO.periodMs) ||
        a.settings.lifetime_cap !== DEMO.lifetimeCap.toString()) {
      return res.status(400).json({ error: 'This allowance does not match the one-minute demo plan.' });
    }
    const tx = spendDirect({ allowanceId: id, funder: a.settings.funder, coinType: SUI, amount: DEMO.price, recipient: signer.toSuiAddress() });
    tx.setSender(signer.toSuiAddress());
    const simulation = await client.simulateTransaction({ transaction: tx });
    if (simulation.$kind === 'FailedTransaction') {
      const error = decodeAbort(simulation.FailedTransaction.status.error);
      return res.status(409).json({ error: error.meaning, code: error.name, stage: 'simulate' });
    }
    const r = await client.signAndExecuteTransaction({ transaction: tx, signer });
    if (r.$kind === 'FailedTransaction') {
      const error = decodeAbort(r.FailedTransaction.status.error);
      return res.status(409).json({ error: error.meaning, code: error.name, digest: r.FailedTransaction.digest, stage: 'execute' });
    }
    await client.waitForTransaction({ digest: r.Transaction.digest });
    return res.json({ ok: true, digest: r.Transaction.digest, amount: DEMO.price.toString() });
  } catch (error) {
    const decoded = decodeAbort(error);
    return res.status(decoded.name === 'Unknown' ? 502 : 409).json({ error: decoded.meaning, code: decoded.name, stage: 'request' });
  }
}
