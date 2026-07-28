// Vercel serverless function: GET/POST /api/analyze?address=<contract or protocol name>&chain=<chain>
//
// Pipeline:
//   1. Recognized case studies (e.g. Smart Solve DeFi) return a fixed demo dataset.
//   2. Everything else is analyzed live via the Claude API when ANTHROPIC_API_KEY is
//      configured, using a forced tool call so the response matches the 8-layer schema
//      dashboard.html renders (patterns, bytecode, treasury, withdrawals, bridges,
//      off-ramps, sybil, attribution).
//   3. Live results are cached in Vercel KV (Upstash REST API) when KV_REST_API_URL /
//      KV_REST_API_TOKEN are configured, to avoid re-spending tokens on repeat queries.
//   4. If no API key is configured, or Claude has no real knowledge of the address/
//      protocol, this returns the same honest "not analyzed" response as before rather
//      than fabricating a verdict. PDF export is not implemented yet (JSON download only).

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

const LAYER_KEYS = ['patterns', 'bytecode', 'treasury', 'withdrawals', 'bridges', 'offRamps', 'sybil', 'attribution'];
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

const LAYER_DEFINITIONS = `
1. patterns - Source/code pattern red flags: known vulnerability signatures, honeypot patterns, hidden fee/mint functions.
2. bytecode - Compiled bytecode risk: unverified source, proxy/upgradeable patterns, unusual opcodes or obfuscation.
3. treasury - On-chain treasury wallet analysis: concentration of funds, suspicious outflows.
4. withdrawals - Fund flow analysis: withdrawal queue health, abnormal withdrawal restrictions or halts.
5. bridges - Cross-chain bridge exposure and bridge-related risk.
6. offRamps - Exchange/off-ramp cash-out concentration and velocity.
7. sybil - Sybil / wallet-clustering risk among holders, referrers, or early participants.
8. attribution - Operator/team identity risk: anonymity, prior rug pulls or failed projects by the same actors.
`.trim();

const RISK_TOOL = {
  name: 'submit_risk_analysis',
  description: 'Submit a structured 8-layer DeFi/smart-contract risk analysis for the queried address or protocol.',
  input_schema: {
    type: 'object',
    properties: {
      recognized: {
        type: 'boolean',
        description: 'True only if you have specific, meaningful knowledge of this exact address/protocol to analyze. False if you do not recognize it or can only guess.',
      },
      protocol: { type: 'string', description: 'Protocol or contract name as best known.' },
      chain: { type: 'string' },
      riskScore: { type: 'integer', minimum: 0, maximum: 100 },
      riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      summary: { type: 'string', description: 'One to two sentence plain-English summary.' },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      estimatedLoss: { type: 'string', description: 'e.g. "$5M+", or omit if unknown.' },
      usersAtRisk: { type: 'integer' },
      collapseTimelineDays: {
        type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2,
        description: '[minDays, maxDays] estimated window to collapse/exploit, if applicable.',
      },
      operatorControlPct: { type: 'integer', minimum: 0, maximum: 100 },
      detectionHours: { type: 'integer' },
      layers: {
        type: 'object',
        description: 'Risk score 0-100 for each layer (higher = riskier). See layer definitions in the prompt.',
        properties: Object.fromEntries(LAYER_KEYS.map((k) => [k, { type: 'integer', minimum: 0, maximum: 100 }])),
        required: LAYER_KEYS,
      },
      alerts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
            message: { type: 'string' },
          },
          required: ['level', 'message'],
        },
      },
    },
    required: ['recognized', 'protocol', 'chain', 'summary', 'confidence'],
  },
};

function notAnalyzedResponse(target, chain, extra) {
  return {
    protocol: target,
    chain: chain || 'unknown',
    riskScore: null,
    riskLevel: 'NOT_ANALYZED',
    summary: 'This address/protocol has not been analyzed. Live on-chain analysis is not yet connected to this endpoint.',
    confidence: 0,
    layers: {},
    alerts: [],
    demo: true,
    queried: target,
    ...extra,
  };
}

async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.result == null) return null;
    return JSON.parse(data.result);
  } catch (err) {
    console.error('[analyze] kvGet failed', err);
    return null;
  }
}

async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}?EX=${CACHE_TTL_SECONDS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: JSON.stringify(value),
    });
  } catch (err) {
    console.error('[analyze] kvSet failed', err);
  }
}

async function analyzeWithClaude(target, chain) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const prompt = `You are a DeFi/smart-contract risk analyst. Analyze this query using only what you actually know from training data - you have no live internet or on-chain access in this call.

Target: "${target}"
Chain: "${chain || 'unknown'}"

If you do not have specific, meaningful knowledge of this exact address or protocol, set recognized=false, confidence to a low number, and briefly say so in the summary. Do not invent specifics for something you don't recognize.

If recognized, score each of these 8 layers 0-100 (higher = riskier):
${LAYER_DEFINITIONS}

Call the submit_risk_analysis tool with your findings.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0.2,
      tools: [RISK_TOOL],
      tool_choice: { type: 'tool', name: 'submit_risk_analysis' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const toolUse = (data.content || []).find((block) => block.type === 'tool_use' && block.name === 'submit_risk_analysis');
  if (!toolUse) throw new Error('Claude response did not include the expected tool call');
  return toolUse.input;
}

module.exports = async (req, res) => {
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
  const chain = String(source.chain || '').trim();

  if (!target || /smart\s*solve/i.test(target)) {
    res.status(200).json({ ...SMART_SOLVE_CASE, queried: target || null, demo: true });
    return;
  }

  const cacheKey = `analyze:${(chain || 'unknown').toLowerCase()}:${target.toLowerCase()}`;

  const cached = await kvGet(cacheKey);
  if (cached) {
    res.status(200).json({ ...cached, cached: true });
    return;
  }

  let analysis;
  try {
    analysis = await analyzeWithClaude(target, chain);
  } catch (err) {
    console.error('[analyze] Claude API call failed', err);
    res.status(200).json(notAnalyzedResponse(target, chain, { error: 'Live analysis temporarily unavailable.' }));
    return;
  }

  if (!analysis) {
    // No ANTHROPIC_API_KEY configured - keep the honest "not analyzed" behavior.
    res.status(200).json(notAnalyzedResponse(target, chain));
    return;
  }

  let result;
  if (!analysis.recognized) {
    result = notAnalyzedResponse(target, chain, {
      demo: false,
      confidence: analysis.confidence || 0,
      summary: analysis.summary || 'Claude has no specific knowledge of this address/protocol.',
    });
  } else {
    result = {
      protocol: analysis.protocol || target,
      chain: analysis.chain || chain || 'unknown',
      riskScore: analysis.riskScore ?? null,
      riskLevel: analysis.riskLevel || 'NOT_ANALYZED',
      summary: analysis.summary,
      confidence: analysis.confidence ?? 0,
      estimatedLoss: analysis.estimatedLoss,
      usersAtRisk: analysis.usersAtRisk,
      collapseTimelineDays: analysis.collapseTimelineDays,
      operatorControlPct: analysis.operatorControlPct,
      detectionHours: analysis.detectionHours,
      layers: analysis.layers || {},
      alerts: analysis.alerts || [],
      demo: false,
      aiGenerated: true,
      disclaimer: 'Generated by Claude from training-data knowledge only, not live on-chain telemetry. Independent verification recommended.',
      queried: target,
    };
  }

  await kvSet(cacheKey, result);
  res.status(200).json(result);
};
