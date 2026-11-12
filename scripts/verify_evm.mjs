// Independent check that every EVM contract Overrule relies on runs exactly the source in this repository: MetaMask's
// Delegation Framework v1.3.0 (vendor/, unmodified), EntryPoint v0.7, the P256 library, the CourtEnforcer and the test
// dollar. GenLayer Chain's explorer cannot verify source yet, so this compiles each with the framework's settings
// (solc 0.8.23, 200 runs, london), reads the code from the chain and compares byte for byte. Immutable values and linked
// library addresses are set at deployment, so their slots are taken from the chain and printed.
//   node scripts/verify_evm.mjs
import { JsonRpcProvider } from 'ethers';
import { execSync } from 'child_process';
import fs from 'fs'; import path from 'path';
import { compile, ROOT } from './compile.mjs';

const chain = new JsonRpcProvider('https://rpc.testnet-chain.genlayer.com', 4221);
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployment.json'), 'utf8'));
const TARGETS = [['entry_point', 'EntryPoint'], ['delegation_manager', 'DelegationManager'], ['scl_rip7212', 'SCL_RIP7212'],
  ['hybrid_impl', 'HybridDeleGator'], ['amount_enforcer', 'ERC20TransferAmountEnforcer'], ['court_enforcer', 'CourtEnforcer'], ['testusd', 'TestUSD']];
let all = true;
const commit = execSync('git rev-parse HEAD', { cwd: path.join(ROOT, 'vendor', 'delegation-framework') }).toString().trim();
console.log('MetaMask Delegation Framework at', commit.slice(0, 12), '| solc 0.8.23, 200 runs, london | chain 4221');
for (const [key, name] of TARGETS) {
  const c = compile(name);
  const live = (await chain.getCode(dep[key].address)).slice(2).toLowerCase();
  const filled = c.deployed.split('');
  const fixed = [];
  const fill = (start, length, what) => { for (let i = start * 2; i < (start + length) * 2; i++) filled[i] = live[i]; fixed.push(what + ' 0x' + live.slice(start * 2, (start + length) * 2).slice(-40)); };
  for (const spots of Object.values(c.refs)) for (const { start, length } of spots) fill(start, length, 'immutable');
  for (const byName of Object.values(c.dlinks)) for (const [lib, spots] of Object.entries(byName)) for (const { start, length } of spots) fill(start, length, lib);
  // A library's own code starts with PUSH20 of its address, filled in at deployment.
  if (name === 'SCL_RIP7212') fill(1, 20, 'self');
  const same = filled.join('') === live;
  all = all && same;
  console.log(`${same ? 'MATCH    ' : 'DIFFERENT'} ${name.padEnd(28)} ${dep[key].address}  ${[...new Set(fixed)].slice(0, 3).join(', ')}`);
}
// The relayed mode: our CourtEnforcerRelayed on Base Sepolia, and MetaMask's own deployment of the framework there,
// compiled from the same vendored source and settings.
if (dep.relayed) {
  const base = new JsonRpcProvider(dep.relayed.rpc, dep.relayed.chain_id, { staticNetwork: true });
  console.log("Base Sepolia (84532): MetaMask's own v1.3.0 deployment, and the CourtEnforcerRelayed");
  for (const [addr, name] of [[dep.relayed.delegation_manager, 'DelegationManager'], [dep.relayed.hybrid_impl, 'HybridDeleGator'],
    [dep.relayed.amount_enforcer, 'ERC20TransferAmountEnforcer'], [dep.relayed.court_enforcer.address, 'CourtEnforcerRelayed']]) {
    const c = compile(name);
    const live = (await base.getCode(addr)).slice(2).toLowerCase();
    const filled = c.deployed.split('');
    for (const spots of Object.values(c.refs)) for (const { start, length } of spots) for (let i = start * 2; i < (start + length) * 2; i++) filled[i] = live[i];
    for (const byName of Object.values(c.dlinks)) for (const spots of Object.values(byName)) for (const { start, length } of spots) for (let i = start * 2; i < (start + length) * 2; i++) filled[i] = live[i];
    // MetaMask compiled from its own checkout, so the CBOR metadata at the end (which hashes source file paths) can
    // differ while every executable byte is the same. Compare the code with each side's metadata removed.
    const strip = (hex) => hex.slice(0, hex.length - (parseInt(hex.slice(-4), 16) + 2) * 2);
    const exact = filled.join('') === live;
    const code = strip(filled.join('')) === strip(live);
    all = all && code;
    console.log(`${exact ? 'MATCH    ' : code ? 'MATCH*   ' : 'DIFFERENT'} ${name.padEnd(28)} ${addr}${!exact && code ? '  * every executable byte; only the metadata hash of file paths differs' : ''}`);
  }
}
console.log(all ? 'every contract on chain is the source in this repository' : 'at least one contract differs');
process.exit(all ? 0 : 1);
