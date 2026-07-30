// Verifies the dashboard has no dead internal links (the audit's original complaint: ~13
// dead footer anchors plus a broken /#cases nav link). Every href is checked against either
// an id present on the target page, an existing file in the repo, or an allowed external
// scheme (https:, mailto:).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function extractHrefs(html) {
  const hrefs = [];
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) hrefs.push(m[1]);
  return hrefs;
}

function pageHasId(relPath, id) {
  const html = readFile(relPath);
  return new RegExp(`id=["']${id}["']`).test(html);
}

function checkHref(href) {
  if (href.startsWith('https://') || href.startsWith('http://') || href.startsWith('mailto:') || href.startsWith('data:')) {
    return { ok: true };
  }
  if (href === '#' || href === '') {
    return { ok: false, reason: 'placeholder "#" link with no real destination' };
  }

  let filePart = href;
  let hash = null;
  const hashIndex = href.indexOf('#');
  if (hashIndex !== -1) {
    filePart = href.slice(0, hashIndex);
    hash = href.slice(hashIndex + 1);
  }

  // Same-page anchor (no file part): must exist as an id on this page - caller checks that.
  if (!filePart) return { ok: true, hash, samePage: true };

  // Resolve a path like "/about.html" or "/dashboard" against known static routes.
  let resolved = filePart;
  if (resolved === '/') resolved = '/index.html';
  if (resolved === '/dashboard') resolved = '/dashboard.html';
  if (resolved === '/dashboard/demo') resolved = '/demo.html';
  if (resolved === '/research') resolved = '/research.html';

  const localPath = path.join(ROOT, resolved.replace(/^\//, ''));
  if (!fs.existsSync(localPath)) {
    return { ok: false, reason: `target file does not exist: ${resolved}` };
  }
  if (hash) {
    const targetHtml = fs.readFileSync(localPath, 'utf8');
    if (!new RegExp(`id=["']${hash}["']`).test(targetHtml)) {
      return { ok: false, reason: `no element with id="${hash}" in ${resolved}` };
    }
  }
  return { ok: true };
}

['dashboard.html', 'demo.html'].forEach((page) => {
  test(`${page} has no dead internal links`, () => {
    const html = readFile(page);
    const hrefs = extractHrefs(html).filter((h) => !h.startsWith('javascript:'));
    const failures = [];
    hrefs.forEach((href) => {
      const result = checkHref(href);
      if (!result.ok) {
        failures.push(`${href} -> ${result.reason}`);
      } else if (result.samePage && !pageHasId(page, result.hash)) {
        failures.push(`${href} -> no id="${result.hash}" on ${page} itself`);
      }
    });
    assert.deepEqual(failures, [], `Dead/broken links found in ${page}:\n${failures.join('\n')}`);
  });
});

test('dashboard nav "Cases" link points to the real homepage section id ("research"), not the old broken "#cases"', () => {
  const html = readFile('dashboard.html');
  assert.ok(html.includes('href="/#research"'), 'expected the Cases nav link to target /#research');
  assert.ok(!/href="\/?#cases"/.test(html), 'the old broken /#cases link must not remain');
});

test('dashboard footer no longer claims "Enterprise-Grade Security"', () => {
  const html = readFile('dashboard.html');
  assert.ok(!html.includes('Enterprise-Grade Security'));
});

test('dashboard footer copyright is updated to 2026 ChainWise Research', () => {
  const html = readFile('dashboard.html');
  assert.ok(html.includes('© 2026 ChainWise Research'));
  assert.ok(!html.includes('© 2024'));
});

test('demo.html carries a noindex meta tag', () => {
  const html = readFile('demo.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
});
