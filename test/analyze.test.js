const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// REQUEST_TIMEOUT_MS is read from process.env at require time, so set it before requiring.
process.env.ANALYZE_TIMEOUT_MS = '300';
delete require.cache[require.resolve('../api/analyze')];
const analyzeHandler = require('../api/analyze');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function mockReq({ query = {}, ip = '10.0.0.1' } = {}) {
  return { method: 'GET', query, headers: { 'x-forwarded-for': ip } };
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { return this; },
  };
  return res;
}

function jsonRpcMock(handlers) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    if (!(body.method in handlers)) {
      throw new Error(`Unexpected RPC method in test mock: ${body.method}`);
    }
    const handler = handlers[body.method];
    const outcome = typeof handler === 'function' ? handler(body.params) : handler;
    if (outcome instanceof Error) throw outcome;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result: outcome }) };
  };
}

const ZERO_SLOT = '0x' + '0'.repeat(64);
const VALID_ADDRESS = '0x1111111111111111111111111111111111111111';

test('empty address is rejected as invalid_address, never served from a demo dataset', async () => {
  const req = mockReq({ query: {}, ip: '10.0.0.2' });
  const res = mockRes();
  await analyzeHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.resultStatus, 'invalid_address');
  assert.equal(res.body.overallScore, null);
  assert.equal(res.body.demo, undefined, 'response must never carry a demo flag/dataset');
});

test('malformed 0x address is rejected', async () => {
  const req = mockReq({ query: { address: '0xnothex', chain: 'ethereum' }, ip: '10.0.0.3' });
  const res = mockRes();
  await analyzeHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.resultStatus, 'invalid_address');
});

test('well-formed address on an unsupported network is rejected', async () => {
  const req = mockReq({ query: { address: VALID_ADDRESS, chain: 'not-a-real-chain' }, ip: '10.0.0.4' });
  const res = mockRes();
  await analyzeHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.resultStatus, 'unsupported_network');
});

test('an EOA (no bytecode) is reported unsupported_contract, not scored', async () => {
  global.fetch = jsonRpcMock({
    eth_getCode: () => '0x',
    eth_getBalance: () => '0x0',
    eth_getTransactionCount: () => '0x1',
    eth_blockNumber: () => '0x64',
    eth_getStorageAt: () => ZERO_SLOT,
  });
  const req = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.5' });
  const res = mockRes();
  await analyzeHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.resultStatus, 'unsupported_contract');
  assert.equal(res.body.overallScore, null);
  assert.deepEqual(res.body.dimensions, []);
});

test('RPC total failure is reported as rpc_failure, never as a fabricated result', async () => {
  global.fetch = async () => { throw new Error('network down'); };
  const req = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.6' });
  const res = mockRes();
  await analyzeHandler(req, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.resultStatus, 'rpc_failure');
  assert.equal(res.body.overallScore, null);
});

test('a contract with no proxy/owner data and no explorer key yields insufficient_data, not a score', async () => {
  global.fetch = jsonRpcMock({
    eth_getCode: () => '0x6080604052',
    eth_getBalance: () => '0x0',
    eth_getTransactionCount: () => '0x0',
    eth_blockNumber: () => '0x64',
    eth_getStorageAt: () => ZERO_SLOT,
    eth_call: () => new Error('execution reverted'),
  });
  const req = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.7' });
  const res = mockRes();
  await analyzeHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.resultStatus, 'insufficient_data');
  assert.equal(res.body.overallScore, null);
  assert.ok(res.body.dimensions.length === 6, 'all 6 scored dimensions must still be reported, just honestly labeled');
  assert.ok(res.body.roadmapDimensions.length === 2, 'the 2 roadmap stubs (liquidity, exploitSignals) must be surfaced separately');
});

