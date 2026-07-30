// Regression tests for the specific issues from the dashboard audit: fixed demo data
// auto-loading, the Chart.js "Chart is not defined" error, stale copy, and secret exposure
// in client-served files.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('dashboard.html no longer auto-calls the analyze API on page load', () => {
  const js = read('assets/dashboard.js');
  assert.ok(!/^\s*analyzeProtocol\(\);?\s*$/m.test(js));

  // The "Init" section (chain tabs render + validation UI) must not call runAnalysis/fetch
  // unconditionally - only the form submit handler and retry callbacks may.
  const initSection = js.slice(js.indexOf('// --- Init'), js.indexOf('// --- Newsletter modal'));
  assert.ok(!initSection.includes('runAnalysis('), 'the init section must not call runAnalysis() unconditionally at load');
  assert.ok(!initSection.includes('fetch('), 'the init section must not call the network unconditionally at load');
});

test('dashboard.html does not load Chart.js from a CDN (the source of "Chart is not defined")', () => {
  const html = read('dashboard.html');
  assert.ok(!/chart\.js|chart\.min\.js|cdnjs\.cloudflare\.com/i.test(html));
});

test('dashboard.html no longer asks for "protocol address or name" for an address-only EVM form', () => {
  const html = read('dashboard.html');
  assert.ok(!/address or name/i.test(html));
  assert.ok(html.includes('Enter an EVM smart-contract address'));
});

test('export button is renamed from "Download Report (JSON)" to "Export Assessment"', () => {
  const js = read('assets/dashboard.js');
  assert.ok(!js.includes('Download Report'));
  assert.ok(js.includes('Export Assessment'));
});

test('dashboard shows a Beta badge and the required disclaimer text', () => {
  const html = read('dashboard.html');
  assert.ok(html.includes('beta-badge'));
  assert.ok(html.includes('This is not a full smart-contract audit, financial advice, or a legal declaration that a protocol is fraudulent or safe.'));
});

test('the old fixed demo figures (score 95, Smart Solve DeFi, $100M+, 15,000 users, <24h) are not wired into the live engine', () => {
  const analyzeSrc = read('api/analyze.js');
  const riskEngineSrc = read('api/_lib/riskEngine.js');
  ['95', 'Smart Solve DeFi', '$100M', '15000', '15,000'].forEach((needle) => {
    assert.ok(!analyzeSrc.includes(needle), `api/analyze.js must not reference "${needle}"`);
    assert.ok(!riskEngineSrc.includes(needle), `api/_lib/riskEngine.js must not reference "${needle}"`);
  });
  assert.ok(!analyzeSrc.includes('usersAtRisk'));
  assert.ok(!analyzeSrc.includes('estimatedLoss'));
  assert.ok(!analyzeSrc.includes('collapseTimelineDays'));
  assert.ok(!analyzeSrc.includes('detectionHours'));
});

test('api/analyze.js has no shortcut that serves a fixed dataset for an empty/name query', () => {
  const src = read('api/analyze.js');
  assert.ok(!/smart\s*solve/i.test(src), 'the free-text "smart solve" name-match shortcut must be removed');
  assert.ok(!src.includes('caseStudies'), 'analyze.js must not import the case-study demo dataset at all');
});

test('no server-side secret env var names leak into client-served files', () => {
  const clientFiles = ['dashboard.html', 'demo.html', 'assets/dashboard.js', 'assets/dashboard.css'];
  const secretPatterns = [/ANTHROPIC_API_KEY/, /ETHERSCAN_API_KEY/, /KV_REST_API_TOKEN/, /sk-ant-/, /\bsk-[a-zA-Z0-9]{20,}/];
  clientFiles.forEach((file) => {
    const content = read(file);
    secretPatterns.forEach((pattern) => {
      assert.ok(!pattern.test(content), `${file} must not reference ${pattern}`);
    });
  });
});

test('the result meta grid cannot overlap: address gets its own full-width row and long values wrap', () => {
  const css = read('assets/dashboard.css');
  assert.match(css, /\.meta-item\s*\{[^}]*min-width:\s*0/, 'grid items must be able to shrink (min-width: 0) instead of overflowing into neighbors');
  assert.match(css, /\.meta-item\.meta-item-wide\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/, 'the wide meta item must span the full grid row');
  assert.match(css, /\.address-copy-row code\s*\{[^}]*overflow-wrap:\s*anywhere/, 'the address itself must wrap instead of overflowing');

  const js = read('assets/dashboard.js');
  assert.match(js, /metaItem\('Contract Address',\s*null,\s*addressRow,\s*true\)/, 'the Contract Address meta item must be marked wide');

  const demoHtml = read('demo.html');
  assert.ok(demoHtml.includes('class="meta-item meta-item-wide"'), 'demo.html must apply the same full-width fix to its static Contract Address item');
});

test('no page links to the dashboard with a stale free-text ?address= param', () => {
  ['index.html', 'research.html', 'case-smart-solve.html', 'dashboard.html', 'demo.html'].forEach((page) => {
    const html = read(page);
    assert.ok(!html.includes('dashboard?address='), `${page} must not link to /dashboard?address=<name> - the dashboard is address-only (0x contracts), not free-text protocol names`);
  });
});

test('rate limiting and timeout handling exist for the analyze endpoint', () => {
  const src = read('api/analyze.js');
  assert.ok(src.includes('checkRateLimit'));
  assert.ok(src.includes("resultStatus: 'rate_limited'"));
  assert.ok(src.includes("resultStatus: 'timeout'"));
});
