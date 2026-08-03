const { test } = require('node:test');
const assert = require('node:assert/strict');
const { levelFromScore, computeDimensions, computeRoadmapDimensions, summarizeDimensions, ENGINE_VERSION } = require('../api/_lib/riskEngine');
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

test('computeDimensions returns exactly the 6 real, scored dimensions', () => {
  const onChain = {
    isContract: true, bytecode: '0x6080604052', codeSizeBytes: 10, balanceNative: 0, txCount: 0,
    blockNumber: 1000, proxyImplementation: null, proxyAdmin: null, ownerAddress: null, ownerIsContract: null,
  };
  const dims = computeDimensions({ onChain, verification: null, ownership: null, chainConfig, address, retrievedAt });
  assert.equal(dims.length, 6);
  assert.deepEqual(dims.map((d) => d.key).sort(), ['adminControls', 'governance', 'ownership', 'tokenRestrictions', 'upgradeability', 'verification'].sort());
});

test('computeRoadmapDimensions returns exactly the 2 permanent stubs, kept out of the scored set', () => {
  const roadmap = computeRoadmapDimensions();
  assert.equal(roadmap.length, 2);
  assert.deepEqual(roadmap.map((d) => d.key).sort(), ['exploitSignals', 'liquidity']);
  roadmap.forEach((d) => assert.equal(d.state, 'insufficient_data'));
});

test('computeDimensions never fabricates data for an EOA-shaped onChain fixture (not_applicable, not "safe")', () => {
  const onChain = {
    isContract: false, bytecode: '0x', codeSizeBytes: 0, balanceNative: 1, txCount: 4,
    blockNumber: 1000, proxyImplementation: null, proxyAdmin: null, ownerAddress: null, ownerIsContract: null,
  };
  const dims = computeDimensions({ onChain, verification: null, ownership: null, chainConfig, address, retrievedAt });
  const contractSpecific = dims.filter((d) => ['adminControls', 'upgradeability', 'governance', 'ownership'].includes(d.key));
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
  const dims = computeDimensions({ onChain, verification: null, ownership: null, chainConfig, address, retrievedAt });
  const alwaysInsufficient = ['ownership', 'tokenRestrictions', 'verification'];
  alwaysInsufficient.forEach((key) => {
    const dim = dims.find((d) => d.key === key);
    assert.equal(dim.state, 'insufficient_data', `${key} should be insufficient_data without a data source`);
    assert.equal(dim.subscore, null);
    assert.ok(dim.limitations.length > 0, `${key} must document why it is insufficient`);
  });
});

test('the 2 permanent-stub roadmap dimensions (liquidity, exploit signals) read as "not built yet," never as a per-contract error, and are never mixed into computeDimensions()', () => {
  const roadmap = computeRoadmapDimensions();
  ['liquidity', 'exploitSignals'].forEach((key) => {
    const dim = roadmap.find((d) => d.key === key);
    assert.match(dim.explanation, /roadmap gap, not an error/i);
    assert.ok(!/we could not gather enough information/i.test(dim.explanation), `${key} must not use the generic per-contract "couldn't gather evidence" wording`);
  });

  const onChain = {
    isContract: true, bytecode: '0x6080604052', codeSizeBytes: 10, balanceNative: 0, txCount: 0,
    blockNumber: 1000, proxyImplementation: null, proxyAdmin: null, ownerAddress: null, ownerIsContract: null,
  };
  const dims = computeDimensions({ onChain, verification: null, ownership: null, chainConfig, address, retrievedAt });
  assert.ok(!dims.some((d) => d.key === 'liquidity' || d.key === 'exploitSignals'), 'roadmap stubs must not appear in the scored dimensions array');
});

// --- Ownership & Wallet Concentration (real integration, not a stub) ------------------

const onChainContract = {
  isContract: true, bytecode: '0x6080604052', codeSizeBytes: 10, balanceNative: 0, txCount: 0,
  blockNumber: 1000, proxyImplementation: null, proxyAdmin: null, ownerAddress: null, ownerIsContract: null,
};
const onChainEOA = { ...onChainContract, isContract: false };

test('computeOwnershipConcentration is not_applicable for an EOA (no supply/holders to speak of)', () => {
  const dims = computeDimensions({ onChain: onChainEOA, verification: null, ownership: null, chainConfig, address, retrievedAt });
  const ownership = dims.find((d) => d.key === 'ownership');
  assert.equal(ownership.state, 'not_applicable');
  assert.equal(ownership.subscore, null);
});

