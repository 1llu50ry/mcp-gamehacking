---
name: blockchain-game-rev
description: "Fully-onchain and web3 games (Axie, StepN, Sorare, Dark Forest) -- how to RE Solidity contracts + GraphQL APIs + client-side state hashing to find economic bugs."
metadata:
  type: tool-reference
  source: curated
  topics: [blockchain, solidity, web3, evm, game-economy]
---
# Blockchain Game Reverse Engineering

Web3 games put part of their state on-chain (ownership, trade) and leave gameplay client-side with a signed state transition.

## Attack surfaces

- **Contract bugs** -- re-entrancy on in-game items, access-control missing on mint.
- **Signed-state replay** -- replay a win proof to a different contract.
- **GraphQL API** -- most dapps leak internal queries letting you read admin state.
- **RPC exposure** -- cheap `eth_call` lets you simulate world state before acting.

## Tooling

- `foundry`'s `cast call` for one-shot RPC.
- `slither` for Solidity static analysis.
- `tenderly` for mainnet simulation.
- `mythril` / `manticore` for symbolic.

## Related

[[angr-mcp]], the `malware-analyst` + `exploit-developer` agents.
