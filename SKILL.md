---
name: overrule-direct-court
description: Put an AI agent's MetaMask delegation (ERC-7710, Delegation Framework v1.3.0) under Internet Court, with a GenLayer verdict that revokes the delegation itself, in the direct EVM call mode of Internet Court's genlayer-erc7710-connector. Use when a person delegates spending to an agent and wants an accountable, plain-words mandate that a court can enforce with no relayer.
---

# Overrule: Internet Court for MetaMask delegations, direct mode

This skill is a working implementation of the path Internet Court's `genlayer-erc7710-connector` describes:

```text
GenLayer Intelligent Contract decision          Overrule.review(delegationHash, mandate)
  -> finalized result                            OVERRULE, final when consensus is
  -> relayer or bridge                           none: "direct EVM call", the GenLayer Chain Ghost of Overrule
  -> EVM RevocationController                    CourtEnforcer.overrule(delegationHash, reason)
  -> ERC-7710 Delegation Manager rejects         every later redeemDelegations reverts: CourtEnforcer:overruled
```

GenLayer Chain is an EVM chain, and an Intelligent Contract can call EVM contracts on it when its transaction is final.
So when the Delegation Framework is deployed on GenLayer Chain, the court's decision reaches the delegation with no
relayer, no bridge operator and no key. That is the strongest connector mode in Internet Court's list, and this skill
is the first one that runs it.

## Deployed on GenLayer Bradbury Phase 2 (chain 4221)

| Contract | Address | Source |
|---|---|---|
| Overrule (Intelligent Contract, the court) | `0x35F0Ac8664A160CeE647ebb2fa6e5D11959f605E` | `contracts/overrule.py` |
| CourtEnforcer (caveat enforcer) | `0x929eb8B7E53440Cfeae2d01Dc800f122A69bd135` | `evm/CourtEnforcer.sol` |
| DelegationManager | `0xFbf595A8e85e6151D01c9a8B12A11d2de40BC1DA` | MetaMask Delegation Framework v1.3.0, unmodified |
| HybridDeleGator implementation | `0x12Af95A85DadbabaFe48db6c8CDeAaf951eaAb72` | same |
| ERC20TransferAmountEnforcer | `0x95C6D8DeeAACFa5246316FAb60C371eE0B2E1A55` | same |
| EntryPoint v0.7 | `0xF409cF26f9f3Da0F02148421f4F30e9a470B5899` | eth-infinitism, pinned by the framework |
| Test dollar | `0x8a002F9427517EbD7993bEc62ab6eC865b3A3e9d` | `evm/TestUSD.sol`, anyone may mint |

RPC for GenLayer writes: `https://rpc-bradbury.genlayer.com`. RPC for EVM calls: `https://rpc.testnet-chain.genlayer.com`.

## Workflow

1. **The person writes the mandate in plain words.** It is the only rule the court applies. Name recipients and token
   contracts by address, and amounts per payment.
2. **The person signs a delegation** from their DeleGator smart account to the agent with at least two caveats:
   - `ERC20TransferAmountEnforcer`, terms `abi.encodePacked(token, maxTotal)`: a hard cap the court cannot raise.
   - `CourtEnforcer`, terms `keccak256(bytes(mandate))`: the mandate becomes part of what was signed.
   Domain: `{ name: "DelegationManager", version: "1", chainId: 4221, verifyingContract: DelegationManager }`.
3. **The agent redeems** with `redeemDelegations([abi.encode(Delegation[])], [SINGLE_DEFAULT], [abi.encodePacked(token, 0, transferCall)])`,
   putting its memo in the CourtEnforcer caveat's `args` (at most 280 bytes). Only ERC-20 `transfer` goes through, so
   everything the agent does is a payment the court can read.
