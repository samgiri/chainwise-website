// Shared case study data. Underscore-prefixed directory so Vercel doesn't
// treat this as its own route - it's imported by api/cases.js (for the case
// list).
//
// ILLUSTRATIVE_CASES below are clearly-labeled hypothetical/composite examples used to show
// what the real 6-scored + 2-roadmap dimension framework (riskEngine.js's computeDimensions()/
// computeRoadmapDimensions()) looks like across different risk patterns. They carry
// isIllustrative: true and must never be presented as real findings.
//
// A "Smart Solve DeFi" entry previously lived here, presented on the
// homepage/research pages as a real investigated case ("Real, on-chain
// forensic breakdowns... a live case with a $100M+ estimated loss"). It had
// no evidence links of any kind (no tx hashes, wallet/contract addresses, or
// explorer links) and traced back to a fixed demo dataset that had briefly
// been wired into the live /api/analyze engine as a fake result for
// free-text "smart solve" queries (see test/honesty.test.js). It has been
// removed rather than relabeled - do not re-add it without real, cited
// on-chain evidence.
//
// INVESTIGATED_CASES below is the first (and so far only) real, sourced case
// study. Two things are kept strictly separate for it, and must stay that
// way for any future entry of this kind:
//   1. `narrative` / `sources` - real-world reporting on an event (a token
//      collapse, an exploit, etc.), hedged and multi-sourced, with the
//      subject's own response included per our right-of-reply standard.
//   2. `engineAnalysis` - the *actual, captured* output of a real
//      /api/analyze run against a specific contract, verbatim. This is a
//      point-in-time snapshot, not a live re-analysis, and it is a technical
//      read of one contract's on-chain properties - it is never a verdict on
//      the narrative event. Never let scores/dimensions here be hand-written
//      or estimated; only ever paste in a real captured engine response.

