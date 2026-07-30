// Detects well-known privileged/administrative function selectors by searching for their
// 4-byte signature inside deployed runtime bytecode. This is a real, reproducible check
// (the selectors below are public keccak256("<signature>") values), but it is a *heuristic*:
// substring-matching raw bytecode can miss logic hidden behind a proxy (see upgradeability
// dimension) and can rarely false-positive on unrelated bytes. Every finding this produces
// is labeled with that limitation - never presented as a confirmed audit result.

const KNOWN_SELECTORS = [
  { selector: '8456cb59', signature: 'pause()', note: 'Operator can pause contract functionality.' },
  { selector: '3f4ba83a', signature: 'unpause()', note: 'Operator can resume contract functionality.' },
  { selector: '40c10f19', signature: 'mint(address,uint256)', note: 'Operator can mint new tokens.' },
  { selector: 'f2fde38b', signature: 'transferOwnership(address)', note: 'Ownership/control can be transferred by the current owner.' },
  { selector: '715018a6', signature: 'renounceOwnership()', note: 'Owner can renounce control permanently.' },
  { selector: 'f9f92be4', signature: 'blacklist(address)', note: 'Operator can block specific addresses from interacting with the contract.' },
  { selector: '0ecb93c0', signature: 'addBlackList(address)', note: 'Operator can block specific addresses (USDT-style deny-list).' },
  { selector: 'e47d6060', signature: 'setTaxFee(uint256)', note: 'Operator can change a transaction tax/fee parameter.' },
  { selector: '8da5cb5b', signature: 'owner()', note: 'Contract exposes a standard owner-lookup function (Ownable pattern).' },
];

function scanBytecodeForSelectors(bytecodeHex) {
  if (!bytecodeHex || bytecodeHex === '0x') return [];
  const hex = bytecodeHex.slice(2).toLowerCase();
  const found = [];
  for (const entry of KNOWN_SELECTORS) {
    if (hex.includes(entry.selector.toLowerCase())) {
      found.push(entry);
    }
  }
  return found;
}

// Keyword scan over verified source code text (only ever run when a block explorer
// actually returned verified source - see verification.js). Flags common transfer/trading
// restriction patterns by name. Also a heuristic, not a parser - documented as such.
const RESTRICTION_KEYWORDS = [
  'maxtransactionamount', 'maxtxamount', 'maxwallet', 'antiwhale', 'tradingenabled',
  'cooldown', 'blacklist', 'isexcludedfromfee', 'snipe',
];

function scanSourceForRestrictions(sourceText) {
  if (!sourceText) return [];
  const lower = sourceText.toLowerCase();
  return RESTRICTION_KEYWORDS.filter((kw) => lower.includes(kw));
}

module.exports = { KNOWN_SELECTORS, scanBytecodeForSelectors, scanSourceForRestrictions };
