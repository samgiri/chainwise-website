// Vercel serverless function: GET/POST /api/analyze?address=<contract or protocol name>
//
// This is a structured demo/integration endpoint, not a live on-chain analysis engine.
// It returns the Smart Solve DeFi case study dataset for recognized queries and an
// explicit "not analyzed" response otherwise, so the dashboard never fabricates a
// risk verdict for an address that hasn't actually been inspected.

const SMART_SOLVE_CASE = {
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

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const source = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const target = String(source.address || source.protocol || '').trim();

  if (!target || /smart\s*solve/i.test(target)) {
    res.status(200).json({ ...SMART_SOLVE_CASE, queried: target || null, demo: true });
    return;
  }

  res.status(200).json({
    protocol: target,
    chain: 'unknown',
    riskScore: null,
    riskLevel: 'NOT_ANALYZED',
    summary: 'This address/protocol has not been analyzed. Live on-chain analysis is not yet connected to this endpoint.',
    confidence: 0,
    layers: {},
    alerts: [],
    demo: true,
    queried: target,
  });
};
