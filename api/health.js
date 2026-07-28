// Vercel serverless function: GET /api/health
//
// Lightweight liveness/config check. Reports whether this deployment has
// the optional integrations configured - it never exposes the values
// themselves, only whether each is set.

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
    status: 'ok',
    timestamp: new Date().toISOString(),
    integrations: {
      claudeApi: Boolean(process.env.ANTHROPIC_API_KEY),
      kvCache: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    },
  });
};
