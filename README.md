# Standing Order

Subscriptions without custody, on Sui native allowances (`sui::allowance`, protocol 137, testnet and devnet only).

A user signs once to let a merchant pull 0.05 USDC a month from their address balance. Nothing is locked or escrowed. The chain enforces the monthly window, the lifetime cap and the expiry; the user revokes in one transaction and gets the storage rebate back. A parent gives a child a weekly allowance with one-tap revoke. The app-bound path routes every pull through a small Move module that only charges after a period was delivered.

Live: https://day2-standing-order.vercel.app (testnet)

Account Layer Week, Day 2, SuiHub Lagos.

## Layout

```
move/standing_order/        merchant module: subscribe (issue), deliver, charge (app_balance_spend), rotate_spender
shared/allowance.ts         every PTB: issueDirect, subscribeAppBound, spendDirect, chargeAppBound, deliver, revoke
shared/merchant.ts          server pull logic: read allowance, simulate, execute, decode the abort
shared/decode.ts            abort code -> name for sui::allowance and merchant, plus pre-execution refusals
shared/intent.ts            strict validation of the natural-language builder output
api/charge.ts               POST /api/charge  merchant pull, holds MERCHANT_SECRET_KEY
api/parse.ts                POST /api/parse   DeepSeek sentence -> validated allowance params, never signs
api/faucet.ts               POST /api/faucet  tops up the demo burner from the merchant key (passcode)
scripts/charge.ts           pnpm charge       the monthly cron
scripts/e2e.ts              pnpm e2e          every flow on testnet, digests to scripts/out/
scripts/double-charge.ts    pnpm double-charge   a retry that double-fires, second pull fails on chain
src/                        Vite + React + dapp-kit, demo burner or connected wallet as the funder
```

## Setup from a fresh clone

Needs Node 22+, pnpm, Sui CLI 1.80+ (testnet), `@mysten/sui` 2.31+ (this repo pins 2.35.0).

```bash
pnpm install
pnpm move:test                        # 10 Move unit tests
cp .env.example .env                  # fill MERCHANT_SECRET_KEY, DEEPSEEK_API_KEY, DEMO_PASSCODE
pnpm dev                              # UI only; /api needs `vercel dev`
```

The deployed ids are in `shared/deployment.ts`. To deploy your own copy, put a funded key at `../.secrets/day2.json` + `<address>.key` (Sui keystore format) and run `pnpm setup`: it moves USDC coins into the address balance, funds a fresh merchant key, publishes the package and creates `Merchant<USDC>` with price 0.05 USDC. It rewrites `shared/deployment.ts`.

Deploy: `vercel deploy --prod --yes --cwd <absolute path to this repo>` with `MERCHANT_SECRET_KEY`, `DEEPSEEK_API_KEY`, `DEMO_PASSCODE` set as production env vars.

## The funder needs USDC in its address balance

Allowances withdraw from the funder's address balance, never from `Coin` objects. A Slush wallet with USDC coins must first run `0x2::coin::send_funds(coin, self)`; the UI shows a "Move USDC coins to address balance" button when it sees coins. Testnet USDC type:
`0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC`

## Class demo script

1. Open the live URL. Funder: Demo burner. Click Fund burner, enter the passcode (0.1 SUI + 0.3 USDC from the merchant key).
2. 1. Subscribe: Subscribe (direct). One signature. Show the allowance in "Allowances you granted": window anchored "at first spend".
3. Charge this month: the merchant server pulls 0.05 USDC. Allowance now shows anchored at that time, window #0, 0.05 / 0.05.
4. Charge this month again: refused, `allowance::EExceedsRateLimit (code 4)` from simulation, no gas spent.
5. Subscribe (app-bound). Charge without delivering: `merchant::ENothingDue`. Deliver period + charge: succeeds. Deliver + charge again: `EExceedsRateLimit`. Two independent guards: the merchant's rule and the user's limit.
6. Cancel (revoke): show the storage rebate line in the log.
7. 2. Family: Give allowance (0.1 USDC a week, plus 0.03 SUI gas for the child, same signature). Child spends 0.03. Child tries the full week again: refused. Revoke: rebate shown.
8. 3. Describe it: "Give Tobi 2 USDC a week until December" -> Parse -> confirmation card -> Confirm and sign.
9. Terminal: `pnpm charge <allowanceId>` is the cron; `pnpm double-charge` shows a failed pull landing on chain with a digest.
10. Switch Funder to Connected wallet with a Slush testnet account and repeat step 2 for a student.

