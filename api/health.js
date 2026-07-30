// Vercel serverless function: GET /api/health
//
// Lightweight liveness/config check. Reports whether this deployment has
// the optional integrations configured - it never exposes the values
// themselves, only whether each is set.

const { ENGINE_VERSION } = require('./_lib/riskEngine');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.status(200).json({
    status: process.env.ANALYZE_ENGINE_DISABLED === 'true' ? 'engine_disabled' : 'ok',
    service: 'chainwise-api',
    engineVersion: ENGINE_VERSION,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    features: {
      'risk-analysis': true,
      '8-dimension-framework': true,
      'case-studies': true,
    },
    integrations: {
      explorerVerification: Boolean(process.env.ETHERSCAN_API_KEY),
      kvCache: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
      distributedRateLimit: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    },
  });
};
