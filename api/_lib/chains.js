// Supported-network configuration for the risk-analysis engine.
//
// `status` is an honest operational flag, not a marketing label:
//   'live'         - fully operational in production today
//   'beta'         - operational but the whole engine is still in Beta
//   'coming_soon'  - listed on the roadmap, not wired up yet (must be disabled client-side)
//   'unavailable'  - temporarily down (e.g. all RPC endpoints failing)
//
// Every chain below has working free public RPC endpoints wired in `rpcs`, so all are
// marked 'beta' (operational, but part of an overall Beta product) rather than fabricating
// a 'coming_soon'/'unavailable' state that doesn't reflect reality. If a chain's RPCs start
// failing in production, flip its status to 'unavailable' here - the frontend disables
// non-operational chains automatically, it never assumes.
const CHAIN_CONFIG = {
  ethereum: {
    chainId: 1,
    label: 'Ethereum',
    symbol: 'ETH',
    status: 'beta',
    rpcs: ['https://eth.llamarpc.com', 'https://ethereum-rpc.publicnode.com'],
    explorer: 'https://etherscan.io',
    explorerApiChainId: 1,
  },
  polygon: {
    chainId: 137,
    label: 'Polygon',
    symbol: 'MATIC',
    status: 'beta',
    rpcs: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com'],
    explorer: 'https://polygonscan.com',
    explorerApiChainId: 137,
  },
  arbitrum: {
    chainId: 42161,
    label: 'Arbitrum',
    symbol: 'ETH',
    status: 'beta',
    rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
    explorer: 'https://arbiscan.io',
    explorerApiChainId: 42161,
  },
  optimism: {
    chainId: 10,
    label: 'Optimism',
    symbol: 'ETH',
    status: 'beta',
    rpcs: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
    explorer: 'https://optimistic.etherscan.io',
    explorerApiChainId: 10,
  },
  base: {
    chainId: 8453,
    label: 'Base',
    symbol: 'ETH',
    status: 'beta',
    rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    explorer: 'https://basescan.org',
    explorerApiChainId: 8453,
  },
  zksync: {
    chainId: 324,
    label: 'zkSync Era',
    symbol: 'ETH',
    status: 'beta',
    rpcs: ['https://mainnet.era.zksync.io', 'https://zksync-era-rpc.publicnode.com'],
    explorer: 'https://explorer.zksync.io',
    // zkSync Era's block explorer does not run on the Etherscan V2 multichain API;
    // source-verification lookups are skipped for this chain (see verification.js).
    explorerApiChainId: null,
  },
  bsc: {
    chainId: 56,
    label: 'BNB Chain',
    symbol: 'BNB',
    status: 'beta',
    rpcs: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'],
    explorer: 'https://bscscan.com',
    explorerApiChainId: 56,
  },
  avalanche: {
    chainId: 43114,
    label: 'Avalanche',
    symbol: 'AVAX',
    status: 'beta',
    rpcs: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'],
    explorer: 'https://snowtrace.io',
    explorerApiChainId: 43114,
  },
};

module.exports = { CHAIN_CONFIG };
