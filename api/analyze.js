// Vercel serverless function: GET/POST /api/analyze?address=<contract or protocol name>&chain=<chain>
//
// Pipeline:
//   1. Recognized case studies (e.g. Smart Solve DeFi) return a fixed demo dataset.
//   2. A well-formed 0x contract address is analyzed via Phase 1 real on-chain telemetry:
//      free public RPC endpoints (no API key required) supply eth_getCode / eth_getBalance /
//      eth_getTransactionCount, which are then handed to the Claude API to score the 8-layer
//      framework dashboard.html renders (patterns, bytecode, treasury, withdrawals, bridges,
//      off-ramps, sybil, attribution). If Claude is unavailable, a deterministic heuristic
//      derived from the on-chain facts is returned instead of blank/zero data.
//   3. Free-text protocol names (not addresses) fall back to the original Claude
//      training-data-only lookup - no on-chain data exists to fetch for a name.
//   4. Live results are cached in Vercel KV (Upstash REST API) when KV_REST_API_URL /
//      KV_REST_API_TOKEN are configured, to avoid re-spending tokens on repeat queries.
//   5. If no ANTHROPIC_API_KEY is configured and the query is a protocol name (not an
//      address), this returns the honest "not analyzed" response rather than fabricating a
//      verdict. PDF export is not implemented yet (JSON download only).
//
// Phase 1 explicitly does NOT do full forensic on-chain tracing (fund-flow graphs, bridge
// hop tracking, sybil clustering, off-ramp attribution) - every response is tagged with a
// `disclaimer` and `phase: 1` field so this can be surfaced in the UI later if desired.

const { SMART_SOLVE_CASE } = require('./_lib/caseStudies');

const LAYER_KEYS = ['patterns', 'bytecode', 'treasury', 'withdrawals', 'bridges', 'offRamps', 'sybil', 'attribution'];
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const RPC_TIMEOUT_MS = 8000;

