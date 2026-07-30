const { test } = require('node:test');
const assert = require('node:assert/strict');
const { levelFromScore, computeDimensions, summarizeDimensions, ENGINE_VERSION } = require('../api/_lib/riskEngine');
const { CHAIN_CONFIG } = require('../api/_lib/chains');

const chainConfig = { key: 'ethereum', ...CHAIN_CONFIG.ethereum };
const address = '0x1234567890abcdef1234567890abcdef12345678';
const retrievedAt = new Date().toISOString();

test('levelFromScore bands match the plain-language legend (0-33/34-66/67-89/90-100)', () => {
  assert.equal(levelFromScore(0).level, 'no_material_indicator');
  assert.equal(levelFromScore(33).level, 'no_material_indicator');
  assert.equal(levelFromScore(34).level, 'review_recommended');
  assert.equal(levelFromScore(66).level, 'review_recommended');
  assert.equal(levelFromScore(67).level, 'elevated_risk_indicator');
  assert.equal(levelFromScore(89).level, 'elevated_risk_indicator');
  assert.equal(levelFromScore(90).level, 'critical_risk_indicator');
  assert.equal(levelFromScore(100).level, 'critical_risk_indicator');
});

test('computeDimensions never fabricates data for an EOA-shaped onChain fixture (not_applicable, not "safe")', () => {
  const onChain = {
    isContract: false, bytecode: '0x', codeSizeBytes: 0, balanceNative: 1, txCount: 4,
    blockNumber: 1000, proxyImplementation: null, proxyAdmin: null, ownerAddress: null, ownerIsContract: null,
  };
  const dims = computeDimensions({ onChain, verification: null, chainConfig, address, retrievedAt });
  const contractSpecific = dims.filter((d) => ['adminControls', 'upgradeability', 'governance'].includes(d.key));
  contractSpecific.forEach((d) => {
    assert.equal(d.state, 'not_applicable');
    assert.equal(d.subscore, null);
  });
});

test('computeDimensions reports insufficient_data (not a fabricated score) when no evidence source is wired up', () => {
  const onChain = {
    isContract: true, bytecode: '0x6080604052', codeSizeBytes: 10, balanceNative: 0, txCount: 0,
    blockNumber: 1000, proxyImplementation: null, proxyAdmin: null, ownerAddress: null, ownerIsContract: null,
  };
  const dims = computeDimensions({ onChain, verification: null, chainConfig, address, retrievedAt });
  const alwaysInsufficient = ['liquidity', 'ownership', 'exploitSignals', 'tokenRestrictions', 'verification'];
  alwaysInsufficient.forEach((key) => {
    const dim = dims.find((d) => d.key === key);
    assert.equal(dim.state, 'insufficient_data', `${key} should be insufficient_data without a data source`);
    assert.equal(dim.subscore, null);
    assert.ok(dim.limitations.length > 0, `${key} must document why it is insufficient`);
  });
});

test('computeDimensions detects a known admin selector (pause()) from real bytecode', () => {
  const onChain = {
    isContract: true, bytecode: '0x600035' + '8456cb59' + 'deadbeef', codeSizeBytes: 20, balanceNative: 0, txCount: 1,
    blockNumber: 1000, proxyImplementation: null, proxyAdmin: null, ownerAddress: null, ownerIsContract: null,
  };
  const dims = computeDimensions({ onChain, verification: null, chainConfig, address, retrievedAt });
  const admin = dims.find((d) => d.key === 'adminControls');
  assert.equal(admin.state, 'assessed');
  assert.ok(admin.findings.some((f) => f.summary.includes('0x8456cb59')));
  assert.ok(admin.subscore > 0 && admin.subscore < 90, 'weak bytecode-selector evidence must never reach a critical subscore');
});

test('computeDimensions flags EIP-1967 proxy implementation slot as elevated risk', () => {
  const onChain = {
    isContract: true, bytecode: '0x6080', codeSizeBytes: 2, balanceNative: 0, txCount: 1,
    blockNumber: 1000,
    proxyImplementation: '0x000000000000000000000000000000000000aaaa',
    proxyAdmin: null, ownerAddress: null, ownerIsContract: null,
  };
  const dims = computeDimensions({ onChain, verification: null, chainConfig, address, retrievedAt });
  const upgrade = dims.find((d) => d.key === 'upgradeability');
  assert.equal(upgrade.state, 'assessed');
  assert.equal(upgrade.level, 'elevated_risk_indicator');
});

test('summarizeDimensions never computes an overall score from fewer than 3 assessed dimensions', () => {
  const dims = [
    { key: 'a', state: 'assessed', subscore: 90, confidence: 90 },
    { key: 'b', state: 'insufficient_data', subscore: null, confidence: null },
    { key: 'c', state: 'insufficient_data', subscore: null, confidence: null },
    { key: 'd', state: 'not_applicable', subscore: null, confidence: null },
  ];
  const summary = summarizeDimensions(dims);
  assert.equal(summary.overallScore, null);
  assert.equal(summary.resultStatus, 'insufficient_data');
});

test('summarizeDimensions reduces confidence proportionally to evidence coverage', () => {
  const fewAssessed = [
    { key: 'a', state: 'assessed', subscore: 50, confidence: 80 },
    { key: 'b', state: 'assessed', subscore: 50, confidence: 80 },
    { key: 'c', state: 'assessed', subscore: 50, confidence: 80 },
    { key: 'd', state: 'insufficient_data', subscore: null, confidence: null },
    { key: 'e', state: 'insufficient_data', subscore: null, confidence: null },
    { key: 'f', state: 'insufficient_data', subscore: null, confidence: null },
    { key: 'g', state: 'insufficient_data', subscore: null, confidence: null },
    { key: 'h', state: 'insufficient_data', subscore: null, confidence: null },
  ];
  const summary = summarizeDimensions(fewAssessed);
  assert.equal(summary.resultStatus, 'partial');
  assert.ok(summary.confidence < 80, 'confidence must be discounted when coverage is low (3/8 dimensions)');
});

test('ENGINE_VERSION is a stable semver-like string (deterministic, versioned scoring)', () => {
  assert.match(ENGINE_VERSION, /^\d+\.\d+\.\d+/);
});
