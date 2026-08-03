// Unit tests for api/_lib/aiSummary.js - the optional AI-generated plain-English verdict
// layered on top of the deterministic risk-engine output. Every failure path (no API key,
// non-ok response, network error/timeout, malformed response) must fall back to the template
// sentence and must never throw.

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { generateSummary, buildTemplateFallback } = require('../api/_lib/aiSummary');

const originalFetch = global.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

const SAMPLE_DIMENSIONS = [
  { key: 'verification', name: 'Contract Verification & Transparency', state: 'assessed', subscore: 10, level: 'no_material_indicator' },
  { key: 'adminControls', name: 'Privileged Access & Admin Controls', state: 'assessed', subscore: 40, level: 'review_recommended' },
  { key: 'upgradeability', name: 'Upgradeability & Proxy Risk', state: 'assessed', subscore: 20, level: 'no_material_indicator' },
  { key: 'tokenRestrictions', name: 'Token & Transaction Restrictions', state: 'assessed', subscore: 20, level: 'no_material_indicator' },
  { key: 'ownership', name: 'Ownership & Wallet Concentration', state: 'insufficient_data', subscore: null, level: null },
  { key: 'governance', name: 'Governance & Operational Controls', state: 'insufficient_data', subscore: null, level: null },
];
const SAMPLE_FINDINGS = [
  { dimension: 'verification', summary: 'Source code is verified on Etherscan as "Test".' },
  { dimension: 'adminControls', summary: 'Detected function selector 0x8456cb59 (pause()).' },
  { dimension: 'upgradeability', summary: 'No standard proxy pattern was detected.' },
];

test('generateSummary returns the template fallback immediately when ANTHROPIC_API_KEY is not set, without calling fetch', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; throw new Error('should not be called'); };

  const result = await generateSummary({ overallScore: 23, worstDimensionScore: 40, resultStatus: 'partial', dimensions: SAMPLE_DIMENSIONS, findings: SAMPLE_FINDINGS });
  assert.equal(result.aiGenerated, false);
  assert.ok(result.text.length > 0);
  assert.equal(fetchCalled, false);
});

test('generateSummary falls back cleanly (never throws) when the Anthropic API returns a non-ok response', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });

  const result = await generateSummary({ overallScore: 23, worstDimensionScore: 40, resultStatus: 'partial', dimensions: SAMPLE_DIMENSIONS, findings: SAMPLE_FINDINGS });
  assert.equal(result.aiGenerated, false);
  assert.ok(result.text.length > 0);
});

test('generateSummary falls back cleanly (never throws) on a network error or timeout', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => { throw new Error('network down'); };

  const result = await generateSummary({ overallScore: 23, worstDimensionScore: 40, resultStatus: 'partial', dimensions: SAMPLE_DIMENSIONS, findings: SAMPLE_FINDINGS });
  assert.equal(result.aiGenerated, false);
});

test('generateSummary falls back cleanly when the Anthropic API returns a malformed/empty body', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({ ok: true, json: async () => ({ content: [] }) });

  const result = await generateSummary({ overallScore: 23, worstDimensionScore: 40, resultStatus: 'partial', dimensions: SAMPLE_DIMENSIONS, findings: SAMPLE_FINDINGS });
  assert.equal(result.aiGenerated, false);
});

test('generateSummary returns aiGenerated: true with the model text on a well-formed success response (mocked Anthropic call)', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['x-api-key'], 'test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'claude-sonnet-5');
    assert.ok(body.max_tokens <= 220);
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'This contract shows a moderate risk profile. It is preliminary automated screening, not a guarantee.' }] }),
    };
  };

  const result = await generateSummary({ overallScore: 23, worstDimensionScore: 40, resultStatus: 'partial', dimensions: SAMPLE_DIMENSIONS, findings: SAMPLE_FINDINGS });
  assert.equal(result.aiGenerated, true);
  assert.match(result.text, /moderate risk profile/);
});

test('buildTemplateFallback picks the finding belonging to the highest-subscore assessed dimension', () => {
  const result = buildTemplateFallback({ overallScore: 23, dimensions: SAMPLE_DIMENSIONS, findings: SAMPLE_FINDINGS });
  assert.equal(result.aiGenerated, false);
  assert.match(result.text, /23\/100/);
  assert.match(result.text, /No material indicator detected/, "the overall score's own level label (23 falls in the 0-33 band), not the worst dimension's");
  assert.match(result.text, /pause\(\)/, 'must cite the adminControls finding (subscore 40, the highest) as the top factor');
  assert.match(result.text, /automated preliminary screening, not a guarantee/);
});

test('buildTemplateFallback handles a null overallScore without fabricating a score', () => {
  const result = buildTemplateFallback({ overallScore: null, dimensions: [], findings: [] });
  assert.equal(result.aiGenerated, false);
  assert.ok(!/\d+\/100/.test(result.text), 'must not print a fabricated score when there is none');
});
