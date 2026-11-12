// Every guard of the deployed CourtEnforcer, exercised against the live contract on GenLayer Chain, and the gas the
// proof's own transactions used.
//
//   node scripts/enforcer_checks.mjs
//
// The guards are checked with eth_call, which runs the deployed bytecode against current chain state and lets the
// caller name any sender. That is how the DelegationManager and the court are impersonated here: nothing is sent,
// nothing is signed, and no state changes. The gas figures are read from the receipts of the transactions recorded in
// results/proved.json, and from the transaction that carried the court's overrule() call.
import { JsonRpcProvider, Interface, AbiCoder, solidityPacked, keccak256, toUtf8Bytes, ZeroHash, id } from 'ethers';
import fs from 'fs';

const CHAIN_RPC = 'https://rpc.testnet-chain.genlayer.com';
const dep = JSON.parse(fs.readFileSync(new URL('../deployment.json', import.meta.url)));
const proved = JSON.parse(fs.readFileSync(new URL('../results/proved.json', import.meta.url)));
const abi = JSON.parse(fs.readFileSync(new URL('../evm/abi/CourtEnforcer.json', import.meta.url)));
const provider = new JsonRpcProvider(CHAIN_RPC, 4221, { staticNetwork: true });
const enf = new Interface(abi);
const ENFORCER = dep.court_enforcer.address;
const MANAGER = dep.delegation_manager.address;
const TOKEN = dep.testusd.address;
const STRANGER = '0x000000000000000000000000000000000000dEaD';
const OVERRULED_A = proved.delegations.A;
const FRESH = keccak256(toUtf8Bytes('enforcer_checks: a delegation nobody has used'));
const MANDATE = keccak256(toUtf8Bytes('Pay only the vendor for API credits.'));
const MODE_SINGLE_DEFAULT = ZeroHash;
const VENDOR = '0x010a000000000000000000000000000000003e59';

const transfer = (to, amount) => new Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [to, amount]);
const approve = (to, amount) => new Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [to, amount]);
const single = (target, value, data) => solidityPacked(['address', 'uint256', 'bytes'], [target, value, data]);
const hook = (o = {}) => enf.encodeFunctionData('beforeHook', [
  o.terms ?? MANDATE, o.args ?? toUtf8Bytes('API credits'), o.mode ?? MODE_SINGLE_DEFAULT,
  o.exec ?? single(TOKEN, 0, transfer(VENDOR, 10n ** 18n)), o.hash ?? FRESH, o.delegator ?? STRANGER, STRANGER]);

async function call(from, data) {
  try {
    await provider.call({ from, to: ENFORCER, data });
    return 'ok';
  } catch (e) {
    const raw = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
    if (typeof raw === 'string' && raw.startsWith('0x08c379a0')) return AbiCoder.defaultAbiCoder().decode(['string'], '0x' + raw.slice(10))[0];
    const m = String(e?.shortMessage ?? e?.message ?? e).match(/(CourtEnforcer|CaveatEnforcer):[\w-]+/);
    return m ? m[0] : 'reverted (' + (raw ?? e?.shortMessage ?? 'no data') + ')';
  }
}

const results = [];
function check(label, got, want) {
  const ok = want instanceof RegExp ? want.test(got) : got === want;
  results.push({ label, got, ok });
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '   got: ' + got));
}

const court = enf.decodeFunctionResult('court', await provider.call({ to: ENFORCER, data: enf.encodeFunctionData('court') }))[0];
console.log('CourtEnforcer', ENFORCER, '| DelegationManager', MANAGER, '| court', court, '\n');

console.log('who may write a payment');
check('a stranger calling the hook is refused', await call(STRANGER, hook()), 'CourtEnforcer:only-manager');
check('the court itself calling the hook is refused', await call(court, hook()), 'CourtEnforcer:only-manager');
check('the DelegationManager recording a fitting transfer goes through', await call(MANAGER, hook()), 'ok');

