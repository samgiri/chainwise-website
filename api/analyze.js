// Vercel serverless function: GET/POST /api/analyze?address=<0x contract address>&chain=<chain key>
//
// This endpoint analyzes a single EVM contract address using free, no-API-key public RPC
// (bytecode presence/size, EIP-1967 proxy slots, owner() control check) plus an optional
// block-explorer source-verification and holder-concentration lookup (ETHERSCAN_API_KEY).
// See api/_lib/riskEngine.js for how dimensions are computed - every value is either a real,
// cited on-chain fact or an honest `insufficient_data` state. Nothing here returns a fixed
// demo score, and there is no "no address supplied" shortcut that serves example data - an
// empty/invalid address is always a 400, never a stand-in dataset.
//
// `dimensions` holds the 6 real, scored dimensions (verification, adminControls,
// upgradeability, tokenRestrictions, ownership, governance) and drives overallScore/
// worstDimensionScore/confidence. `roadmapDimensions` holds the 2 permanent stubs (liquidity,
// exploitSignals) that have no data provider integrated at all yet - they are surfaced
// separately so they never dilute the scored coverage/confidence math, and so the UI can
// render them as "coming soon" rather than as failed checks on the analyzed contract.
//
// Scoring is deterministic and versioned (ENGINE_VERSION in riskEngine.js) - identical
// inputs always produce identical outputs, so results are reproducible.
//
// `aiSummary` is a separate, optional layer on top of that deterministic result: it sends the
// already-computed score/dimensions/findings to Claude to rephrase in plain English for a
// non-technical reader. It never sees raw on-chain data and never influences any score - see
// api/_lib/aiSummary.js. It is never attached to insufficient_data or error responses (those
// already explain themselves), and any failure/timeout there falls back to a template built
// from existing fields, never to an error.

const crypto = require('crypto');
const { CHAIN_CONFIG } = require('./_lib/chains');
const { fetchOnChainData, RpcError } = require('./_lib/rpc');
const { fetchVerification } = require('./_lib/verification');
const { fetchOwnershipData } = require('./_lib/holders');
const { computeDimensions, computeRoadmapDimensions, summarizeDimensions, ENGINE_VERSION } = require('./_lib/riskEngine');
const { generateSummary } = require('./_lib/aiSummary');
const { checkRateLimit } = require('./_lib/rateLimit');

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const REQUEST_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS) || 12000;
const CACHE_TTL_SECONDS = 6 * 60 * 60;

const BETA_DISCLAIMER = 'Beta automated preliminary screening. This is not a full smart-contract audit, financial advice, or a legal declaration that a protocol is fraudulent or safe.';

const ASSESSMENT_STATUS_BY_RESULT = {
  success: 'Complete',
  partial: 'Partial',
  insufficient_data: 'Insufficient Data',
};

function timeout(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error(message), { code: 'TIMEOUT' })), ms);
  });
}

async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.result == null) return null;
    return JSON.parse(data.result);
  } catch (err) {
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
    // Caching is a performance optimization, not a correctness requirement - swallow.
  }
}

function baseResponse({ requestId, address, chainKey, chainConfig }) {
  return {
    requestId,
    contractAddress: address || null,
    chainId: chainConfig ? chainConfig.chainId : null,
    network: chainConfig ? chainConfig.label : (chainKey || null),
    analyzedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    disclaimer: BETA_DISCLAIMER,
  };
}

function errorResponse({ requestId, address, chainKey, chainConfig, resultStatus, message, cached }) {
  return {
    ...baseResponse({ requestId, address, chainKey, chainConfig }),
    resultStatus,
    assessmentStatus: 'Insufficient Data',
    overallScore: null,
    worstDimensionScore: null,
    confidence: 0,
    dataFreshness: 'live',
    dimensions: [],
    roadmapDimensions: [],
    findings: [],
    evidence: [],
    dataSources: [],
    limitations: [],
    errors: [{ code: resultStatus, message }],
    cached: Boolean(cached),
  };
}

