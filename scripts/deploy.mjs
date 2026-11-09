// Deploy Overrule end to end on GenLayer Bradbury. On GenLayer Chain (the EVM side, chain 4221): MetaMask's Delegation
// Framework v1.3.0, unmodified (EntryPoint v0.7, DelegationManager, the HybridDeleGator smart account implementation,
// ERC20TransferAmountEnforcer), a test dollar, and the CourtEnforcer caveat. Then the Overrule Intelligent Contract,
// then the one time wiring of the enforcer to it.
//   PCHG=<pw> node scripts/deploy.mjs
import { Wallet, JsonRpcProvider, ContractFactory, Contract } from 'ethers';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { client, fees, EXPLORER } from './net.mjs';
import { compile, ROOT } from './compile.mjs';

const PW = process.env.PCHG || '';
if (!PW) { console.error('set PCHG'); process.exit(1); }
const KS = path.join(os.homedir(), '.genlayer', 'keystores');
const w = await Wallet.fromEncryptedJson(fs.readFileSync(path.join(KS, 'pchg.json'), 'utf8'), PW);
const evm = w.connect(new JsonRpcProvider('https://rpc.testnet-chain.genlayer.com', 4221));
const OUT = path.join(ROOT, 'deployment.json');
const dep = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { network: 'genlayer testnet bradbury phase 2', chain_id: 4221 };
const save = () => fs.writeFileSync(OUT, JSON.stringify(dep, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fills each external library's address into the bytecode where solc left a placeholder.
function link(c, libs) {
  let code = c.bytecode.slice(2);
  for (const [, byName] of Object.entries(c.links)) {
    for (const [lib, spots] of Object.entries(byName)) {
      const addr = libs[lib];
      if (!addr) throw new Error('no address for library ' + lib);
      for (const { start, length } of spots) code = code.slice(0, start * 2) + addr.slice(2).toLowerCase() + code.slice((start + length) * 2);
    }
  }
  return '0x' + code;
}

async function deploy(key, name, args = [], libs = {}) {
  if (dep[key]) return dep[key].address;
  const c = { ...compile(name) };
  c.bytecode = link(c, libs);
  fs.mkdirSync(path.join(ROOT, 'evm', 'abi'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'evm', 'abi', name + '.json'), JSON.stringify(c.abi, null, 2));
  const contract = await new ContractFactory(c.abi, c.bytecode, evm).deploy(...args);
  await contract.waitForDeployment();
  dep[key] = { address: await contract.getAddress(), tx: contract.deploymentTransaction().hash };
  dep.compiler = c.version;
  save();
  console.log('deployed', key.padEnd(18), dep[key].address);
  return dep[key].address;
}

console.log('deployer', w.address);
const entryPoint = await deploy('entry_point', 'EntryPoint');
const manager = await deploy('delegation_manager', 'DelegationManager', [w.address]);
const p256 = await deploy('scl_rip7212', 'SCL_RIP7212');
await deploy('hybrid_impl', 'HybridDeleGator', [manager, entryPoint], { SCL_RIP7212: p256 });
await deploy('testusd', 'TestUSD');
await deploy('amount_enforcer', 'ERC20TransferAmountEnforcer');
const enforcer = await deploy('court_enforcer', 'CourtEnforcer', [manager]);
compile('ERC1967Proxy');
fs.writeFileSync(path.join(ROOT, 'evm', 'abi', 'ERC1967Proxy.json'), JSON.stringify(compile('ERC1967Proxy').abi, null, 2));
if (!dep.overrule) {
  const c = client(w.privateKey);
  const code = fs.readFileSync(path.join(ROOT, 'contracts', 'overrule.py'), 'utf8');
  const hash = await c.deployContract({ code, args: [enforcer], fees: await fees(c) });
  console.log('overrule tx', hash);
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const tx = await c.getTransaction({ hash });
    if (['ACCEPTED', 'FINALIZED'].includes(tx.statusName)) {
      if (tx.txExecutionResultName !== 'FINISHED_WITH_RETURN') { console.error('deploy failed', tx.txExecutionResultName); process.exit(1); }
      dep.overrule = { address: tx.txDataDecoded?.contractAddress || tx.recipient, tx: hash };
      dep.address = dep.overrule.address; dep.tx = hash; dep.deployed_at = new Date().toISOString();
      save();
      break;
    }
  }
}
if (!dep.wired) {
  const e = new Contract(enforcer, compile('CourtEnforcer').abi, evm);
  await (await e.setCourt(dep.overrule.address)).wait();
  dep.wired = true; save();
}
console.log('OVERRULE', dep.overrule?.address, EXPLORER + '/address/' + dep.overrule?.address);
process.exit(0);
