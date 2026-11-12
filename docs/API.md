# API

## Overrule, the court (Intelligent Contract on GenLayer Bradbury)

`0x35F0Ac8664A160CeE647ebb2fa6e5D11959f605E`, source [`contracts/overrule.py`](../contracts/overrule.py).
Every method returns a JSON string.

| Method | Kind | Arguments | Returns |
|---|---|---|---|
| `review` | write, open to anybody | `delegation_hash` (32 bytes hex), `mandate` (the plain text the delegator signed, at most 1000 characters) | `{"ok": true, "verdict": "CONTINUE" or "OVERRULE", "reviewed": [from, to], "status": "WATCHED" or "OVERRULED"}` |
| `resend` | write, open to anybody | `delegation_hash` | repeats a recorded overrule with no model if its message did not land; `{"ok": true}` |
| `case` | view | `delegation_hash` | the case: `delegation`, `delegator`, `cursor`, `reviews`, `status`, `reason`, and `log` (the last 20 reviews, each with `verdict`, `from`, `to`, `why`, `breaks`, `by`, `ts`), or `{"exists": false}` |
| `page` | view | `start`, `count` (at most 50) | cases newest first, each with its last review: `{"total": n, "items": [...]}` |
| `enforcer_address` | view | none | the CourtEnforcer the court reads and overrules |

`review` refuses, changing nothing, when: the hash is malformed; the mandate is empty, too long, or not the text whose
keccak256 the delegator signed; the delegation is already overruled; no payment was made under it; there is nothing
new since the last review; or the round returns no readable verdict. Each refusal is `{"ok": false, "error": "..."}`.

`review` and `resend` send a message to the CourtEnforcer on OVERRULE, so the caller funds it. See
[`SKILL.md`](../SKILL.md) for the `messageAllocations` to pass.

`verdict` is agreed by the round. `why` and `breaks` are the leading judge's words, kept for the record.

## CourtEnforcer (caveat enforcer on GenLayer Chain, 4221)

`0x929eb8B7E53440Cfeae2d01Dc800f122A69bd135`, source [`evm/CourtEnforcer.sol`](../evm/CourtEnforcer.sol), ABI in
[`evm/abi/CourtEnforcer.json`](../evm/abi/CourtEnforcer.json).

**Terms** (signed by the delegator): `keccak256(mandate)`, exactly 32 bytes.
**Args** (passed by the agent at redemption): the memo, UTF-8, at most 280 bytes.

| Function | Who | What |
|---|---|---|
| `beforeHook(terms, args, mode, executionCallData, delegationHash, delegator, redeemer)` | DelegationManager | binds the mandate on first use and records the payment and memo |
| `overrule(delegationHash, reason)` | the court | ends the delegation for good |
| `setCourt(court)` | deployer, once | wiring at deployment |
| `state(delegationHash)` | view | `(overruled, mandateHash, paymentCount, delegator)` |
| `payment(delegationHash, index)` | view | `(token, to, amount, at)` |
| `memo(delegationHash, index)` | view | the agent's memo |
| `mandateOf`, `delegatorOf`, `overruled`, `overruleReason`, `court`, `manager`, `MAX_MEMO` | view | public state |

Events: `PaymentRecorded(delegationHash, index, token, to, amount, memo)`, `Overruled(delegationHash, reason)`,
`CourtSet(court)`.

Revert strings:

| String | When |
|---|---|
| `CourtEnforcer:only-manager` | a hook called by anyone but the DelegationManager |
| `CourtEnforcer:overruled` | a redemption of an overruled delegation |
| `CourtEnforcer:invalid-terms` | terms that are not one 32 byte hash |
| `CourtEnforcer:memo-too-long` | a memo over 280 bytes |
| `CourtEnforcer:native-value` | an execution carrying native value |
| `CourtEnforcer:only-erc20-transfer` | any call that is not an exact ERC-20 `transfer` |
| `CourtEnforcer:only-court` | `overrule()` from anyone but the court |
| `CourtEnforcer:already-overruled` | a second `overrule()` of the same delegation |
| `CourtEnforcer:already-set` | `setCourt` after wiring, or from anyone but the deployer |
| `CaveatEnforcer:invalid-call-type`, `CaveatEnforcer:invalid-execution-type` | a batch or try execution mode |
