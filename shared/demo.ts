import type { AllowanceState } from '../src/lib/chain.js';

export const DEMO = {
  name: 'Standing Order / one-minute demo',
  price: 1_000_000n,
  periodMs: 60_000,
  lifetimeCap: 6_000_000n,
  deposit: 20_000_000n,
  durationMs: 24 * 60 * 60 * 1000,
} as const;

/** Stored usage is lazy: a new window is calculated before the next onchain spend. */
export function windowState(a: AllowanceState, now: number) {
  const rate = a.settings.rate_limit?.Windowed;
  const period = Number(rate?.window.PeriodicMs ?? 0);
  const anchor = rate?.anchor_ms == null ? null : Number(rate.anchor_ms);
  const index = anchor == null || !period ? 0 : Math.max(0, Math.floor((now - anchor) / period));
  const spent = rate && BigInt(index) === BigInt(rate.index) ? BigInt(rate.spent) : 0n;
  const limit = BigInt(rate?.limit ?? 0);
  const lifetimeLeft = BigInt(a.settings.lifetime_cap ?? DEMO.lifetimeCap) - BigInt(a.current_spend);
  const expired = a.settings.expiration_timestamp_ms != null && now >= Number(a.settings.expiration_timestamp_ms);
  const notStarted = a.settings.start_timestamp_ms != null && now < Number(a.settings.start_timestamp_ms);
  const available = expired || notStarted ? 0n : [limit - spent, lifetimeLeft].reduce((x, y) => x < y ? x : y);
  return {
    spent, limit, available: available > 0n ? available : 0n, lifetimeLeft, expired, notStarted,
    nextReset: anchor == null || !period ? null : anchor + (index + 1) * period,
    index,
  };
}
