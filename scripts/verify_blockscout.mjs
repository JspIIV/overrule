// Publishes the CourtEnforcerRelayed's source on Base Sepolia's Blockscout, as a standard JSON input built from this
// repository with the framework's settings, so anybody can read it on the explorer.
//   node scripts/verify_blockscout.mjs
import fs from 'fs'; import path from 'path';
import { solc, findImport, SETTINGS, SOURCES, ROOT } from './compile.mjs';

const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployment.json'), 'utf8'));
const addr = dep.relayed.court_enforcer.address;
const name = 'CourtEnforcerRelayed', file = SOURCES[name];
const sources = {};
const record = (p) => { const r = findImport(p); if (r.contents !== undefined) sources[p] = { content: r.contents }; return r; };
record(file);
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { [file]: { content: sources[file].content } },
  settings: { ...SETTINGS, outputSelection: { '*': { '*': ['abi'] } } } }), { import: record }));
if ((out.errors || []).some((e) => e.severity === 'error')) throw new Error('compile failed');
const input = { language: 'Solidity', sources, settings: { ...SETTINGS, outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'metadata'] } } } };
const form = new FormData();
form.append('compiler_version', 'v' + solc.version().replace('.Emscripten.clang', ''));
form.append('contract_name', name);
form.append('license_type', 'mit');
form.append('autodetect_constructor_args', 'true');
form.append('files[0]', new Blob([JSON.stringify(input)], { type: 'application/json' }), 'input.json');
const r = await fetch(`https://base-sepolia.blockscout.com/api/v2/smart-contracts/${addr}/verification/via/standard-input`, { method: 'POST', body: form });
console.log(r.status, await r.text());
for (let i = 0; i < 20; i++) {
  await new Promise((res) => setTimeout(res, 6000));
  const j = await (await fetch(`https://base-sepolia.blockscout.com/api/v2/smart-contracts/${addr}`)).json();
  if (j.is_verified) { console.log('verified on Blockscout:', j.name, j.compiler_version, `https://base-sepolia.blockscout.com/address/${addr}?tab=contract`); process.exit(0); }
}
console.log('not verified yet'); process.exit(1);
