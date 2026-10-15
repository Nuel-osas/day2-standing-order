# Standing Order — The Allowance Playground

A live Sui testnet demo of native recurring payment authorisation. Each student gets a personal demo merchant for their payer account. The payer grants permission once, the merchant collects within its limits, and the payer can revoke at any time.

**Live:** https://day2-standing-order.vercel.app

Built for Account Layer Week, SuiHub Lagos. React + Vite frontend, Vercel Node.js functions, and `@mysten/sui` over gRPC. All transactions use **testnet**, with free test SUI. The public demo uses `0x2::allowance` directly and does not depend on a custom Move package.

## Try it

1. Choose **Demo wallet**, or connect a testnet wallet under **My wallet**.
2. Select **Get test funds** to fund both your payer and personal merchant through the public Sui V3 faucet. Proof-of-work may take a minute per wallet. Existing payer coin objects can be converted into the same owner's address balance. **Get merchant gas** also funds the merchant independently.
3. Review the plan and **Approve this allowance**: 0.001 SUI per 60 seconds, 0.006 SUI lifetime cap, expiry 24 hours after approval.
4. **Collect 0.001 SUI**. Your personal merchant signs locally and pays gas; the payer does not sign the charge. The merchant key is never sent to a server.
5. **Try another charge** in the same window. Sui rejects it. The browser simulates first, so a simulated rejection creates no payment or execution gas charge.
6. Enable **Auto-charge when the budget renews**, or wait for the countdown and charge manually. The first successful spend anchors the 60-second windows. Unused budgets do not accumulate.
7. **Revoke permission**, then **Try charging the revoked allowance**. The merchant can no longer use it.

The **Follow the payment** panel shows payer and merchant wallet totals side by side, including address balances and coin objects. The payer card identifies whether it is using the browser demo wallet or your connected wallet. In **My wallet** mode, the payer address, balance, allowances, and receipts follow the selected connected account; switching accounts selects that account's own merchant, and disconnecting clears both cards without falling back to the demo wallet. It refreshes every eight seconds and after actions, highlights observed increases or decreases, and links the last payment sent and received to its receipt. Red outgoing and green incoming markers show the payment direction, with a brief arrow animation on success. The merchant pays gas: gas can exceed the 0.001 SUI payment, so its net wallet balance can fall even after receiving a payment. Failed reads retain the last balance with an error label instead of displaying a misleading zero.

The auto-charge scheduler runs **only while the browser tab is open**, and browsers can throttle background tabs. Permission renewal is enforced onchain; submitting a payment still requires a scheduler. This demo does not claim unattended server-side subscriptions. An allowance is not a reservation of funds, so a charge also requires sufficient address balance.

Merchant keys are generated separately for each payer address in each browser and persist across reloads. Different students/browsers do not share merchant keys, balances, or payment history. A different browser creates a different merchant, even for the same connected payer. Activity receipts are stored per payer/merchant pair in the browser. Allowances are recovered from onchain `AllowanceCap` objects after a reload. The local countdown is informational; Sui's clock decides whether a spend is valid. Demo payer and merchant keys are stored in localStorage and must only hold testnet tokens; clearing browser storage removes them. Connected wallet keys remain in the wallet. Older permissions, including those for the retired shared merchant, appear under **Previous merchant permissions** and can still be revoked by their payer.

## Local development

Use **Node 24.7+ within the 24.x line** (native Argon2 makes the V3 faucet proof practical) and pnpm. The personal merchant playground requires no server signing key.

```sh
pnpm install
vercel dev --listen 3017
```

`pnpm dev` serves the UI only. Use `vercel dev` for the API routes. TypeScript is pinned to 5.9 because the local Vercel 50.x function runner fails when loading this project's API modules with TypeScript 6.

The shared-merchant `/api/pull` endpoint now returns HTTP 410 so old tabs cannot continue collecting through it. `shared/deployment.ts`, `MERCHANT_SECRET_KEY`, `DEMO_PASSCODE`, and `DEEPSEEK_API_KEY` are retained only for legacy classroom scripts/endpoints; the current interface does not use them. Never expose legacy server keys with a `VITE_` prefix.

## Validation

```sh
pnpm test
pnpm exec tsx scripts/check-handlers.ts
pnpm build
```

The build type-checks the frontend, server functions, shared helpers, and scripts. Unit tests cover rate-window boundaries, lazy reset, non-accumulation, lifetime exhaustion, expiry, and start times. API checks cover rejected methods and malformed identifiers.

The complete browser test uses real testnet transactions: funding, grant, charge, same-window rejection, timed renewal, reload recovery, revocation, and rejected post-revocation charge. No mocked chain results are used for that test.

## Deploy to Vercel

The existing project is `day2-standing-order`. Personal merchants are created and funded by each student in the app; no server merchant key is required. Run:

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
| `src/lib/merchant.ts` | Validate the payer/merchant pair, simulate, and sign personal merchant collections locally |
| `shared/demo.ts` | Fixed demo limits and display-only window accounting |
| `shared/allowance.ts` | Native issue, spend, and revoke transaction builders |
| `api/pull.ts` | Retired shared-merchant route; returns HTTP 410 |
| `api/test-funds.ts` | Public V3 faucet request; never distributes merchant funds |
| `api/status.ts` | Public network and personal-merchant mode status |

## Original classroom material

The earlier USDC, family, natural-language, and app-bound examples are retained in the shared helpers, scripts, and `move/` directory. Their original instructions and historical receipts are in [docs/original-classroom.md](docs/original-classroom.md). That document describes the earlier interface, not the current live playground; its initial testnet-only availability statement is historical. Native allowances are also enabled on Sui mainnet, but this app deliberately uses testnet.

The legacy app-bound `rotate_spender` example lacks an allowance-to-merchant ownership check. It is not used by the native playground and has not been redeployed as part of this update. Treat that custom module as teaching code, not a production payment contract.

References: [Native Sui allowances](https://docs.sui.io/onchain-finance/allowances/allowances-overview), [Sui SDK and V3 faucet](https://sdk.mystenlabs.com/sui).
