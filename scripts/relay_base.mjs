// The carrier for the relayed mode. It reads the OverruleRelayed court's cases from GenLayer's **finalized** state, so a
// verdict still inside its appeal window is never carried, and records every final OVERRULE on the
// CourtEnforcerRelayed on Base Sepolia with the court's own reason. It can only end delegations that name it as their
// carrier, and only with a reason the court published, which anybody can compare with the case on GenLayer.
//
//   CARRIER_KEY=0x... node scripts/relay_base.mjs           one pass
//   CARRIER_KEY=0x... node scripts/relay_base.mjs --watch   a pass every minute
//   PCHG=<pw> node scripts/relay_base.mjs                   with the pchg keystore, the carrier in the proof
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import fs from 'fs'; import os from 'os'; import path from 'path'; import url from 'url';
import { reader } from './net.mjs';
import { compile } from './compile.mjs';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployment.json'), 'utf8')).relayed;
const base = new JsonRpcProvider(R.rpc, R.chain_id, { staticNetwork: true });
const carrier = process.env.CARRIER_KEY
  ? new Wallet(process.env.CARRIER_KEY, base)
  : (await Wallet.fromEncryptedJson(fs.readFileSync(path.join(os.homedir(), '.genlayer', 'keystores', 'pchg.json'), 'utf8'), process.env.PCHG || '')).connect(base);
const enforcer = new Contract(R.court_enforcer.address, compile('CourtEnforcerRelayed').abi, carrier);
const court = reader();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pass() {
  const delivered = [];
  for (let start = 0; ; start += 50) {
    const page = JSON.parse(await court.readContract({ address: R.overrule.address, functionName: 'page', args: [start, 50], transactionHashVariant: 'latest-final' }));
    for (const c of page.items) {
      if (c.status !== 'OVERRULED' || !c.reason) continue;
      const h = c.delegation;
      if (await enforcer.overruled(h)) continue;
      if ((await enforcer.carrierOf(h)).toLowerCase() !== carrier.address.toLowerCase()) continue;
      const tx = await enforcer.overrule(h, '0x' + c.reason);
      await tx.wait(1, 300000);
      console.log('carried OVERRULE for', h, 'reason', c.reason, 'tx', tx.hash);
      delivered.push({ delegation: h, reason: c.reason, tx: tx.hash });
    }
    if (start + 50 >= page.total) break;
  }
  return delivered;
}

if (process.argv[1] && process.argv[1].endsWith('relay_base.mjs')) {
  console.log('carrier', carrier.address, 'for', R.overrule.address, '->', R.court_enforcer.address);
  do {
    try { const d = await pass(); if (!d.length) console.log(new Date().toISOString(), 'nothing to carry'); }
    catch (e) { console.log('pass failed:', e.shortMessage || e.message); }
    if (process.argv.includes('--watch')) await sleep(60000);
  } while (process.argv.includes('--watch'));
  process.exit(0);
}
