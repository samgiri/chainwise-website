// Unit tests for api/_lib/holders.js - the Etherscan-V2-backed token-supply/holder-list
// fetch layer behind the Ownership & Wallet Concentration dimension. Every failure path
// (no API key, free-tier key rejected from the Pro-only tokenholderlist endpoint, timeout,
// malformed response) must degrade to null/insufficient data, never to a guessed number.

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { fetchTokenSupply, fetchTopHolders, fetchOwnershipData } = require('../api/_lib/holders');
const { CHAIN_CONFIG } = require('../api/_lib/chains');

const chainConfig = { key: 'polygon', ...CHAIN_CONFIG.polygon };
const address = '0xeb51d9a39ad5eef215dc0bf39a8821ff804a0f01';

const originalFetch = global.fetch;
const originalKey = process.env.ETHERSCAN_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ETHERSCAN_API_KEY;
  else process.env.ETHERSCAN_API_KEY = originalKey;
});

test('fetchTokenSupply returns null (not a guess) when ETHERSCAN_API_KEY is not configured', async () => {
  delete process.env.ETHERSCAN_API_KEY;
  const result = await fetchTokenSupply(chainConfig, address);
  assert.equal(result, null);
});

test('fetchTopHolders returns null when the explorer rejects the Pro-only endpoint (free-tier key)', async () => {
  process.env.ETHERSCAN_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: '0', message: 'NOTOK', result: 'This endpoint requires a Pro subscription' }),
  });
  const result = await fetchTopHolders(chainConfig, address);
  assert.equal(result, null);
});

test('fetchTopHolders returns null on a network/timeout failure rather than throwing', async () => {
  process.env.ETHERSCAN_API_KEY = 'test-key';
  global.fetch = async () => { throw new Error('network down'); };
  const result = await fetchTopHolders(chainConfig, address);
  assert.equal(result, null);
});

test('fetchTopHolders parses a well-formed holder list', async () => {
  process.env.ETHERSCAN_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: '1',
      result: [
        { TokenHolderAddress: '0x1964CA90474b11FFD08aF387B110bA6C96251BFC', TokenHolderQuantity: '2470000000' },
        { TokenHolderAddress: '0xbbbb000000000000000000000000000000bbbb', TokenHolderQuantity: '100000000' },
      ],
    }),
  });
  const result = await fetchTopHolders(chainConfig, address);
  assert.equal(result.length, 2);
  assert.equal(result[0].address, '0x1964ca90474b11ffd08af387b110ba6c96251bfc');
  assert.equal(result[0].quantity, '2470000000');
});

test('fetchOwnershipData returns null end-to-end when the holder list is unavailable, even if supply succeeds', async () => {
  process.env.ETHERSCAN_API_KEY = 'test-key';
  global.fetch = async (url) => {
    if (url.includes('action=tokensupply')) {
      return { ok: true, json: async () => ({ status: '1', result: '4070000000' }) };
    }
    return { ok: true, json: async () => ({ status: '0', message: 'NOTOK', result: 'Pro subscription required' }) };
  };
  const result = await fetchOwnershipData(chainConfig, address);
  assert.equal(result, null);
});

test('fetchOwnershipData resolves the top non-burn holder and checks whether it is a contract via RPC', async () => {
  process.env.ETHERSCAN_API_KEY = 'test-key';
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('action=tokensupply')) {
      return { ok: true, json: async () => ({ status: '1', result: '4070000000' }) };
    }
    if (typeof url === 'string' && url.includes('action=tokenholderlist')) {
      return {
        ok: true,
        json: async () => ({
          status: '1',
          result: [
            { TokenHolderAddress: `0x${'0'.repeat(40)}`, TokenHolderQuantity: '500000000' }, // burn - must be skipped
            { TokenHolderAddress: '0x1964ca90474b11ffd08af387b110ba6c96251bfc', TokenHolderQuantity: '2470000000' },
          ],
        }),
      };
    }
    // JSON-RPC eth_getCode call for the contract-check
    const body = JSON.parse(opts.body);
    assert.equal(body.method, 'eth_getCode');
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0x' }) }; // EOA, no code
  };
  const result = await fetchOwnershipData(chainConfig, address);
  assert.ok(result);
  assert.equal(result.topHolder.address, '0x1964ca90474b11ffd08af387b110ba6c96251bfc');
  assert.equal(result.topHolderIsContract, false);
  assert.equal(result.totalSupply, 4070000000n);
});