test('a contract with a detectable proxy + admin selectors + EOA owner produces a partial, evidence-linked result', async () => {
  global.fetch = jsonRpcMock({
    // Same bytecode returned for both the target contract and the owner-address lookup -
    // this test only cares that the pipeline resolves an owner and treats it as assessed,
    // not the specific EOA-vs-contract branch (that's covered at the unit level in
    // riskEngine.test.js).
    eth_getCode: () => '0x' + '00'.repeat(10) + '8456cb59' + 'deadbeef', // contains pause() selector
    eth_getBalance: () => '0x0',
    eth_getTransactionCount: () => '0x5',
    eth_blockNumber: () => '0x64',
    eth_getStorageAt: (params) => {
      // implementation slot returns a non-zero address, admin slot is zero
      const slot = params[1];
      if (slot === '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bb') {
        return '0x000000000000000000000000000000000000000000000000000000000000aaaa'.slice(0, 66);
      }
      return ZERO_SLOT;
    },
    eth_call: () => '0x000000000000000000000000000000000000000000000000000000000000bbbb'.slice(0, 66),
  });
  const req = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.8' });
  const res = mockRes();
  await analyzeHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.ok(['partial', 'success', 'insufficient_data'].includes(res.body.resultStatus));
  assert.ok(Array.isArray(res.body.evidence));
  if (res.body.resultStatus !== 'insufficient_data') {
    assert.ok(res.body.overallScore >= 0 && res.body.overallScore <= 100);
    assert.ok(res.body.overallScore < 90, 'weak Phase-1 evidence must never produce a CRITICAL (90+) score');
    res.body.evidence.forEach((ev) => {
      assert.ok(ev.retrievedAt, 'every evidence item must carry a retrieval timestamp');
      assert.ok(ev.contractAddress, 'every evidence item must be traceable to the analyzed contract');
    });
  }
});

test('ANALYZE_ENGINE_DISABLED=true takes the engine offline honestly instead of ever faking success', async () => {
  process.env.ANALYZE_ENGINE_DISABLED = 'true';
  try {
    const req = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.11' });
    const res = mockRes();
    await analyzeHandler(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.resultStatus, 'engine_unavailable');
    assert.equal(res.body.overallScore, null);
  } finally {
    delete process.env.ANALYZE_ENGINE_DISABLED;
  }
});

test('a repeated analysis for the same address is independent and reproducible (deterministic engine)', async () => {
  const fetchImpl = jsonRpcMock({
    eth_getCode: () => '0x' + '00'.repeat(10) + '8456cb59' + 'deadbeef',
    eth_getBalance: () => '0x0',
    eth_getTransactionCount: () => '0x5',
    eth_blockNumber: () => '0x64',
    eth_getStorageAt: () => ZERO_SLOT,
    eth_call: () => new Error('execution reverted'),
  });
  global.fetch = fetchImpl;
  const req1 = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.9' });
  const res1 = mockRes();
  await analyzeHandler(req1, res1);

  const req2 = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.10' });
  const res2 = mockRes();
  await analyzeHandler(req2, res2);

  assert.equal(res1.body.overallScore, res2.body.overallScore);
  assert.equal(res1.body.resultStatus, res2.body.resultStatus);
});

test('end-to-end: a token with extreme holder concentration (LGNS/Origin-shaped fixture) gets a real ownership dimension, not not_yet_integrated', async () => {
  const originalKey = process.env.ETHERSCAN_API_KEY;
  process.env.ETHERSCAN_API_KEY = 'test-key';
  const LGNS_ADDRESS = '0xeb51d9a39ad5eef215dc0bf39a8821ff804a0f01';
  const TOP_HOLDER = '0x1964ca90474b11ffd08af387b110ba6c96251bfc';

  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('api.etherscan.io')) {
      if (url.includes('action=getsourcecode')) {
        return { ok: true, json: async () => ({ status: '1', result: [{ SourceCode: '', ContractName: '', CompilerVersion: '', Proxy: '0' }] }) };
      }
      if (url.includes('action=tokensupply')) {
        return { ok: true, json: async () => ({ status: '1', result: '4070000000' }) };
      }
      if (url.includes('action=tokenholderlist')) {
        return { ok: true, json: async () => ({ status: '1', result: [{ TokenHolderAddress: TOP_HOLDER, TokenHolderQuantity: '2470000000' }] }) };
      }
      return { ok: true, json: async () => ({ status: '0', result: 'unexpected etherscan call in test' }) };
    }
    const body = JSON.parse(options.body);
    const handlers = {
      eth_getCode: (params) => (params[0].toLowerCase() === LGNS_ADDRESS.toLowerCase() ? '0x6080604052' : '0x'),
      eth_getBalance: () => '0x0',
      eth_getTransactionCount: () => '0x5',
      eth_blockNumber: () => '0x64',
      eth_getStorageAt: () => ZERO_SLOT,
      eth_call: () => new Error('execution reverted'), // no owner() exposed
    };
    if (!(body.method in handlers)) throw new Error(`Unexpected RPC method in test mock: ${body.method}`);
    const outcome = handlers[body.method](body.params);
    if (outcome instanceof Error) throw outcome;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result: outcome }) };
  };

  try {
    const req = mockReq({ query: { address: LGNS_ADDRESS, chain: 'polygon' }, ip: '10.0.0.12' });
    const res = mockRes();
    await analyzeHandler(req, res);

    assert.equal(res.statusCode, 200);
    const ownership = res.body.dimensions.find((d) => d.key === 'ownership');
    assert.ok(ownership, 'ownership dimension must be present');
    assert.equal(ownership.state, 'assessed', 'must be a real assessment, not not_yet_integrated/insufficient_data');
    assert.equal(ownership.subscore, 75, 'a ~60.7% EOA-held supply must land in the elevated-risk band');
    assert.equal(ownership.level, 'elevated_risk_indicator');
    assert.match(ownership.findings[0].summary, /60\.7%/);
  } finally {
    if (originalKey === undefined) delete process.env.ETHERSCAN_API_KEY;
    else process.env.ETHERSCAN_API_KEY = originalKey;
  }
});

