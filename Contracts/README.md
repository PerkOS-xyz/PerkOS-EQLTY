# EQLTY contracts

The contract package contains the owner-funded vault used by guarded stock
token strategies.

`EQLTYVault` enforces:

- a fixed owner, agent, input token, output token and router per strategy;
- per-trade and total-spend limits;
- owner pause, revoke and withdrawal controls;
- expiry, nonce, calldata hash and slippage checks;
- an EIP-712 signature from the configured risk signer;
- temporary ERC-20 approval that is cleared after every router call;
- ERC-1271 validation only during the authorized execution call.

The output token is measured from the vault balance and delivered directly to
the strategy owner. The router cannot satisfy a trade by sending the asset to
an unrelated recipient.

## Build

```sh
forge fmt --check
forge build --sizes
forge lint
```

Generated output, caches and broadcast records are ignored.

## Deployment inputs

Copy `.env.example` to the local root `.env` and provide:

- `ROBINHOOD_RPC_URL`
- `RISK_SIGNER_ADDRESS`
- `TOKEN_SPENDER_ADDRESS`

The token spender must match the Permit2 address used by the selected Uniswap
route. Deployment should use a local Foundry keystore account:

```sh
forge script script/DeployEQLTYVault.s.sol:DeployEQLTYVault \
  --rpc-url "$ROBINHOOD_RPC_URL" \
  --account <keystore-alias> \
  --broadcast
```

No deployment is considered production-ready until the contract tests,
network configuration and resulting bytecode are independently reviewed.
