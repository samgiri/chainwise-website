// Shared case study data. Underscore-prefixed directory so Vercel doesn't
// treat this as its own route - it's imported by api/analyze.js (for the
// live single-case demo lookup) and api/cases.js (for the case list).
//
// Only add entries here when there is a real, published case study behind
// them. Do not pad this list with placeholders - the Research & Case
// Studies section on the homepage already tells visitors more are "in
// progress" rather than pretending they exist.

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
};

const CASE_STUDIES = [SMART_SOLVE_CASE];

module.exports = { SMART_SOLVE_CASE, CASE_STUDIES };
