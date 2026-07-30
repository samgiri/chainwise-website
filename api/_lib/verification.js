// Optional block-explorer source-verification lookup via the Etherscan V2 multichain API
// (one API key covers Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, and Avalanche -
// zkSync Era is not on this API and is skipped). Entirely optional: if ETHERSCAN_API_KEY is
// not configured, this returns null and the caller must report the Contract Verification
// dimension as insufficient data - it must never be assumed "verified" or "unverified"
// without actually checking.

const REQUEST_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchVerification(chainConfig, address) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey || !chainConfig.explorerApiChainId) return null;

  const url = `https://api.etherscan.io/v2/api?chainid=${chainConfig.explorerApiChainId}`
    + `&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;

  try {
    const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    const entry = Array.isArray(data.result) ? data.result[0] : null;
    if (!entry) return null;

    const isVerified = Boolean(entry.SourceCode && entry.SourceCode.length > 0);
    return {
      isVerified,
      contractName: entry.ContractName || null,
      compilerVersion: entry.CompilerVersion || null,
      sourceCode: isVerified ? entry.SourceCode : null,
      proxyFlag: entry.Proxy === '1',
    };
  } catch (err) {
    return null;
  }
}

module.exports = { fetchVerification };
