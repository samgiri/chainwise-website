// Optional AI-generated plain-English verdict, layered strictly on top of the deterministic
// risk-engine output. The model is only ever given the ALREADY-COMPUTED score/dimensions/
// findings to rephrase - it never sees raw on-chain data and never influences any score.
//
// Every failure path (no API key, network error, timeout, malformed response) falls back to
// a template sentence built entirely from fields riskEngine.js already produced. This must
// never throw and never return an error to the caller - the page must never break, error, or
// slow down meaningfully because of this.

const { levelFromScore } = require('./riskEngine');

// Kept short and independent of ANALYZE_TIMEOUT_MS (the on-chain fetch budget, default 12s):
// worst case the two add sequentially (on-chain phase finishes, then this runs), so this
// stays at ~4s to keep combined worst-case latency at ~16s rather than ~18s.
const REQUEST_TIMEOUT_MS = 4000;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 150;

const SYSTEM_PROMPT = 'You are summarizing a smart-contract risk report for a non-technical '
  + 'retail investor. You will be given structured findings. Write exactly 3-4 plain-English '
  + 'sentences. Do not invent any fact, number, or finding not present in the input. Do not '
  + 'give financial advice or tell the user to buy/sell/invest. End with a reminder that this '
  + 'is automated screening, not a guarantee.';

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Built entirely from data the caller already has - no API call, no new data needed.
function buildTemplateFallback({ overallScore, dimensions, findings }) {
  const assessedDims = (dimensions || []).filter((d) => d.state === 'assessed' && d.subscore !== null);
  const total = (dimensions || []).length;

  if (overallScore === null || overallScore === undefined || !assessedDims.length) {
    return {
      text: 'There was not enough on-chain evidence to produce a confident automated summary for this contract. This is automated preliminary screening, not a guarantee of safety or risk.',
      aiGenerated: false,
    };
  }

  const levelLabel = levelFromScore(overallScore).label;
  const worstDim = assessedDims.reduce((worst, d) => (!worst || d.subscore > worst.subscore ? d : worst), null);
  const topFinding = (findings || []).find((f) => f.dimension === worstDim.key);

  const text = `This contract scores ${overallScore}/100 (${levelLabel}), based on ${assessedDims.length} of ${total} risk checks. `
    + (topFinding ? `The most significant factor found: ${topFinding.summary} ` : '')
    + 'This is automated preliminary screening, not a guarantee of safety or risk.';

  return { text, aiGenerated: false };
}

async function generateSummary({ overallScore, worstDimensionScore, resultStatus, dimensions, findings }) {
  const fallback = buildTemplateFallback({ overallScore, dimensions, findings });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback;

  const payload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ overallScore, worstDimensionScore, resultStatus, dimensions, findings }),
      },
    ],
  };

  try {
    const res = await fetchWithTimeout(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    }, REQUEST_TIMEOUT_MS);

    if (!res.ok) return fallback;
    const data = await res.json();
    const text = data && Array.isArray(data.content) && data.content[0] && data.content[0].text;
    if (!text || !text.trim()) return fallback;
    return { text: text.trim(), aiGenerated: true };
  } catch (err) {
    return fallback;
  }
}

module.exports = { generateSummary, buildTemplateFallback };