// --- aiSummary: optional AI verdict layered on top of the deterministic result ------------

// Produces 3 assessed dimensions (adminControls, upgradeability, governance) with no
// ETHERSCAN_API_KEY needed at all, so resultStatus is 'partial' rather than
// 'insufficient_data' - enough for the aiSummary tests below to exercise the real
// aiSummary-attaching code path.
function basicRpcMock() {
  return jsonRpcMock({
    eth_getCode: (params) => (params[0].toLowerCase() === VALID_ADDRESS.toLowerCase()
      ? '0x' + '00'.repeat(10) + '8456cb59' + 'deadbeef' // contains pause()
      : '0x'), // owner() address - an EOA, no code
    eth_getBalance: () => '0x0',
    eth_getTransactionCount: () => '0x5',
    eth_blockNumber: () => '0x64',
    eth_getStorageAt: () => ZERO_SLOT,
    eth_call: () => '0x000000000000000000000000000000000000000000000000000000000000bbbb'.slice(0, 66),
  });
}

test('aiSummary: falls back to the template (aiGenerated: false) and still returns 200 when ANTHROPIC_API_KEY is not set', async () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  global.fetch = basicRpcMock();
  try {
    const req = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.13' });
    const res = mockRes();
    await analyzeHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.resultStatus, 'partial', '3 assessed dimensions (adminControls, upgradeability, governance) should produce a partial result');
    assert.ok(res.body.aiSummary, 'aiSummary must be present for a scored result');
    assert.equal(res.body.aiSummary.aiGenerated, false);
    assert.ok(res.body.aiSummary.text.length > 0);
  } finally {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  }
});

test('aiSummary: a real Claude success response (mocked Anthropic call) comes back as aiGenerated: true with the rest of the response intact and still 200', async () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('api.anthropic.com')) {
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'This contract shows some elevated risk indicators. This is automated preliminary screening, not a guarantee.' }] }) };
    }
    return basicRpcMock()(url, options);
  };
  try {
    const req = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.14' });
    const res = mockRes();
    await analyzeHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.aiSummary);
    assert.equal(res.body.aiSummary.aiGenerated, true);
    assert.match(res.body.aiSummary.text, /elevated risk indicators/);
    // everything else must be unaffected by the AI layer being present
    assert.ok(Array.isArray(res.body.dimensions) && res.body.dimensions.length === 6);
    assert.ok(typeof res.body.overallScore === 'number' || res.body.overallScore === null);
  } finally {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  }
});

test('aiSummary: an Anthropic API failure (mocked) falls back cleanly to the template and the request still returns 200 with no visible degradation', async () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('api.anthropic.com')) {
      return { ok: false, status: 529, json: async () => ({ error: { message: 'overloaded_error' } }) };
    }
    return basicRpcMock()(url, options);
  };
  try {
    const req = mockReq({ query: { address: VALID_ADDRESS, chain: 'ethereum' }, ip: '10.0.0.15' });
    const res = mockRes();
    await analyzeHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.aiSummary);
    assert.equal(res.body.aiSummary.aiGenerated, false);
    assert.ok(res.body.aiSummary.text.length > 0);
    assert.ok(Array.isArray(res.body.dimensions) && res.body.dimensions.length === 6);
  } finally {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  }
});
