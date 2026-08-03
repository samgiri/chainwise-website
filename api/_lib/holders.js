// Optional top-holder / supply-concentration lookup via the Etherscan V2 multichain API.
//
// `tokensupply` (module=stats) works on a standard/free Etherscan API key. `tokenholderlist`
// (module=token) is an Etherscan Pro-tier feature - a free-tier key gets a non-"1" status
// back for it, not an error. Both failure paths (no key, free-tier rejection, timeout,
// malformed response) are treated identically here: return null and let the caller report
// the Ownership dimension as insufficient data. It must never be assumed "concentrated" or
// "well distributed" without actually having real holder data to check.

const { rpcCall } = require('./rpc');

const REQUEST_TIMEOUT_MS = 6000;
const TOP_HOLDERS_TO_FETCH = 10;

// Zero address and the common "burn" vanity address. A burn address or a locked-liquidity
// contract holding a large share of supply is not the same risk as an EOA holding the same
// share, so these are excluded before picking a "top holder" to score against.
const BURN_ADDRESSES = new Set([
  `0x${'0'.repeat(40)}`,
  `0x${'0'.repeat(36)}dead`,
]);

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTokenSupply(chainConfig, address) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey || !chainConfig.explorerApiChainId) return null;

  const url = `https://api.etherscan.io/v2/api?chainid=${chainConfig.explorerApiChainId}`
    + `&module=stats&action=tokensupply&contractaddress=${address}&apikey=${apiKey}`;

  try {
    const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== '1' || !data.result) return null;
    const supply = BigInt(data.result);
    return supply > 0n ? supply : null;
  } catch (err) {
    return null;
  }
}

async function fetchTopHolders(chainConfig, address) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey || !chainConfig.explorerApiChainId) return null;

  const url = `https://api.etherscan.io/v2/api?chainid=${chainConfig.explorerApiChainId}`
    + `&module=token&action=tokenholderlist&contractaddress=${address}`
    + `&page=1&offset=${TOP_HOLDERS_TO_FETCH}&apikey=${apiKey}`;

  try {
    const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    // A free-tier key gets status "0" / message "NOTOK" for this Pro-only endpoint - that is
    // an expected, honest "we don't have this data" outcome, not a bug to work around.
    if (data.status !== '1' || !Array.isArray(data.result)) return null;
    const holders = data.result
      .map((h) => ({
        address: String(h.TokenHolderAddress || '').toLowerCase(),
        quantity: h.TokenHolderQuantity,
      }))
      .filter((h) => h.address && h.quantity != null);
    return holders.length ? holders : null;
  } catch (err) {
    return null;
  }
}

// Combines supply + top-holder list into what the risk engine needs, including a real
// on-chain check of whether the top non-burn holder is itself a contract (e.g. a DEX pool,
// staking, or vesting contract) rather than a wallet - see BURN_ADDRESSES comment above for
// why that distinction matters for scoring.
async function fetchOwnershipData(chainConfig, address) {
  const [totalSupply, topHolders] = await Promise.all([
    fetchTokenSupply(chainConfig, address),
    fetchTopHolders(chainConfig, address),
  ]);
  if (!totalSupply || !topHolders) return null;

  const nonBurnHolders = topHolders.filter((h) => !BURN_ADDRESSES.has(h.address));
  if (!nonBurnHolders.length) {
    return { totalSupply, topHolders, topHolder: null, topHolderIsContract: null };
  }

  const topHolder = nonBurnHolders[0];
  let topHolderIsContract = null;
  try {
    const code = await rpcCall(chainConfig.rpcs, 'eth_getCode', [topHolder.address, 'latest']);
    topHolderIsContract = Boolean(code) && code !== '0x';
  } catch (err) {
    topHolderIsContract = null; // unknown - the risk engine must not assume "wallet" here
  }

  return { totalSupply, topHolders, topHolder, topHolderIsContract };
}

module.exports = { fetchTokenSupply, fetchTopHolders, fetchOwnershipData, BURN_ADDRESSES };