console.log('\nwhat a payment may be');
check('a native-value call is refused', await call(MANAGER, hook({ exec: single(TOKEN, 1n, transfer(VENDOR, 1n)) })), 'CourtEnforcer:native-value');
check('an ERC-20 approve is refused: only transfer reads as a payment', await call(MANAGER, hook({ exec: single(TOKEN, 0, approve(VENDOR, 1n)) })), 'CourtEnforcer:only-erc20-transfer');
check('a transfer with extra calldata is refused', await call(MANAGER, hook({ exec: single(TOKEN, 0, transfer(VENDOR, 1n) + 'ff') })), 'CourtEnforcer:only-erc20-transfer');
check('a batch execution mode is refused', await call(MANAGER, hook({ mode: '0x01' + '00'.repeat(31) })), 'CaveatEnforcer:invalid-call-type');
check('a try execution mode is refused', await call(MANAGER, hook({ mode: '0x0001' + '00'.repeat(30) })), 'CaveatEnforcer:invalid-execution-type');
check('terms that are not one 32 byte mandate hash are refused', await call(MANAGER, hook({ terms: MANDATE + 'ff' })), 'CourtEnforcer:invalid-terms');
check('a memo of exactly 280 bytes is accepted', await call(MANAGER, hook({ args: toUtf8Bytes('m'.repeat(280)) })), 'ok');
check('a memo of 281 bytes is refused', await call(MANAGER, hook({ args: toUtf8Bytes('m'.repeat(281)) })), 'CourtEnforcer:memo-too-long');

console.log('\nafter the verdict');
check('delegation A, overruled on chain by the court, refuses every further payment', await call(MANAGER, hook({ hash: OVERRULED_A })), 'CourtEnforcer:overruled');
const stA = enf.decodeFunctionResult('state', await provider.call({ to: ENFORCER, data: enf.encodeFunctionData('state', [OVERRULED_A]) }));
check('delegation A reads overruled, with its mandate hash still bound', String(stA[0]) + ' ' + (stA[1] !== ZeroHash), 'true true');

console.log('\nwho may overrule');
check('a stranger calling overrule() is refused', await call(STRANGER, enf.encodeFunctionData('overrule', [FRESH, ZeroHash])), 'CourtEnforcer:only-court');
check('the DelegationManager calling overrule() is refused', await call(MANAGER, enf.encodeFunctionData('overrule', [FRESH, ZeroHash])), 'CourtEnforcer:only-court');
check('the court overruling a fresh delegation goes through', await call(court, enf.encodeFunctionData('overrule', [FRESH, ZeroHash])), 'ok');
check('the court overruling delegation A twice is refused', await call(court, enf.encodeFunctionData('overrule', [OVERRULED_A, ZeroHash])), 'CourtEnforcer:already-overruled');
const deployer = (await provider.getTransaction(dep.court_enforcer.tx)).from;
check('the court cannot be changed: setCourt again is refused, even from the deployer', await call(deployer, enf.encodeFunctionData('setCourt', [STRANGER])), 'CourtEnforcer:already-set');

// gas, from the proof's own receipts
console.log('\ngas used on GenLayer Chain');
const gas = [];
for (const t of proved.evm) {
  const r = await provider.getTransactionReceipt(t.hash);
  if (r) gas.push({ what: t.label, hash: t.hash, gas: Number(r.gasUsed) });
}
const logs = await provider.getLogs({ address: ENFORCER, topics: [id('Overruled(bytes32,bytes32)'), OVERRULED_A], fromBlock: 0, toBlock: 'latest' }).catch(() => []);
for (const l of logs) {
  const r = await provider.getTransactionReceipt(l.transactionHash);
  gas.push({ what: "GenLayer's finalization transaction that carried the court's overrule() on delegation A (consensus bookkeeping included)", hash: l.transactionHash, gas: Number(r.gasUsed) });
}
const own = await provider.estimateGas({ from: court, to: ENFORCER, data: enf.encodeFunctionData('overrule', [FRESH, ZeroHash]) });
gas.push({ what: 'overrule() itself, estimated from the court on a fresh delegation', hash: null, gas: Number(own) });
const rec = await provider.estimateGas({ from: MANAGER, to: ENFORCER, data: hook() });
gas.push({ what: "the CourtEnforcer's beforeHook alone, recording one payment with a short memo", hash: null, gas: Number(rec) });
for (const g of gas) console.log('  ' + String(g.gas).padStart(8) + '  ' + g.what);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} of ${results.length} checks against the deployed CourtEnforcer.`);
fs.writeFileSync(new URL('../results/enforcer_checks.json', import.meta.url),
  JSON.stringify({ checked_at: new Date().toISOString(), enforcer: ENFORCER, court, results, gas }, null, 1));
process.exit(passed === results.length ? 0 : 1);
