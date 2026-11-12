// Deploys the relayed mode: CourtEnforcerRelayed on Base Sepolia, beside MetaMask's own Delegation Framework v1.3.0
// deployment there, and the OverruleRelayed court on GenLayer Bradbury, which reads the enforcer's events from Base
// Sepolia's public Blockscout explorer.
//
//   PCHG=... node scripts/deploy_relayed.mjs
import { Wallet, JsonRpcProvider, ContractFactory } from 'ethers';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { client, fees, EXPLORER } from './net.mjs';
import { compile, ROOT } from './compile.mjs';

export const BASE = {
  rpc: process.env.BASE_RPC || 'https://base-sepolia-rpc.publicnode.com',
  explorer: 'https://base-sepolia.blockscout.com',
  chain_id: 84532,
  // MetaMask Delegation Framework v1.3.0, as MetaMask deployed it (documents/Deployments.md in the framework)
  delegation_manager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
  hybrid_impl: '0x48dBe696A4D990079e039489bA2053B36E8FFEC4',
  amount_enforcer: '0xf100b0819427117EcF76Ed94B358B1A5b5C6D2Fc',
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

const KS = path.join(os.homedir(), '.genlayer', 'keystores');
const w = await Wallet.fromEncryptedJson(fs.readFileSync(path.join(KS, 'pchg.json'), 'utf8'), process.env.PCHG || '');
const base = w.connect(new JsonRpcProvider(BASE.rpc, BASE.chain_id, { staticNetwork: true }));
const OUT = path.join(ROOT, 'deployment.json');
const dep = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const save = () => fs.writeFileSync(OUT, JSON.stringify(dep, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
dep.relayed = dep.relayed || { chain: 'base-sepolia', ...BASE };

for (const k of ['delegation_manager', 'hybrid_impl', 'amount_enforcer', 'usdc']) {
  if ((await base.provider.getCode(BASE[k])).length < 10) throw new Error('nothing deployed at ' + k + ' ' + BASE[k]);
}

if (!dep.relayed.court_enforcer) {
  const c = compile('CourtEnforcerRelayed');
  fs.writeFileSync(path.join(ROOT, 'evm', 'abi', 'CourtEnforcerRelayed.json'), JSON.stringify(c.abi, null, 2));
  const contract = await new ContractFactory(c.abi, c.bytecode, base).deploy(BASE.delegation_manager);
  const r = await contract.deploymentTransaction().wait();
  dep.relayed.court_enforcer = { address: await contract.getAddress(), tx: r.hash, block: r.blockNumber };
  save();
  console.log('CourtEnforcerRelayed', dep.relayed.court_enforcer.address, 'block', r.blockNumber);
}

if (!dep.relayed.overrule) {
  const c = client(w.privateKey);
  const code = fs.readFileSync(path.join(ROOT, 'contracts', 'overrule_relayed.py'), 'utf8');
  const hash = await c.deployContract({ code, args: [dep.relayed.court_enforcer.address, BASE.explorer, dep.relayed.court_enforcer.block], fees: await fees(c) });
  console.log('overrule_relayed tx', hash);
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const tx = await c.getTransaction({ hash });
    if (['ACCEPTED', 'FINALIZED'].includes(tx.statusName)) {
      if (tx.txExecutionResultName !== 'FINISHED_WITH_RETURN') { console.error('deploy failed', tx.txExecutionResultName); process.exit(1); }
      dep.relayed.overrule = { address: tx.txDataDecoded?.contractAddress || tx.recipient, tx: hash, deployed_at: new Date().toISOString() };
      save();
      break;
    }
  }
}
console.log('OVERRULE RELAYED', dep.relayed.overrule?.address, EXPLORER + '/address/' + dep.relayed.overrule?.address);
process.exit(0);