function successResponse({ requestId, address, chainConfig, dimensions, roadmapDimensions, summary, cached }) {
  const findings = [];
  const evidence = [];
  const dataSources = new Set();
  const limitations = new Set();

  dimensions.forEach((dim) => {
    if (dim.dataSource) dataSources.add(dim.dataSource);
    (dim.limitations || []).forEach((l) => limitations.add(l));
    (dim.findings || []).forEach((f) => {
      findings.push({ dimension: dim.key, summary: f.summary });
      if (f.evidence) evidence.push({ dimension: dim.key, dataSource: dim.dataSource, ...f.evidence });
    });
  });

  return {
    ...baseResponse({ requestId, address, chainConfig }),
    resultStatus: summary.resultStatus,
    assessmentStatus: ASSESSMENT_STATUS_BY_RESULT[summary.resultStatus] || 'Insufficient Data',
    overallScore: summary.overallScore,
    worstDimensionScore: summary.worstDimensionScore,
    confidence: summary.confidence,
    dataFreshness: cached ? 'cached' : 'live',
    explorerUrl: `${chainConfig.explorer}/address/${address}`,
    dimensions,
    roadmapDimensions,
    findings,
    evidence,
    dataSources: [...dataSources],
    limitations: [...limitations],
    errors: [],
    cached: Boolean(cached),
  };
}

