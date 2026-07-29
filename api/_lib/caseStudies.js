// Shared case study data. Underscore-prefixed directory so Vercel doesn't
// treat this as its own route - it's imported by api/analyze.js (for the
// live single-case demo lookup) and api/cases.js (for the case list).
//
// SMART_SOLVE_CASE is a real, published case study. The ILLUSTRATIVE_CASES
// below it are clearly-labeled hypothetical/composite examples used to show
// what the 8-layer framework looks like across different risk patterns while
// we build out verified research on additional protocols - they carry
// isIllustrative: true and must never be presented as real findings.

const SMART_SOLVE_CASE = {
  slug: 'smart-solve-defi',
  protocol: 'Smart Solve DeFi',
  chain: 'BSC',
  riskScore: 95,
  riskLevel: 'CRITICAL',
  summary: 'Smart Solve DeFi exhibits parameters consistent with MLM pyramid scheme.',
  confidence: 98,
  estimatedLoss: '$100M+',
  usersAtRisk: 15000,
  collapseTimelineDays: [180, 365],
  operatorControlPct: 60,
  detectionHours: 24,
  layers: {
    patterns: 85,
    bytecode: 55,
    treasury: 30,
    withdrawals: 50,
    bridges: 20,
    offRamps: 25,
    sybil: 40,
    attribution: 35,
  },
  alerts: [
    { level: 'CRITICAL', message: 'Withdrawal queue exceeds threshold (127 pending)' },
    { level: 'HIGH', message: 'Treasury drain detected - $21K/day outflow' },
    { level: 'HIGH', message: 'Operator pause() function ready' },
    { level: 'MEDIUM', message: 'Sybil cluster detected (89 wallets)' },
  ],
  timeline: [
    { date: '2023-11', title: 'Deployment', description: 'Contract deployed on BSC and marketed as a "smart farming" yield aggregator with tiered referral rewards.' },
    { date: '2023-12', title: 'Rapid, referral-driven growth', description: 'Aggressive multi-level referral bonuses drive fast signups; wallet-clustering shows coordinated funding of many new accounts from a small set of sources.' },
    { date: '2024-02', title: 'Red flags emerge', description: 'Treasury outflows accelerate to roughly $21K/day and withdrawal processing begins to slow.' },
    { date: '2024-03', title: 'Withdrawal queue crisis', description: 'Pending withdrawal queue exceeds 127 addresses; an operator-controlled pause() function is armed but not yet triggered.' },
    { date: '2024-04', title: 'Projected outcome', description: 'Model projects an operator-controlled collapse within 180-365 days of deployment absent intervention; users are advised to withdraw where still possible.' },
  ],
  walletFlow: [
    { step: 1, from: 'User deposit wallets', to: 'Central treasury address', description: 'Incoming user funds are swept into a small number of centrally-controlled treasury addresses shortly after each deposit.' },
    { step: 2, from: 'Treasury address', to: 'Operator-attributed wallets', description: 'About 60% of inflows are forwarded on to wallets attributed to the operating team rather than retained to cover user withdrawals.' },
    { step: 3, from: 'Operator-attributed wallets', to: 'Exchange deposit addresses', description: 'Funds progressively move toward known centralized-exchange deposit clusters, consistent with converting to fiat off-chain.' },
    { step: 4, from: 'Remaining treasury balance', to: 'User withdrawal queue', description: 'A shrinking balance is left to service a growing withdrawal queue - the liquidity crunch that first surfaced this case.' },
  ],
};

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
    layers: { patterns: 60, bytecode: 65, treasury: 40, withdrawals: 35, bridges: 88, offRamps: 55, sybil: 25, attribution: 50 },
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
    riskScore: 88,
    riskLevel: 'CRITICAL',
    summary: 'Illustrative example: a Southeast Asia-marketed staking club built almost entirely on multi-level referral commissions rather than underlying yield.',
    confidence: 92,
    estimatedLoss: '$22M (hypothetical)',
    usersAtRisk: 9000,
    collapseTimelineDays: [90, 240],
    operatorControlPct: 55,
    detectionHours: 18,
    layers: { patterns: 80, bytecode: 45, treasury: 50, withdrawals: 60, bridges: 15, offRamps: 40, sybil: 85, attribution: 45 },
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
    layers: { patterns: 55, bytecode: 40, treasury: 35, withdrawals: 30, bridges: 20, offRamps: 45, sybil: 30, attribution: 78 },
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

const CASE_STUDIES = [SMART_SOLVE_CASE, ...ILLUSTRATIVE_CASES];

module.exports = { SMART_SOLVE_CASE, ILLUSTRATIVE_CASES, CASE_STUDIES };