// Free, no-API-key-required public RPC endpoints. Each chain lists two endpoints from
// different providers (never a single point of failure); rpcCall() tries them in order
// and only fails if all of them fail. Do not add Ankr URLs here - rpc.ankr.com/* now
// requires an API key for these methods and will fail in production with a 401.
const CHAIN_CONFIG = {
  ethereum: { rpcs: ['https://eth.llamarpc.com', 'https://ethereum-rpc.publicnode.com'], symbol: 'ETH', label: 'Ethereum' },
  polygon: { rpcs: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com'], symbol: 'MATIC', label: 'Polygon' },
  arbitrum: { rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'], symbol: 'ETH', label: 'Arbitrum' },
  optimism: { rpcs: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'], symbol: 'ETH', label: 'Optimism' },
  base: { rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'], symbol: 'ETH', label: 'Base' },
  bsc: { rpcs: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'], symbol: 'BNB', label: 'BSC' },
  avalanche: { rpcs: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'], symbol: 'AVAX', label: 'Avalanche' },
  zksync: { rpcs: ['https://mainnet.era.zksync.io', 'https://zksync-era-rpc.publicnode.com'], symbol: 'ETH', label: 'zkSync Era' },
};

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
        description: 'True only if you have specific, meaningful knowledge of this exact address/protocol to analyze. False if you do not recognize it or can only guess. When live on-chain data is supplied, still fill in "layers" with your best-effort heuristic scores even if recognized is false.',
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

function riskLevelFromScore(score) {
  if (score === null || score === undefined) return 'NOT_ANALYZED';
  if (score <= 33) return 'LOW';
  if (score <= 66) return 'MEDIUM';
  if (score <= 89) return 'HIGH';
  return 'CRITICAL';
}

// Only cache genuine AI-generated results. A degraded response (heuristic-only fallback,
// or "not analyzed") must never get locked into KV for CACHE_TTL_SECONDS - if it did, fixing
// the underlying LLM issue (bad key, bad model name, transient outage) wouldn't show up for
// up to 6 hours per address/protocol, since a Vercel redeploy does not touch the external KV
// store. Also used on read to treat any already-poisoned cache entry as a miss.
function isCacheableResult(result) {
  return Boolean(result && result.aiGenerated === true);
}

function hasFullLayers(layers) {
  return Boolean(layers) && LAYER_KEYS.every((k) => typeof layers[k] === 'number');
}

function averageLayers(layers) {
  const values = LAYER_KEYS.map((k) => layers[k]).filter((v) => typeof v === 'number');
  if (!values.length) return 50;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

// Deterministic fallback used only when the Claude call is unavailable/fails - it is a
// crude heuristic from real on-chain facts, not a substitute for the LLM-informed scoring.
function heuristicLayersFromOnChain(onChain) {
  const bytecodeRisk = !onChain.isContract ? 60 : onChain.codeSizeBytes < 100 ? 70 : 35;
  const treasuryRisk = onChain.balanceNative === 0 ? 55 : 30;
  const activityRisk = onChain.txCount < 5 ? 65 : 25;
  return {
    patterns: 50,
    bytecode: bytecodeRisk,
    treasury: treasuryRisk,
    withdrawals: activityRisk,
    bridges: 50,
    offRamps: 50,
    sybil: 50,
    attribution: onChain.isContract ? 40 : 60,
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
  throw new Error(`${method} failed on all RPC endpoints for this chain (${lastError ? lastError.message : 'unknown error'})`);
}

// Fetches free, no-API-key on-chain basics for an address: whether it's a deployed
// contract, its bytecode size, native balance, and transaction count (activity level).
async function fetchOnChainData(chainKey, address) {
  const config = CHAIN_CONFIG[chainKey];
  const [code, balanceHex, txCountHex] = await Promise.all([
    rpcCall(config.rpcs, 'eth_getCode', [address, 'latest']),
    rpcCall(config.rpcs, 'eth_getBalance', [address, 'latest']),
    rpcCall(config.rpcs, 'eth_getTransactionCount', [address, 'latest']),
  ]);

  const isContract = Boolean(code) && code !== '0x';
  const codeSizeBytes = isContract ? Math.max(0, (code.length - 2) / 2) : 0;
  const balanceWei = BigInt(balanceHex || '0x0');
  const balanceNative = Number(balanceWei) / 1e18;
  const txCount = parseInt(txCountHex || '0x0', 16);

  return {
    chainKey,
    chainLabel: config.label,
    nativeSymbol: config.symbol,
    isContract,
    codeSizeBytes,
    balanceNative,
    txCount,
  };
}

async function analyzeWithClaude(target, chainLabel, onChain) {
  // TEMP DEBUG (unconditional - runs on every call, remove once the Claude call is
  // confirmed to actually fire in prod): the "External APIs" trace shows zero calls to
  // api.anthropic.com, which only happens if this function returns before ever calling
  // fetch() below - i.e. apiKey is falsy here. Logging existence/length (never the value)
  // to distinguish "key truly missing at runtime" from some other silent early-return.
  console.log('[analyze] ANTHROPIC_API_KEY check', {
    envVarNameReadByCode: 'ANTHROPIC_API_KEY',
    exists: 'ANTHROPIC_API_KEY' in process.env,
    length: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.length : 0,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const onChainSection = onChain ? `
Live on-chain data fetched moments ago via public RPC (verified ground truth - trust this over any assumption):
- Chain: ${onChain.chainLabel}
- Deployed contract (has bytecode): ${onChain.isContract ? 'YES' : 'NO - no contract code at this address (EOA or undeployed)'}
- Bytecode size: ${onChain.codeSizeBytes} bytes
- Native balance held at this address: ${onChain.balanceNative.toFixed(6)} ${onChain.nativeSymbol}
- Transaction count (nonce): ${onChain.txCount}
` : '';

  const instructions = onChain
    ? 'Treat the on-chain data above as verified fact. Combine it with anything you recognize about this specific address from training data. Always populate every one of the 8 layer scores with your best-effort estimate using the on-chain facts, even if you do not recognize the protocol by name (set recognized=false in that case, and keep confidence low) - only omit "layers" if you have absolutely nothing to go on, which should be rare given the on-chain facts provided.'
    : 'If you do not have specific, meaningful knowledge of this exact address or protocol, set recognized=false, confidence to a low number, and briefly say so in the summary. Do not invent specifics for something you do not recognize.';

  const prompt = `You are a DeFi/smart-contract risk analyst.${onChain ? ' You have live on-chain data fetched just now via public RPC, plus whatever you know from training data about this address.' : ' Analyze this query using only what you actually know from training data - you have no live internet or on-chain access in this call.'}

Target: "${target}"
Chain: "${chainLabel || 'unknown'}"
${onChainSection}
${instructions}

Score each of these 8 layers 0-100 (higher = riskier):
${LAYER_DEFINITIONS}

Call the submit_risk_analysis tool with your findings. Respond only via the tool call - no prose, no markdown.`;

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
      tools: [RISK_TOOL],
      tool_choice: { type: 'tool', name: 'submit_risk_analysis' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Claude API returned ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const toolUse = (data.content || []).find((block) => block.type === 'tool_use' && block.name === 'submit_risk_analysis');
  if (!toolUse) throw new Error('Claude response did not include the expected tool call');
  return toolUse.input;
}

// Builds the dashboard-facing response for a real 0x address, always using real numbers -
// either Claude's on-chain-informed scoring, or (if Claude is unavailable) a deterministic
// heuristic derived straight from the fetched on-chain facts. Never falls back to "0 - N/A".
function buildAddressResult({ analysis, target, chainConfig, onChain, llmError }) {
  const usedLLM = hasFullLayers(analysis && analysis.layers);
  const layers = usedLLM ? analysis.layers : heuristicLayersFromOnChain(onChain);
  const riskScore = usedLLM && Number.isFinite(analysis.riskScore) ? analysis.riskScore : averageLayers(layers);
  const riskLevel = usedLLM && analysis.riskLevel ? analysis.riskLevel : riskLevelFromScore(riskScore);
  const summary = usedLLM && analysis.summary
    ? analysis.summary
    : `Heuristic on-chain analysis (LLM scoring unavailable): ${onChain.isContract ? `verified ${onChain.codeSizeBytes}-byte contract` : 'no contract bytecode found at this address'}, ${onChain.txCount} transactions, ${onChain.balanceNative.toFixed(6)} ${onChain.nativeSymbol} balance.`;

  return {
    protocol: (usedLLM && analysis.protocol) || target,
    chain: chainConfig.label,
    riskScore,
    riskLevel,
    summary,
    confidence: usedLLM && Number.isFinite(analysis.confidence) ? analysis.confidence : 30,
    estimatedLoss: usedLLM ? analysis.estimatedLoss : undefined,
    usersAtRisk: usedLLM ? analysis.usersAtRisk : undefined,
    collapseTimelineDays: usedLLM ? analysis.collapseTimelineDays : undefined,
    operatorControlPct: usedLLM ? analysis.operatorControlPct : undefined,
    detectionHours: usedLLM ? analysis.detectionHours : undefined,
    layers,
    alerts: (usedLLM && analysis.alerts) || [],
    demo: false,
    aiGenerated: usedLLM,
    onChainVerified: true,
    onChainData: {
      isContract: onChain.isContract,
      codeSizeBytes: onChain.codeSizeBytes,
      balanceNative: Number(onChain.balanceNative.toFixed(6)),
      nativeSymbol: onChain.nativeSymbol,
      txCount: onChain.txCount,
    },
    llmError: llmError || undefined,
    phase: 1,
    disclaimer: 'Phase 1 analysis: on-chain telemetry (contract bytecode presence, treasury balance, transaction count) fetched live via free public RPC'
      + (usedLLM ? ', combined with an LLM-based heuristic risk score.' : '; LLM scoring was unavailable so layer scores are a deterministic fallback heuristic.')
      + ' Not yet backed by full forensic on-chain tracing (fund-flow graphs, bridge-hop tracking, off-ramp attribution, sybil clustering) - treat scores as directional, not definitive.',
    queried: target,
  };
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
  const rawTarget = String(source.address || source.protocol || '').trim();
  const rawChain = String(source.chain || '').trim();

  if (!rawTarget || /smart\s*solve/i.test(rawTarget)) {
    res.status(200).json({ ...SMART_SOLVE_CASE, queried: rawTarget || null, demo: true });
    return;
  }

  const looksLikeAddressAttempt = /^0x/i.test(rawTarget);
  if (looksLikeAddressAttempt && !ADDRESS_REGEX.test(rawTarget)) {
    res.status(400).json({ error: `Invalid contract address "${rawTarget}". Expected format: 0x followed by 40 hexadecimal characters.` });
    return;
  }

  const isAddress = ADDRESS_REGEX.test(rawTarget);
  const target = isAddress ? rawTarget.toLowerCase() : rawTarget;
  const chainKey = rawChain.toLowerCase();
  const cacheKey = `analyze:${chainKey || 'unknown'}:${target.toLowerCase()}`;

  const cached = await kvGet(cacheKey);
  if (isCacheableResult(cached)) {
    res.status(200).json({ ...cached, cached: true });
    return;
  }

  if (isAddress) {
    const chainConfig = CHAIN_CONFIG[chainKey];
    if (!chainConfig) {
      res.status(400).json({
        error: `Unsupported or missing chain "${rawChain || '(none)'}" for address analysis. Supported chains: ${Object.keys(CHAIN_CONFIG).join(', ')}.`,
      });
      return;
    }

    let onChain;
    try {
      onChain = await fetchOnChainData(chainKey, target);
    } catch (err) {
      console.error('[analyze] on-chain RPC fetch failed', err);
      res.status(502).json({ error: `Could not reach the ${chainConfig.label} RPC endpoint to look up this address: ${err.message}` });
      return;
    }

    let analysis = null;
    let llmError;
    try {
      analysis = await analyzeWithClaude(target, chainConfig.label, onChain);
    } catch (err) {
      // TEMP DEBUG (remove once ANTHROPIC_API_KEY 401/model-name issue is confirmed fixed in prod):
      // logs enough to diagnose without ever printing the key itself.
      console.error('[analyze] Claude call failed for address path', {
        message: err.message,
        status: err.status,
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
        hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
      });
      llmError = `LLM scoring failed, showing on-chain heuristic only: ${err.message}`;
    }

    const result = buildAddressResult({ analysis, target, chainConfig, onChain, llmError });
    if (isCacheableResult(result)) {
      await kvSet(cacheKey, result);
    }
    res.status(200).json(result);
    return;
  }

  // Free-text protocol name (not a 0x address) - no on-chain data to fetch, fall back to
  // the original Claude training-data-only lookup.
  let analysis;
  try {
    analysis = await analyzeWithClaude(target, rawChain, null);
  } catch (err) {
    // TEMP DEBUG (remove once ANTHROPIC_API_KEY 401/model-name issue is confirmed fixed in prod):
    // logs enough to diagnose without ever printing the key itself.
    console.error('[analyze] Claude API call failed', {
      message: err.message,
      status: err.status,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    });
    res.status(200).json(notAnalyzedResponse(target, rawChain, { error: 'Live analysis temporarily unavailable.' }));
    return;
  }

  if (!analysis) {
    // No ANTHROPIC_API_KEY configured - keep the honest "not analyzed" behavior.
    res.status(200).json(notAnalyzedResponse(target, rawChain));
    return;
  }

  let result;
  if (!analysis.recognized) {
    result = notAnalyzedResponse(target, rawChain, {
      demo: false,
      confidence: analysis.confidence || 0,
      summary: analysis.summary || 'Claude has no specific knowledge of this address/protocol.',
    });
  } else {
    result = {
      protocol: analysis.protocol || target,
      chain: analysis.chain || rawChain || 'unknown',
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
      phase: 1,
      disclaimer: 'Phase 1 analysis: generated by Claude from training-data knowledge only (no on-chain address was given to fetch live telemetry from). Not yet backed by full forensic on-chain tracing - independent verification recommended.',
      queried: target,
    };
  }

  if (isCacheableResult(result)) {
    await kvSet(cacheKey, result);
  }
  res.status(200).json(result);
};
