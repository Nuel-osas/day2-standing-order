import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { normalizeStructTag } from '@mysten/sui/utils';
import { spendDirect } from '../../shared/allowance.js';
import { SUI } from '../../shared/constants.js';
import { decodeAbort } from '../../shared/decode.js';
import { DEMO } from '../../shared/demo.js';
import { client, readAllowance } from './chain';

type CollectionResult =
  | { ok: true; digest: string }
  | { ok: false; error: string; code: string; stage: 'request' | 'simulate' | 'execute'; digest?: string };

/** This student's merchant signs locally. Its key never goes to an API or another student. */
export async function collectPayment(signer: Ed25519Keypair, payer: string, allowanceId: string): Promise<CollectionResult> {
  try {
    const merchant = signer.toSuiAddress();
    const allowance = await readAllowance(allowanceId);
    if (!allowance) return { ok: false, code: 'AllowanceGone', error: 'This allowance no longer exists. It may have been revoked.', stage: 'request' };
    const rate = allowance.settings.rate_limit?.Windowed;
    if (allowance.settings.funder !== payer || allowance.settings.spender !== merchant ||
        allowance.settings.app != null || allowance.settings.name !== DEMO.name ||
        normalizeStructTag(allowance.coinType) !== normalizeStructTag(SUI) ||
        rate?.limit !== String(DEMO.price) || rate.window.PeriodicMs !== String(DEMO.periodMs) ||
        allowance.settings.lifetime_cap !== String(DEMO.lifetimeCap)) {
      return { ok: false, code: 'WrongMerchant', error: 'This permission does not belong to your payer and personal demo merchant.', stage: 'request' };
    }
    const transaction = spendDirect({ allowanceId, funder: payer, coinType: SUI, amount: DEMO.price, recipient: merchant });
    transaction.setSender(merchant);
    const simulation = await client.simulateTransaction({ transaction });
    if (simulation.$kind === 'FailedTransaction') {
      const error = decodeAbort(simulation.FailedTransaction.status.error);
      return { ok: false, code: error.name, error: error.meaning, stage: 'simulate' };
    }
    const result = await client.signAndExecuteTransaction({ transaction, signer });
    if (result.$kind === 'FailedTransaction') {
      const error = decodeAbort(result.FailedTransaction.status.error);
      return { ok: false, code: error.name, error: error.meaning, stage: 'execute', digest: result.FailedTransaction.digest };
    }
    await client.waitForTransaction({ digest: result.Transaction.digest });
    return { ok: true, digest: result.Transaction.digest };
  } catch (e) {
    const error = decodeAbort(e);
    return { ok: false, code: error.name, error: error.meaning, stage: 'request' };
  }
}