const INVESTIGATED_CASES = [
  {
    slug: 'mantra-om-2025-collapse',
    protocol: 'MANTRA (OM)',
    isIllustrative: false,
    isInvestigated: true,
    detailPage: '/case-mantra-om',
    statusBadge: 'DISPUTED',
    chain: 'Base',
    contractAddress: '0x3992b27da26848c2b19cea6fd25ad5568b68ab98',
    riskScore: 23,
    // Worst-dimension-driven tier (adminControls scored 40), not the mean of 23 - see
    // engineAnalysis.worstDimensionScore and dashboard.js's tierFromScore for why.
    riskLevel: 'MEDIUM',
    summary: 'OM dropped over 90% on April 13, 2025, erasing an estimated $5.5B in market cap. MANTRA disputes rug-pull characterizations, attributing it to forced exchange liquidations. The on-chain score below is for the current Base OM token contract only - not a verdict on the crash.',
    sources: [
      { label: "Cointelegraph — How Mantra's OM token collapsed in 24 hours of chaos", url: 'https://cointelegraph.com/news/mantra-om-token-collapsed-24-hours' },
      { label: "The Block — MANTRA's token falls 90% in sudden crash; team blames 'reckless liquidations'", url: 'https://www.theblock.co/post/350665/layer-1-mantras-token-falls-90-in-sudden-crash-community-lead-denies-rug-pull-accusations' },
      { label: 'CoinMarketCap — Mantra Token Plunges 90% After $227 Million Moved to Exchanges', url: 'https://coinmarketcap.com/academy/article/mantra-token-plunges-90percent-after-dollar227-million-moved-to-exchanges-sparking-liquidity-and-insider-dumping-concerns' },
    ],
    narrative: [
      'On April 13, 2025, MANTRA\'s OM token dropped from roughly $6.30 to below $0.50 within about an hour, erasing an estimated $5.5 billion in market capitalization - one of the largest single-day collapses in DeFi to date.',
      'In the days before the crash, on-chain data showed 17 wallets moving a combined ~43.6 million OM (about $227M, roughly 4.5% of circulating supply) to the Binance and OKX exchanges. Blockchain analytics firm Arkham Intelligence tagged two of those wallets as belonging to MANTRA investor Laser Digital, which publicly denied the wallets were theirs. The crash triggered an estimated $71M+ in liquidations within 24 hours.',
      'MANTRA co-founder John Patrick Mullin publicly denied any rug pull, stating the crash was "triggered by reckless forced closures initiated by centralized exchanges on OM account holders" and that team tokens "remain locked and subject to the published vesting periods." A MANTRA community lead separately denied the crash resulted from team selling.',
      'As of this writing, no regulator or independent forensic audit has issued a definitive finding on what caused the crash. This case is documented here as a disputed event, not a settled fraud finding - see the sources above and MANTRA\'s own statements for the full record.',
    ],
    engineAnalysis: {
      // Captured verbatim from a real /api/analyze run - see the header comment above.
      // Re-captured 2026-08-06 against engine 2.1.0 (previous capture was 2026-08-01 against
      // 2.0.0-beta.1, predating PR #28's Ownership implementation and the 8->6 split).
      analyzedAt: '2026-08-06T10:22:32.384Z',
      engineVersion: '2.1.0',
      resultStatus: 'partial',
      assessmentStatus: 'Partial',
      overallScore: 23,
      worstDimensionScore: 40,
      confidence: 44,
      verifiedName: 'OptimismMintableERC20',
      explorerUrl: 'https://basescan.org/address/0x3992b27da26848c2b19cea6fd25ad5568b68ab98',
      note: 'This is the current Base-chain OM token contract (bridged via Superbridge from Ethereum), not the original protocol deployment. This score reflects only this specific contract\'s on-chain risk properties (admin controls, upgradeability, etc.) as assessed by ChainWise Beta - it is not a forensic finding about the April 2025 crash.',
      topFlags: [
        'The contract gives its admin 1 privileged function (mint) that can directly affect user funds by allowing new tokens to be created.',
      ],
      dimensions: [
        { key: 'verification', name: 'Contract Verification & Transparency', state: 'assessed', level: 'no_material_indicator', levelLabel: 'No material indicator detected', subscore: 10, confidence: 90, findings: [{ summary: 'Source code is verified on https://basescan.org as "OptimismMintableERC20".' }], dataSource: 'https://basescan.org', lastChecked: '2026-08-06T10:22:32.383Z', explanation: 'Publicly verified source code lets anyone read exactly what the contract does, which supports transparency.', limitations: ['Verification status reflects only whether source was published to the explorer, not whether that source was independently audited.'] },
        { key: 'adminControls', name: 'Privileged Access & Admin Controls', state: 'assessed', level: 'review_recommended', levelLabel: 'Review recommended', subscore: 40, confidence: 55, findings: [{ summary: 'Detected function selector 0x40c10f19 (mint(address,uint256)). Operator can mint new tokens.' }], dataSource: 'Base RPC (eth_getCode)', lastChecked: '2026-08-06T10:22:32.383Z', explanation: 'Found 1 commonly privileged function selector(s) in the bytecode. Many legitimate contracts use these too - presence alone is not proof of misuse.', limitations: ['This is a raw bytecode substring scan, not a decompiler - it can miss logic hidden behind a proxy (see Upgradeability) and cannot confirm how/when these functions are actually restricted or used.'] },
        { key: 'upgradeability', name: 'Upgradeability & Proxy Risk', state: 'assessed', level: 'no_material_indicator', levelLabel: 'No material indicator detected', subscore: 20, confidence: 75, findings: [{ summary: 'The EIP-1967 implementation storage slot is empty; no standard upgradeable-proxy pattern was detected.' }], dataSource: 'Base RPC (eth_getStorageAt, EIP-1967 slots)', lastChecked: '2026-08-06T10:22:32.383Z', explanation: 'No standard proxy pattern was detected, suggesting contract logic cannot be swapped after deployment via the most common upgrade mechanism.', limitations: ['Only the standard EIP-1967 slot pattern is checked; non-standard or custom proxy implementations would not be detected by this check.'] },
        { key: 'tokenRestrictions', name: 'Token & Transaction Restrictions', state: 'assessed', level: 'no_material_indicator', levelLabel: 'No material indicator detected', subscore: 20, confidence: 45, findings: [], dataSource: 'https://basescan.org (verified source keyword scan)', lastChecked: '2026-08-06T10:22:32.384Z', explanation: 'No common transfer-restriction keywords (max transaction, blacklist, cooldown, anti-whale) were found in verified source.', limitations: ['Keyword matching on source text, not a control-flow analysis - it cannot confirm whether a restriction is currently active or how it is gated.'] },
        { key: 'ownership', name: 'Ownership & Wallet Concentration', state: 'insufficient_data', level: null, levelLabel: 'Insufficient data', subscore: null, confidence: null, findings: [], dataSource: 'https://basescan.org (token holder list)', lastChecked: '2026-08-06T10:22:32.384Z', explanation: 'This risk dimension is not available yet in ChainWise Beta - it depends on a third-party data source that is not connected to the engine (see the limitation below). This is a roadmap gap, not an error, and it is not specific to this contract.', limitations: ["Top-holder distribution requires the block explorer's token-holder-list API, which is an Etherscan Pro-tier feature - a standard ETHERSCAN_API_KEY cannot retrieve it. This environment either has no key configured, the token has no ERC-20 supply/holder data, or the request failed or was rate-limited."] },
        { key: 'governance', name: 'Governance & Operational Controls', state: 'insufficient_data', level: null, levelLabel: 'Insufficient data', subscore: null, confidence: null, findings: [], dataSource: 'Base RPC (eth_call owner())', lastChecked: '2026-08-06T10:22:32.384Z', explanation: 'We could not gather enough information to assess this dimension. This does not mean the contract is safe on this dimension - it means we do not know.', limitations: ['This contract does not expose a standard owner() function (or the call reverted), so single-key-vs-multisig control could not be determined this way.'] },
      ],
      // The 2 permanent stubs (no data provider integrated for any contract) - kept out of
      // `dimensions` so they never look like a scored result for this contract. This part of
      // the snapshot isn't contract-specific and doesn't go stale when the contract is
      // re-analyzed, but is captured verbatim here too rather than hand-written.
      roadmapDimensions: [
        { key: 'liquidity', name: 'Liquidity & Market Structure', state: 'insufficient_data', level: null, levelLabel: 'Insufficient data', subscore: null, confidence: null, findings: [], dataSource: 'Not yet integrated', lastChecked: '2026-08-06T10:22:32.384Z', explanation: 'This risk dimension is not available yet in ChainWise Beta - it depends on a third-party data source that is not connected to the engine (see the limitation below). This is a roadmap gap, not an error, and it is not specific to this contract.', limitations: ['Liquidity depth, lock status, and market-structure analysis require a DEX/liquidity data provider that is not yet integrated into this engine. (A free, RPC-only path exists for standard Uniswap-V2-style pairs - reading factory/pair reserves directly on-chain - but it has not shipped yet because it needs to be verified against live pairs before release.)'] },
        { key: 'exploitSignals', name: 'Exploit, Anomaly & External Signals', state: 'insufficient_data', level: null, levelLabel: 'Insufficient data', subscore: null, confidence: null, findings: [], dataSource: 'Not yet integrated', lastChecked: '2026-08-06T10:22:32.384Z', explanation: 'This risk dimension is not available yet in ChainWise Beta - it depends on a third-party data source that is not connected to the engine (see the limitation below). This is a roadmap gap, not an error, and it is not specific to this contract.', limitations: ['Known-exploit and anomaly-feed correlation requires a threat-intelligence data source that is not yet integrated into this engine.'] },
      ],
    },
  },
];

