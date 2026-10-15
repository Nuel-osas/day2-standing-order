import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO, windowState } from './demo.js';
import type { AllowanceState } from '../src/lib/chain.js';

function fixture(overrides: { spent?: string; total?: string; anchor?: string | null; index?: string; expiry?: string; start?: string } = {}): AllowanceState {
  return {
    id: '0x1', coinType: '0x2::sui::SUI', current_spend: overrides.total ?? '1000000',
    settings: {
      funder: '0x1', spender: '0x2', name: DEMO.name, app: null,
      lifetime_cap: String(DEMO.lifetimeCap), start_timestamp_ms: overrides.start ?? null,
      expiration_timestamp_ms: overrides.expiry ?? '999999999',
      rate_limit: { $kind: 'Windowed', Windowed: {
        limit: String(DEMO.price), spent: overrides.spent ?? '1000000',
        anchor_ms: overrides.anchor === undefined ? '100000' : overrides.anchor,
        index: overrides.index ?? '0', window: { $kind: 'PeriodicMs', PeriodicMs: String(DEMO.periodMs) },
      } },
    },
  };
}

test('a full current window stays unavailable until its boundary', () => {
  assert.equal(windowState(fixture(), 159999).available, 0n);
  assert.equal(windowState(fixture(), 159999).nextReset, 160000);
});
test('a fresh window restores the rate budget without resetting lifetime spend', () => {
  const s = windowState(fixture(), 160000);
  assert.equal(s.available, DEMO.price);
  assert.equal(s.lifetimeLeft, 5_000_000n);
  assert.equal(s.index, 1);
});
test('unused budgets do not accumulate after multiple elapsed windows', () => {
  assert.equal(windowState(fixture(), 400000).available, DEMO.price);
});
test('lifetime cap remains exhausted after renewal', () => {
  assert.equal(windowState(fixture({ total: '6000000' }), 400000).available, 0n);
});
test('expired or not-yet-active allowances cannot appear spendable', () => {
  assert.equal(windowState(fixture({ expiry: '160000' }), 160000).available, 0n);
  assert.equal(windowState(fixture({ start: '500000' }), 400000).available, 0n);
});
test('unspent permission has no anchor and no invented renewal countdown', () => {
  const s = windowState(fixture({ anchor: null, spent: '0', total: '0' }), 500000);
  assert.equal(s.available, DEMO.price);
  assert.equal(s.nextReset, null);
});
