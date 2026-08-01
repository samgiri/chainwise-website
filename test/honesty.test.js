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
  ['index.html', 'research.html', 'dashboard.html', 'demo.html'].forEach((page) => {
    const html = read(page);
    assert.ok(!html.includes('dashboard?address='), `${page} must not link to /dashboard?address=<name> - the dashboard is address-only (0x contracts), not free-text protocol names`);
  });
});

test('the fabricated "Smart Solve DeFi" case study has been fully removed, not just relabeled', () => {
  const fs2 = fs;
  assert.ok(!fs2.existsSync(path.join(ROOT, 'case-smart-solve.html')), 'case-smart-solve.html must not exist on disk');

  const vercelConfig = read('vercel.json');
  assert.ok(!vercelConfig.includes('case-smart-solve'), 'vercel.json must not rewrite a route to the removed case page');

  const caseStudiesSrc = read('api/_lib/caseStudies.js');
  assert.ok(!/smart\s*solve/i.test(caseStudiesSrc.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')), 'the case-study data file must not define a Smart Solve DeFi entry outside of comments');

  ['index.html', 'research.html', 'case-detail.html', 'api/cases.js'].forEach((file) => {
    assert.ok(!/smart\s*solve/i.test(read(file)), `${file} must not reference Smart Solve DeFi`);
  });

  const homeIntro = read('index.html');
  assert.ok(!/\breal\b.{0,40}\blive\b|\blive case\b/i.test(homeIntro.slice(homeIntro.indexOf('id="research"'), homeIntro.indexOf('id="research"') + 2000)), 'the homepage research intro must not claim a real/live published case exists');
});

test('the MANTRA (OM) case study is real, sourced, and kept separate from the engine score', () => {
  const { CASE_STUDIES } = require('../api/_lib/caseStudies');
  const mantra = CASE_STUDIES.find((c) => c.slug === 'mantra-om-2025-collapse');
  assert.ok(mantra, 'the MANTRA case study must exist in CASE_STUDIES');
  assert.equal(mantra.isIllustrative, false, 'MANTRA must never be marked isIllustrative');
  assert.equal(mantra.isInvestigated, true, 'MANTRA must be marked isInvestigated');

  assert.ok(Array.isArray(mantra.sources) && mantra.sources.length >= 3, 'MANTRA must cite at least 3 sources');
  mantra.sources.forEach((s) => {
    assert.ok(/^https:\/\//.test(s.url), `source "${s.label}" must be a real https:// link, not a placeholder`);
  });

  const narrativeText = mantra.narrative.join(' ');
  assert.ok(!/\b(is|was|confirmed)\s+a\s+rug\s*pull\b/i.test(narrativeText), 'the narrative must not assert "rug pull" as settled fact');
  assert.ok(/den(y|ied|ies)/i.test(narrativeText), "MANTRA's denial/response must be included per the right-of-reply standard");
  assert.ok(/no regulator or independent forensic audit/i.test(narrativeText), 'the narrative must explicitly state no definitive finding exists yet');

  assert.ok(mantra.engineAnalysis && Array.isArray(mantra.engineAnalysis.dimensions) && mantra.engineAnalysis.dimensions.length === 8, 'the engine analysis must carry a real 8-dimension breakdown, not a placeholder');
  assert.ok(/not a verdict|not a forensic finding/i.test(mantra.engineAnalysis.note), 'the engine analysis must explicitly disclaim that it is not a verdict on the crash');

  assert.ok(fs.existsSync(path.join(ROOT, 'case-mantra-om.html')), 'case-mantra-om.html must exist');
  const vercelConfig = read('vercel.json');
  assert.ok(vercelConfig.includes('/case-mantra-om'), 'vercel.json must route /case-mantra-om to its page');

  ['index.html', 'research.html'].forEach((file) => {
    assert.ok(/isInvestigated/.test(read(file)), `${file} must render a distinct badge for investigated cases`);
  });
});

test('rate limiting and timeout handling exist for the analyze endpoint', () => {
  const src = read('api/analyze.js');
  assert.ok(src.includes('checkRateLimit'));
  assert.ok(src.includes("resultStatus: 'rate_limited'"));
  assert.ok(src.includes("resultStatus: 'timeout'"));
});
