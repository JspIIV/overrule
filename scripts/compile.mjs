// Compiles MetaMask's Delegation Framework v1.3.0 (vendor/delegation-framework, unmodified, Apache-2.0) and Overrule's
// own EVM contracts with exactly the framework's settings: solc 0.8.23, optimizer on, 200 runs, EVM london. The
// compiler is the official soljson build, checked against binaries.soliditylang.org (sha256 9c681b16...).
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import url from 'url';

const require = createRequire(import.meta.url);
export const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
export const solc = require('solc/wrapper')(require(path.join(ROOT, 'tools', 'soljson-v0.8.23.cjs')));
const DF = path.join(ROOT, 'vendor', 'delegation-framework');
export const SETTINGS = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'london' };
const REMAP = [
  ['@account-abstraction/', 'lib/account-abstraction/contracts/'],
  ['@openzeppelin/contracts/', 'lib/openzeppelin-contracts/contracts/'],
  ['@solidity-stringutils/', 'lib/solidity-stringutils/src/'],
  ['@bytes-utils/', 'lib/solidity-bytes-utils/contracts/'],
  ['@FCL/', 'lib/FCL/solidity/src/'],
  ['@erc7579/', 'lib/erc7579-implementation/src/'],
  ['@SCL/', 'lib/SCL/src/'],
  ['FreshCryptoLib/', 'lib/FreshCryptoLib/solidity/src/'],
  ['openzeppelin-contracts/', 'lib/openzeppelin-contracts/'],
  ['@solidity/', 'lib/SCL/src/'],
];
// Where each contract's source lives, as a path the import callback can resolve.
export const SOURCES = {
  DelegationManager: 'df/src/DelegationManager.sol',
  HybridDeleGator: 'df/src/HybridDeleGator.sol',
  EntryPoint: 'df/lib/account-abstraction/contracts/core/EntryPoint.sol',
  ERC1967Proxy: 'df/lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol',
  ERC20TransferAmountEnforcer: 'df/src/enforcers/ERC20TransferAmountEnforcer.sol',
  AllowedTargetsEnforcer: 'df/src/enforcers/AllowedTargetsEnforcer.sol',
  CourtEnforcer: 'evm/CourtEnforcer.sol',
  CourtEnforcerRelayed: 'evm/CourtEnforcerRelayed.sol',
  TestUSD: 'evm/TestUSD.sol',
  SCL_RIP7212: 'df/lib/SCL/src/lib/libSCL_RIP7212.sol',
};

function resolve(p) {
  if (p.startsWith('df/')) return path.join(DF, p.slice(3));
  if (p.startsWith('evm/')) return path.join(ROOT, p);
  if (p.startsWith('vendor/')) return path.join(ROOT, p);
  for (const [from, to] of REMAP) if (p.startsWith(from)) return path.join(DF, to + p.slice(from.length));
  if (p.startsWith('lib/') || p.startsWith('src/')) return path.join(DF, p);
  return path.join(DF, p);
}
export function findImport(p) {
  const f = resolve(p);
  return fs.existsSync(f) ? { contents: fs.readFileSync(f, 'utf8') } : { error: 'not found: ' + p };
}

const cache = {};
export function compile(name) {
  if (cache[name]) return cache[name];
  const file = SOURCES[name];
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { [file]: { content: findImport(file).contents } },
    settings: { ...SETTINGS, outputSelection: { [file]: { [name]: ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'evm.deployedBytecode.linkReferences'] } } },
  }), { import: findImport }));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  const c = out.contracts[file][name];
  cache[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object, deployed: c.evm.deployedBytecode.object.toLowerCase(),
    refs: c.evm.deployedBytecode.immutableReferences || {}, links: c.evm.bytecode.linkReferences || {}, dlinks: c.evm.deployedBytecode.linkReferences || {}, version: solc.version() };
  return cache[name];
}

if (process.argv[1] && process.argv[1].endsWith('compile.mjs')) {
  fs.mkdirSync(path.join(ROOT, 'evm', 'abi'), { recursive: true });
  for (const n of (process.argv[2] ? process.argv.slice(2) : Object.keys(SOURCES))) {
    const c = compile(n);
    fs.writeFileSync(path.join(ROOT, 'evm', 'abi', n + '.json'), JSON.stringify(c.abi, null, 2));
    console.log(n.padEnd(28), (c.bytecode.length - 2) / 2, 'bytes', c.version);
  }
}
