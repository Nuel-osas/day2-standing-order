# Standing Order — The Allowance Playground

A live Sui testnet demo of native recurring payment authorisation. A user grants permission once, a merchant collects within its limits, and the user can revoke at any time.

**Live:** https://day2-standing-order.vercel.app

Built for Account Layer Week, SuiHub Lagos. React + Vite frontend, Vercel Node.js functions, and `@mysten/sui` over gRPC. All transactions use **testnet**, with free test SUI. The public demo uses `0x2::allowance` directly and does not depend on a custom Move package.

## Try it

1. Choose **Demo wallet**, or connect a testnet wallet under **My wallet**.
2. Select **Get test funds**. The public Sui V3 faucet funds the address balance. Proof-of-work may take a minute. Existing coin objects can be converted into the same owner's address balance; setup keeps gas available.
3. Review the plan and **Approve this allowance**: 0.001 SUI per 60 seconds, 0.006 SUI lifetime cap, expiry 24 hours after approval.
4. **Collect 0.001 SUI**. The merchant signs and pays gas; the funder does not sign the charge.
5. **Try another charge** in the same window. Sui rejects it. The API simulates first, so a simulated rejection creates no payment or execution gas charge.
6. Enable **Auto-charge when the budget renews**, or wait for the countdown and charge manually. The first successful spend anchors the 60-second windows. Unused budgets do not accumulate.
7. **Revoke permission**, then **Try charging the revoked allowance**. The merchant can no longer use it.

The auto-charge scheduler runs **only while the browser tab is open**, and browsers can throttle background tabs. Permission renewal is enforced onchain; submitting a payment still requires a scheduler. This demo does not claim unattended server-side subscriptions. An allowance is not a reservation of funds, so a charge also requires sufficient address balance.

Activity receipts are stored per wallet in the browser. Allowances are recovered from onchain `AllowanceCap` objects after a reload. The local countdown is informational; Sui's clock decides whether a spend is valid. A browser demo key is stored in localStorage and must only hold testnet tokens. Connected wallet keys remain in the wallet.

## Local development

Use **Node 24.7+ within the 24.x line** (native Argon2 makes the V3 faucet proof practical), pnpm, and a funded testnet merchant signer.

```sh
pnpm install
cp .env.example .env
# Set MERCHANT_SECRET_KEY to the existing testnet merchant signer.
vercel dev --listen 3017
```

`pnpm dev` serves the UI only. Use `vercel dev` for the API routes. TypeScript is pinned to 5.9 because the local Vercel 50.x function runner fails when loading this project's API modules with TypeScript 6.

The merchant address is recorded in `shared/deployment.ts`. `/api/pull` verifies that the server signer matches it. For a separate deployment with another signer, update that public address and grant new allowances; existing allowances remain bound to the old spender.

The current native demo needs only `MERCHANT_SECRET_KEY`. Never expose that key with a `VITE_` prefix. The old classroom USDC faucet and natural-language endpoints additionally use `DEMO_PASSCODE` and `DEEPSEEK_API_KEY`; they are not called by this interface.

## Validation

```sh
pnpm test
pnpm exec tsx scripts/check-handlers.ts
pnpm build
```

The build type-checks the frontend, server functions, shared helpers, and scripts. Unit tests cover rate-window boundaries, lazy reset, non-accumulation, lifetime exhaustion, expiry, and start times. API checks cover rejected methods and malformed identifiers.

The complete browser test uses real testnet transactions: funding, grant, charge, same-window rejection, timed renewal, reload recovery, revocation, and rejected post-revocation charge. No mocked chain results are used for that test.

## Deploy to Vercel

The existing project is `day2-standing-order`. Configure `MERCHANT_SECRET_KEY` as an encrypted **production** environment variable, keep the merchant funded with testnet gas, and run:

```sh
vercel deploy --prod --yes
```

`vercel.json` configures the Vite build and Node functions. The faucet operation has a bounded 150-second SDK timeout; functions permit up to 180 seconds. Failed or ambiguous faucet submissions are not automatically retried. The interface offers the official faucet and balance refresh as fallbacks. Public Sui RPC and faucet endpoints are rate limited.

## Key files

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Guided subscription flow, wallet setup, activity receipts, optional browser scheduler |
| `src/lib/funder.ts` | Browser demo signer or connected wallet; never silently falls back from a disconnected wallet |
| `src/lib/chain.ts` | Read balances, allowances, capabilities, and receipts |
| `shared/demo.ts` | Fixed demo limits and display-only window accounting |
| `shared/allowance.ts` | Native issue, spend, and revoke transaction builders |
| `api/pull.ts` | Fixed-plan merchant collection; validates asset, spender, name, limits, and native permission |
| `api/test-funds.ts` | Public V3 faucet request; never distributes merchant funds |
| `api/status.ts` | Public network and merchant configuration status, without secrets |

## Original classroom material

The earlier USDC, family, natural-language, and app-bound examples are retained in the shared helpers, scripts, and `move/` directory. Their original instructions and historical receipts are in [docs/original-classroom.md](docs/original-classroom.md). That document describes the earlier interface, not the current live playground; its initial testnet-only availability statement is historical. Native allowances are also enabled on Sui mainnet, but this app deliberately uses testnet.

The legacy app-bound `rotate_spender` example lacks an allowance-to-merchant ownership check. It is not used by the native playground and has not been redeployed as part of this update. Treat that custom module as teaching code, not a production payment contract.

References: [Native Sui allowances](https://docs.sui.io/onchain-finance/allowances/allowances-overview), [Sui SDK and V3 faucet](https://sdk.mystenlabs.com/sui).