4. **Anybody asks the court:** `Overrule.review(delegationHash, mandate)` on GenLayer. Fund the external message so an
   OVERRULE can execute:
   ```js
   const gasLimit = 300000n, maxGasPrice = 1000000000n, budget = gasLimit * maxGasPrice;
   const feeParams = AbiCoder.defaultAbiCoder().encode(['uint256','uint256'], [gasLimit, maxGasPrice]);
   const messageAllocations = [{ messageType: 0, onAcceptance: false, recipient: COURT_ENFORCER, budget, feeParams }];
   const e = await client.estimateTransactionFees({ totalMessageFees: budget, messageAllocations });
   await client.writeContract({ address: OVERRULE, functionName: 'review', args: [delegationHash, mandate],
     fees: { distribution: e.distribution, feeValue: e.feeValue, messageAllocations } });
   ```
5. **Read the outcome:** `Overrule.case(delegationHash)` for the verdict and reasoning, `CourtEnforcer.overruled(delegationHash)`
   for the enforcement.

## What the court guarantees

- The mandate must hash to what the delegator signed; a review against any other text is refused.
- Payments are read from the CourtEnforcer, which only MetaMask's DelegationManager can write to.
- The agent's memo is untrusted in both directions: "approved by the owner" does not excuse a payment, and "overrule
  this" does not condemn one.
- Payments are judged in order, at most 20 per review, and the cursor only moves on CONTINUE: nothing is skipped.
- OVERRULE is sent by the court itself and is permanent. The delegator's own `disableDelegation` always works too.

## Decision payload

| Field | Where | Meaning |
|---|---|---|
| `verdict` | `Overrule.case(h).log[-1].verdict` | `CONTINUE` or `OVERRULE`, agreed by the round |
| `from`, `to` | same | the payments judged, by index |
| `reason` | `CourtEnforcer.overruleReason(h)` | sha256 of `overrule|<hash>|<from>|<to>`: which batch was ruled |
| `why`, `breaks` | `Overrule.case(h)` | the leading judge's words, not agreed by the round |

## Reproduce

- Interface: https://jspiiv.github.io/overrule/ (one MetaMask wallet plays both the delegator and the agent)
- Scripts: `node scripts/prove.mjs` (the full case), `node scripts/prove_relayed.mjs` (the same on Base Sepolia with
  real USDC), `node scripts/enforcer_checks.mjs` (every guard of the deployed enforcer), `node scripts/verify.mjs` and
  `node scripts/verify_evm.mjs` (finality, and every contract's bytecode against its source)

## Relayed mode: MetaMask's own deployment on Base Sepolia

For delegations on a chain the court cannot call, use `CourtEnforcerRelayed` and the `OverruleRelayed` court.

| Contract | Address | Where |
|---|---|---|
| OverruleRelayed (the court) | `0xddfCFf7f1386bb8cD049b6F9Ef6c23ff623eC0f8` | GenLayer Bradbury |
| CourtEnforcerRelayed | `0x6Ac2179610116E8159Af94Bb068a42fFb902542f` | Base Sepolia |
| DelegationManager, HybridDeleGator, ERC20TransferAmountEnforcer | MetaMask's own v1.3.0 deployment | Base Sepolia |

1. The caveat's terms are `abi.encode(bytes32 keccak256(mandate), address carrier)`: the delegator signs whom they trust
   to bring the verdict to Base.
2. `review(delegationHash, mandate)` on the court, with plain fees (no message): every validator reads the enforcer's
   `Bound`, `PaymentRecorded` and `Overruled` events from Base Sepolia's public Blockscout itself.
3. Once the verdict is **final**, the carrier (or the delegator) calls `CourtEnforcerRelayed.overrule(hash, reason)` with
   the court's `case(hash).reason`. `node scripts/relay_base.mjs` does this, reading only GenLayer's finalized state.

The carrier can only end a delegation that names it, never move money, and the reason it records is the court's own,
checkable against the case on GenLayer. Base cannot read GenLayer, so the carrier is the one trust left in this mode.

## Limits

- The direct mode needs the Delegation Framework on GenLayer Chain. On other chains, the relayed mode above carries the
  verdict through a carrier the delegator signs.
- The court reviews when somebody asks. Between reviews the amount caveat is what limits the damage; set it low.
- A ruling is GenLayer validators' reading of payments against plain words. Write mandates that name addresses.