function isCacheable(response) {
  return response.resultStatus === 'success' || response.resultStatus === 'partial';
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

  const requestId = crypto.randomUUID();
  const source = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const rawAddress = String(source.address || '').trim();
  const rawChain = String(source.chain || '').trim().toLowerCase();

  // Operational kill-switch: lets ops take the engine offline (e.g. during an RPC-provider
  // incident) without a redeploy, and gives the "engine unavailable" UI state a real,
  // reachable trigger instead of being permanently dead code.
  if (process.env.ANALYZE_ENGINE_DISABLED === 'true') {
    res.status(503).json(errorResponse({
      requestId, address: rawAddress || null, chainKey: rawChain,
      resultStatus: 'engine_unavailable',
      message: 'The analysis engine is temporarily unavailable. Please try again later.',
    }));
    return;
  }

  if (!rawAddress) {
    res.status(400).json(errorResponse({
      requestId, address: null, chainKey: rawChain,
      resultStatus: 'invalid_address',
      message: 'No contract address was provided.',
    }));
    return;
  }
  if (!ADDRESS_REGEX.test(rawAddress)) {
    res.status(400).json(errorResponse({
      requestId, address: rawAddress, chainKey: rawChain,
      resultStatus: 'invalid_address',
      message: `"${rawAddress}" is not a valid EVM contract address. Expected format: 0x followed by 40 hexadecimal characters.`,
    }));
    return;
  }

  const chainConfig = CHAIN_CONFIG[rawChain] ? { key: rawChain, ...CHAIN_CONFIG[rawChain] } : null;
  if (!chainConfig) {
    res.status(400).json(errorResponse({
      requestId, address: rawAddress, chainKey: rawChain,
      resultStatus: 'unsupported_network',
      message: `"${rawChain || '(none)'}" is not a supported network. Supported networks: ${Object.keys(CHAIN_CONFIG).join(', ')}.`,
    }));
    return;
  }
  if (chainConfig.status === 'unavailable' || chainConfig.status === 'coming_soon') {
    res.status(400).json(errorResponse({
      requestId, address: rawAddress, chainKey: rawChain, chainConfig,
      resultStatus: 'unsupported_network',
      message: `${chainConfig.label} analysis is currently ${chainConfig.status === 'coming_soon' ? 'not yet available' : 'unavailable'}.`,
    }));
    return;
  }

  const rateLimit = await checkRateLimit(req);
  if (rateLimit.limited) {
    res.setHeader('Retry-After', String(rateLimit.windowSeconds));
    res.status(429).json(errorResponse({
      requestId, address: rawAddress, chainKey: rawChain, chainConfig,
      resultStatus: 'rate_limited',
      message: `Too many analysis requests. Please wait a few minutes and try again (limit: ${rateLimit.maxRequests} per ${rateLimit.windowSeconds / 60} minutes).`,
    }));
    return;
  }

  const address = rawAddress.toLowerCase();
  const cacheKey = `analyze:v2:${chainConfig.key}:${address}`;

  try {
    const cached = await kvGet(cacheKey);
    if (cached && cached.engineVersion === ENGINE_VERSION) {
      res.status(200).json({ ...cached, requestId, dataFreshness: 'cached', cached: true });
      return;
    }
  } catch (err) {
    // Cache read failures are non-fatal - fall through to a live analysis.
  }

  try {
    const retrievedAt = new Date().toISOString();

    const analysis = await Promise.race([
      (async () => {
        const onChain = await fetchOnChainData(chainConfig, address);
        if (!onChain.isContract) {
          return { onChain, verification: null, ownership: null };
        }
        const [verification, ownership] = await Promise.all([
          fetchVerification(chainConfig, address).catch(() => null),
          fetchOwnershipData(chainConfig, address).catch(() => null),
        ]);
        return { onChain, verification, ownership };
      })(),
      timeout(REQUEST_TIMEOUT_MS, 'Analysis timed out'),
    ]);

    const { onChain, verification, ownership } = analysis;

    if (!onChain.isContract) {
      const response = {
        ...baseResponse({ requestId, address, chainConfig }),
        resultStatus: 'unsupported_contract',
        assessmentStatus: 'Insufficient Data',
        overallScore: null,
        worstDimensionScore: null,
        confidence: 0,
        dataFreshness: 'live',
        explorerUrl: `${chainConfig.explorer}/address/${address}`,
        dimensions: [],
        roadmapDimensions: [],
        findings: [],
        evidence: [],
        dataSources: [`${chainConfig.label} RPC (eth_getCode)`],
        limitations: ['This address has no deployed contract bytecode - it is a regular wallet (EOA) or nothing has been deployed here yet, so contract risk analysis does not apply.'],
        errors: [],
        cached: false,
      };
      res.status(200).json(response);
      return;
    }

    const dimensions = computeDimensions({ onChain, verification, ownership, chainConfig, address, retrievedAt });
    const roadmapDimensions = computeRoadmapDimensions();
    const summary = summarizeDimensions(dimensions);
    const response = successResponse({ requestId, address, chainConfig, dimensions, roadmapDimensions, summary, cached: false });

    // insufficient_data responses already explain themselves - no summary to layer on top of
    // a null score. success/partial both get one; generateSummary() can never throw or hang
    // past its own internal ~4s timeout, so this can never be the reason a request times out.
    // That 4s runs sequentially after the on-chain phase's own ANALYZE_TIMEOUT_MS (12s
    // default), so worst-case combined latency is ~16s, not 12s - see aiSummary.js. This
    // function's own maxDuration is set to 20s in vercel.json (version-controlled, so it
    // survives a project recreation) - comfortably above that 16s worst case.
    if (response.resultStatus !== 'insufficient_data') {
      response.aiSummary = await generateSummary({
        overallScore: response.overallScore,
        worstDimensionScore: response.worstDimensionScore,
        resultStatus: response.resultStatus,
        dimensions: response.dimensions,
        findings: response.findings,
      });
    }

    if (isCacheable(response)) {
      await kvSet(cacheKey, response);
    }
    res.status(200).json(response);
  } catch (err) {
    if (err && err.code === 'TIMEOUT') {
      res.status(504).json(errorResponse({
        requestId, address, chainKey: rawChain, chainConfig,
        resultStatus: 'timeout',
        message: 'Analysis took too long to complete. Please try again.',
      }));
      return;
    }
    if (err instanceof RpcError) {
      console.error('[analyze] RPC failure', { requestId, chain: chainConfig.key, message: err.message });
      res.status(502).json(errorResponse({
        requestId, address, chainKey: rawChain, chainConfig,
        resultStatus: 'rpc_failure',
        message: `Could not reach the ${chainConfig.label} network to look up this address. Please try again shortly.`,
      }));
      return;
    }
    console.error('[analyze] internal error', { requestId, message: err && err.message });
    res.status(500).json(errorResponse({
      requestId, address, chainKey: rawChain, chainConfig,
      resultStatus: 'internal_error',
      message: 'An unexpected error occurred while analyzing this contract.',
    }));
  }
};