const ILLUSTRATIVE_CASES = [
  {
    slug: 'illustrative-yieldbridge',
    protocol: 'YieldBridge Rewards',
    isIllustrative: true,
    illustrativeNote: 'Hypothetical, composite example built for educational purposes. It does not describe a real protocol or company, and any resemblance to an actual project is coincidental.',
    chain: 'Polygon',
    riskScore: 82,
    riskLevel: 'HIGH',
    summary: 'Illustrative example: a cross-chain "yield" protocol whose bridge contracts hold disproportionate, poorly-audited control over user funds.',
    confidence: 90,
    estimatedLoss: '$8M (hypothetical)',
    usersAtRisk: 4200,
    collapseTimelineDays: [60, 150],
    operatorControlPct: 45,
    detectionHours: 36,
    // Illustrative scores against the same 6 real dimensions the engine scores (see
    // riskEngine.js's computeDimensions()) - not the old, unrelated 8-layer scheme
    // (patterns/bytecode/treasury/withdrawals/bridges/offRamps/sybil/attribution) this used
    // to carry, which never matched any real product surface.
    dimensionScores: { verification: 65, adminControls: 88, upgradeability: 82, tokenRestrictions: 30, ownership: 40, governance: 78 },
    alerts: [
      { level: 'CRITICAL', message: '(Illustrative) Bridge contract owner key can redirect locked collateral' },
      { level: 'HIGH', message: '(Illustrative) Unverified proxy implementation swapped 48h post-launch' },
      { level: 'MEDIUM', message: '(Illustrative) Off-ramp concentration to two exchange clusters' },
    ],
    timeline: [
      { date: 'Month 1', title: 'Deployment', description: 'Bridge and vault contracts deployed across two chains; marketing emphasizes "audited" status without a public report.' },
      { date: 'Month 2', title: 'Red flags emerge', description: 'Community researchers flag an upgradeable proxy behind the bridge with a single-signer admin key.' },
      { date: 'Month 3', title: 'Outcome (hypothetical)', description: 'Model projects a 60-150 day window in which the admin key could redirect bridged collateral before users react.' },
    ],
    walletFlow: [
      { step: 1, from: 'User collateral (chain A)', to: 'Bridge lock contract', description: 'Users lock collateral on the source chain to mint a wrapped yield token.' },
      { step: 2, from: 'Bridge lock contract', to: 'Admin-key-controlled wallet', description: 'A single admin key retains the ability to move locked collateral without a timelock or multisig.' },
      { step: 3, from: 'Admin-controlled wallet', to: 'Exchange deposit addresses', description: 'In this hypothetical scenario, redirected funds trend toward exchange deposit clusters within days.' },
    ],
  },
  {
    slug: 'illustrative-lotusstake',
    protocol: 'LotusStake Finance',
    isIllustrative: true,
    illustrativeNote: 'Hypothetical, composite example built for educational purposes. It does not describe a real protocol or company, and any resemblance to an actual project is coincidental.',
    chain: 'BSC',
    riskScore: 92,
    riskLevel: 'CRITICAL',
    summary: 'Illustrative example: a Southeast Asia-marketed staking club built almost entirely on multi-level referral commissions rather than underlying yield.',
    confidence: 92,
    estimatedLoss: '$22M (hypothetical)',
    usersAtRisk: 9000,
    collapseTimelineDays: [90, 240],
    operatorControlPct: 55,
    detectionHours: 18,
    dimensionScores: { verification: 50, adminControls: 55, upgradeability: 40, tokenRestrictions: 60, ownership: 90, governance: 65 },
    alerts: [
      { level: 'CRITICAL', message: '(Illustrative) 200+ wallets funded from 6 source addresses within 48 hours' },
      { level: 'HIGH', message: '(Illustrative) Advertised APY unsupported by on-chain protocol revenue' },
      { level: 'MEDIUM', message: '(Illustrative) Referral payouts exceed staking payouts 3:1' },
    ],
    timeline: [
      { date: 'Month 1', title: 'Deployment', description: 'Staking contract launches with a public leaderboard rewarding referral chains over staking returns.' },
      { date: 'Month 2', title: 'Red flags emerge', description: 'Sybil-clustering analysis finds hundreds of "independent" stakers funded by a handful of wallets, consistent with coordinated seeding rather than organic growth.' },
      { date: 'Month 4', title: 'Outcome (hypothetical)', description: 'Model projects payouts becoming unsustainable once new-referral inflow slows, within roughly 90-240 days of launch.' },
    ],
    walletFlow: [
      { step: 1, from: 'New participant deposits', to: 'Shared reward pool', description: 'Deposits from new participants feed a shared pool used to pay existing members\' staking and referral rewards.' },
      { step: 2, from: 'Shared reward pool', to: 'Upline referral wallets', description: 'A large share of each new deposit routes directly to upline referrers rather than into yield-generating positions.' },
      { step: 3, from: 'Reward pool', to: 'Operator treasury', description: 'A fixed cut of every deposit is swept to an operator-controlled treasury address before any yield activity occurs.' },
    ],
  },
  {
    slug: 'illustrative-rupeeyield',
    protocol: 'RupeeYield Chain',
    isIllustrative: true,
    illustrativeNote: 'Hypothetical, composite example built for educational purposes. It does not describe a real protocol or company, and any resemblance to an actual project is coincidental.',
    chain: 'Ethereum',
    riskScore: 74,
    riskLevel: 'HIGH',
    summary: 'Illustrative example: an India-marketed "fixed return" DeFi app run by an anonymous team with a history of abandoned prior projects.',
    confidence: 85,
    estimatedLoss: '$5M (hypothetical)',
    usersAtRisk: 2600,
    collapseTimelineDays: [120, 300],
    operatorControlPct: 38,
    detectionHours: 48,
    dimensionScores: { verification: 55, adminControls: 80, upgradeability: 35, tokenRestrictions: 45, ownership: 40, governance: 85 },
    alerts: [
      { level: 'HIGH', message: '(Illustrative) Team wallets linked to two prior abandoned "yield" projects' },
      { level: 'MEDIUM', message: '(Illustrative) No public team identity despite "fixed return" guarantees' },
      { level: 'MEDIUM', message: '(Illustrative) Contract owner retains unrestricted mint function' },
    ],
    timeline: [
      { date: 'Month 1', title: 'Deployment', description: 'Contract launches promising a fixed monthly return, marketed heavily through regional social channels.' },
      { date: 'Month 3', title: 'Red flags emerge', description: 'On-chain attribution links the deployer wallet to two previously abandoned projects with similar structure.' },
      { date: 'Month 5', title: 'Outcome (hypothetical)', description: 'Model projects elevated collapse risk in a 120-300 day window given the team\'s track record and unrestricted mint access.' },
    ],
    walletFlow: [
      { step: 1, from: 'User deposits', to: 'Protocol treasury contract', description: 'Deposits accumulate in a treasury contract that also holds an unrestricted owner-only mint function.' },
      { step: 2, from: 'Protocol treasury', to: 'Deployer-linked wallets', description: 'A recurring portion of the treasury balance is transferred to wallets previously attributed to the same deployer identity.' },
      { step: 3, from: 'Deployer-linked wallets', to: 'Mixer / privacy pool (hypothetical)', description: 'In this hypothetical scenario, funds pass through a privacy pool before any further movement can be attributed.' },
    ],
  },
];

const CASE_STUDIES = [...INVESTIGATED_CASES, ...ILLUSTRATIVE_CASES];

module.exports = { INVESTIGATED_CASES, ILLUSTRATIVE_CASES, CASE_STUDIES };