## Verified on testnet (12 Oct 2026)

Package `0xfc34bc1003fd2381cafdb8cbedd5aad5df775d12b9f4a93e1e2b52d74ac1d8f6`, merchant `0x5140582789455790f60333bf317c2a84b49098729c2e5b35eadd9d99d5ed10d8`.

| Step | Digest |
| --- | --- |
| publish | PVNMFvzMjq5Tiigzr52Jo1ViRZZ1WgvC3zHPQcNB7UA |
| direct allowance create | FqB9PSre2EkrAmpW3WUXrJfgV358qdTDiDwLH5nD316i |
| direct spend (merchant pull) | KnxCc8ffQft4LouAEKc9JQ1SjgWTNE1RuHeGfRtewDs |
| second pull, failed on chain, EExceedsRateLimit | 6Q96Ywq8tTScxJYe7C9Bc7LLekCb7iC6CaiZXYwxyXyi |
| family create (weekly) | BuWoGn5WWnjqXST4QqQjQ5vAuQbN4jnWmAjrgaQCDLW3 |
| child spend | bZuKjrkyvcaR3UcnUcvgjeJ4gey84JmEsVMpqQHjVE9 |
| family revoke (rebate 0.00597 SUI) | 4wY9w9UedrvFVDbPGh9HUguSBJ2F87VVMsuRbjhQNd21 |
| app-bound subscribe (propose_for_app + issue) | 7k7FA5boqLVdjmAYDETGbtrX5BW4wDNSnS9Mavygambh |
| deliver | AN7XX5cRDhefgzxbHnYWcLBw7QaiMKqZx2YozhiCRbnE |
| app-bound charge (app_balance_spend) | 6RF6QsZFwsayakPEXVRawztoY6HNCR3FAZz2ymCY8RTo |
| rotate_spender to new key / back | GwUENVdd1T3GhUkX7tbiN9EgZ829QgzfxtDPVHUJDTZs / 67HVkAypYeQQqMZMBUHXjfunMeS5rME4n22nzZRxupQL |
| app-bound revoke | EF6BkbVeZzwadL1dHzNrtBuja9w49cMcJuw6eKF377hy |

Full logs, including the simulation error text for every refusal, are in `scripts/out/`.

## Gotchas hit while building

- Allowances spend from the address balance only. 2 USDC as a coin object counts for nothing until `coin::send_funds` moves it.
- The type argument to `allowance::new` is `Balance<USDC>`; `balance_spend`, `tx.balance` and `tx.withdrawal` take the coin type `USDC`.
- The SDK resolver simulates while building, so a pull that would abort throws during `build()`. Setting a gas budget does not skip it. To get a failed pull on chain you must sign before the window closes (see `scripts/double-charge.ts`).
- Funder balance is checked at signing, before Move runs. A pull bigger than the funder's balance is refused as "Invalid withdraw reservation: Insufficient address balance", not as a rate-limit abort.
- A wrong spender is refused at signing too, at no gas. A revoked allowance fails as "object not found" before execution. An expired one still exists and fails in execution, so the spender pays gas.
- `tx.balance({ allowance: { app } })` calls `app_balance_spend` directly with your `SpendPermit`. If your module wants to own the spend (check delivery, route the funds), take the `AllowanceWithdrawal` yourself: `tx.withdrawal({ from: 'allowance' })` and call your function.
- `issue` does not return the new allowance id, so the module binds the Subscription to its allowance on the first charge.
- The module emits no events for allowances. Find them through the funder's `AllowanceCap` objects, or keep your own subscriber table.