test('computeOwnershipConcentration reports insufficient data (not a fabricated score) when no holder-list data is available - e.g. no ETHERSCAN_API_KEY or a free-tier key that cannot reach the Pro-only tokenholderlist endpoint', () => {
  const dims = computeDimensions({ onChain: onChainContract, verification: null, ownership: null, chainConfig, address, retrievedAt });
  const ownership = dims.find((d) => d.key === 'ownership');
  assert.equal(ownership.state, 'insufficient_data');
  assert.equal(ownership.subscore, null);
  assert.ok(ownership.limitations.some((l) => /Pro-tier/.test(l)));
});

test('computeOwnershipConcentration flags a real extreme-concentration case (LGNS/Origin on Polygon: ~60.7% held by one EOA) as elevated risk, using the same figures verified via GeckoTerminal', () => {
  const ownership = {
    totalSupply: 4070000000n, // ~4.07B LGNS total supply
    topHolders: [{ address: '0x1964ca90474b11ffd08af387b110ba6c96251bfc', quantity: '2470000000' }], // ~2.47B, the "ORIGIN" wallet
    topHolder: { address: '0x1964ca90474b11ffd08af387b110ba6c96251bfc', quantity: '2470000000' },
    topHolderIsContract: false,
  };
  const dims = computeDimensions({ onChain: onChainContract, verification: null, ownership, chainConfig, address, retrievedAt });
  const dim = dims.find((d) => d.key === 'ownership');
  assert.equal(dim.state, 'assessed');
  assert.equal(dim.subscore, 75, 'a single EOA holding >50% of supply must score in the elevated band');
  assert.equal(dim.level, 'elevated_risk_indicator');
  assert.match(dim.findings[0].summary, /60\.7%/);
  assert.match(dim.findings[0].summary, /is a wallet \(EOA\)/);
});

test('computeOwnershipConcentration does NOT flag the same high percentage as risky when the top holder is a contract (locked LP/staking/vesting), not a wallet', () => {
  const ownership = {
    totalSupply: 1000000n,
    topHolders: [{ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', quantity: '600000' }], // 60% held by a contract
    topHolder: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', quantity: '600000' },
    topHolderIsContract: true,
  };
  const dims = computeDimensions({ onChain: onChainContract, verification: null, ownership, chainConfig, address, retrievedAt });
  const dim = dims.find((d) => d.key === 'ownership');
  assert.equal(dim.state, 'assessed');
  assert.ok(dim.subscore <= 20, 'a contract-held (e.g. locked LP) balance must not score like an EOA holding the same share');
  assert.equal(dim.level, 'no_material_indicator');
});

test('computeOwnershipConcentration treats an all-burn-address holder list as insufficient data, not as "0% concentration"', () => {
  const ownership = {
    totalSupply: 1000000n,
    topHolders: [{ address: `0x${'0'.repeat(40)}`, quantity: '900000' }],
    topHolder: null,
    topHolderIsContract: null,
  };
  const dims = computeDimensions({ onChain: onChainContract, verification: null, ownership, chainConfig, address, retrievedAt });
  const dim = dims.find((d) => d.key === 'ownership');
  assert.equal(dim.state, 'insufficient_data');
  assert.equal(dim.subscore, null);
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

test('summarizeDimensions exposes worstDimensionScore as the max subscore, not the mean, so one severe layer cannot be averaged away', () => {
  const dims = [
    { key: 'a', state: 'assessed', subscore: 10, confidence: 90 },
    { key: 'b', state: 'assessed', subscore: 15, confidence: 90 },
    { key: 'c', state: 'assessed', subscore: 96, confidence: 90 },
    { key: 'd', state: 'assessed', subscore: 12, confidence: 90 },
    { key: 'e', state: 'insufficient_data', subscore: null, confidence: null },
  ];
  const summary = summarizeDimensions(dims);
  assert.equal(summary.worstDimensionScore, 96);
  assert.notEqual(summary.overallScore, summary.worstDimensionScore, 'the mean overallScore must differ from the worst-layer score in this mixed fixture');
  assert.ok(summary.overallScore < 66, 'sanity check: the averaged score would misleadingly read as LOW/MEDIUM');
});

test('ENGINE_VERSION is a stable semver-like string (deterministic, versioned scoring)', () => {
  assert.match(ENGINE_VERSION, /^\d+\.\d+\.\d+/);
});
