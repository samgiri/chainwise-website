// Minimal JSON-RPC client for free, no-API-key-required public EVM endpoints.
// Every value returned here is a real, live fact fetched at request time - nothing in
// this file invents or estimates data.

const RPC_TIMEOUT_MS = 8000;

// EIP-1967 standard storage slots (keccak256("eip1967.proxy.implementation") - 1 and
// keccak256("eip1967.proxy.admin") - 1). These are fixed, public constants - checking them
// is a real, reproducible way to detect the most common upgradeable-proxy pattern.
const EIP1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bb';
const EIP1967_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6d4';

// owner() - standard OpenZeppelin Ownable getter, 4-byte selector.
const OWNER_SELECTOR = '0x8da5cb5b';

class RpcError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RpcError';
    this.cause = cause;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function rpcCall(rpcUrls, method, params) {
  let lastError;
  for (const url of rpcUrls) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }, RPC_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'RPC returned an error');
      return data.result;
    } catch (err) {
      lastError = err;
    }
  }
  throw new RpcError(
    `${method} failed on all RPC endpoints for this chain (${lastError ? lastError.message : 'unknown error'})`,
    lastError,
  );
}

function isZeroSlot(hexWord) {
  if (!hexWord) return true;
  return /^0x0*$/.test(hexWord);
}

function addressFromSlot(hexWord) {
  if (!hexWord || hexWord.length < 42) return null;
  return `0x${hexWord.slice(-40)}`;
}

// Fetches everything the risk engine needs about an address in parallel: whether it's a
// deployed contract, its bytecode (for selector scanning), native balance, tx count,
// EIP-1967 proxy slots, and the current block number (for evidence provenance).
async function fetchOnChainData(chainConfig, address) {
  const [code, balanceHex, txCountHex, blockNumberHex, implSlot, adminSlot] = await Promise.all([
    rpcCall(chainConfig.rpcs, 'eth_getCode', [address, 'latest']),
    rpcCall(chainConfig.rpcs, 'eth_getBalance', [address, 'latest']),
    rpcCall(chainConfig.rpcs, 'eth_getTransactionCount', [address, 'latest']),
    rpcCall(chainConfig.rpcs, 'eth_blockNumber', []),
    rpcCall(chainConfig.rpcs, 'eth_getStorageAt', [address, EIP1967_IMPLEMENTATION_SLOT, 'latest']),
    rpcCall(chainConfig.rpcs, 'eth_getStorageAt', [address, EIP1967_ADMIN_SLOT, 'latest']),
  ]);

  const isContract = Boolean(code) && code !== '0x';
  const codeSizeBytes = isContract ? Math.max(0, (code.length - 2) / 2) : 0;
  const balanceWei = BigInt(balanceHex || '0x0');
  const balanceNative = Number(balanceWei) / 1e18;
  const txCount = parseInt(txCountHex || '0x0', 16);
  const blockNumber = parseInt(blockNumberHex || '0x0', 16);

  const proxyImplementation = isZeroSlot(implSlot) ? null : addressFromSlot(implSlot);
  const proxyAdmin = isZeroSlot(adminSlot) ? null : addressFromSlot(adminSlot);

  let ownerAddress = null;
  let ownerIsContract = null;
  if (isContract) {
    try {
      const ownerResult = await rpcCall(chainConfig.rpcs, 'eth_call', [{ to: address, data: OWNER_SELECTOR }, 'latest']);
      if (ownerResult && ownerResult !== '0x' && !isZeroSlot(ownerResult)) {
        ownerAddress = addressFromSlot(ownerResult);
        const ownerCode = await rpcCall(chainConfig.rpcs, 'eth_getCode', [ownerAddress, 'latest']);
        ownerIsContract = Boolean(ownerCode) && ownerCode !== '0x';
      }
    } catch (err) {
      // owner() not implemented or call reverted - not every contract exposes it, this is
      // expected and handled as "insufficient data" by the risk engine, not an error.
      ownerAddress = null;
      ownerIsContract = null;
    }
  }

  return {
    chainKey: chainConfig.key,
    chainLabel: chainConfig.label,
    nativeSymbol: chainConfig.symbol,
    isContract,
    codeSizeBytes,
    bytecode: code,
    balanceNative,
    txCount,
    blockNumber,
    proxyImplementation,
    proxyAdmin,
    ownerAddress,
    ownerIsContract,
  };
}

module.exports = { fetchOnChainData, rpcCall, RpcError };
