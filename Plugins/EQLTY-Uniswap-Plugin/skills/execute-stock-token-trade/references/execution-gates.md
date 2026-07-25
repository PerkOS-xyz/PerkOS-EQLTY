# Live execution gates

Require every gate:

1. The strategy is active and unexpired.
2. The current ENS fleet policy is valid, unexpired and not paused.
3. ENS permits the ticker and amount.
4. The authorized agent, input token, Stock Token and router match.
5. The amount is within per-trade and remaining total budgets.
6. Every selected agent rail is linked to its 1Claw spending policy.
7. The paid x401 or x402 signal matches the configured ticker.
8. The Graph data is live, recent and provider-backed.
9. Pool liquidity meets the ENS and compiled minimums.
10. Market deviation meets the ENS and compiled ceilings.
11. The Uniswap API quote and payload are live on chain `4663`.
12. The risk signer signs the exact calldata and quote hashes.
13. EQLTY Vault execution returns a transaction hash.

Never downgrade a failed gate to a warning. Ask for the missing authorization,
funding or provider state instead of silently using preview data.
