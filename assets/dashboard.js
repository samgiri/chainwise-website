(function () {
  'use strict';

  // Mirrors api/_lib/chains.js. Duplicated here (rather than shared) because this is a
  // static site with no build step - this list must be kept in sync with the backend
  // CHAIN_CONFIG by hand. `status` drives which networks are selectable; it is never
  // used to imply a network works when it doesn't.
  var NETWORKS = [
    { key: 'ethereum', label: 'Ethereum', icon: 'ethereum.png', status: 'beta' },
    { key: 'polygon', label: 'Polygon', icon: 'polygon.png', status: 'beta' },
    { key: 'arbitrum', label: 'Arbitrum', icon: 'arbitrum.png', status: 'beta' },
    { key: 'optimism', label: 'Optimism', icon: 'optimism.png', status: 'beta' },
    { key: 'base', label: 'Base', icon: 'base.png', status: 'beta' },
    { key: 'zksync', label: 'zkSync', icon: 'zksync.png', status: 'beta' },
    { key: 'bsc', label: 'BNB Chain', icon: 'bsc.png', status: 'beta' },
    { key: 'avalanche', label: 'Avalanche', icon: 'avalanche.png', status: 'beta' },
  ];

  var STATUS_LABEL = { live: 'Live', beta: 'Beta', coming_soon: 'Coming soon', unavailable: 'Unavailable' };
  var OPERATIONAL_STATUSES = ['live', 'beta'];

  var ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

  var LOADING_STAGES = [
    'Validating address',
    'Connecting to network',
    'Retrieving contract data',
    'Checking contract structure',
    'Evaluating risk indicators',
    'Preparing assessment',
  ];

  var DIMENSION_ORDER = [
    'verification', 'adminControls', 'upgradeability', 'tokenRestrictions',
    'liquidity', 'ownership', 'governance', 'exploitSignals',
  ];

  var LEVEL_BADGE_CLASS = {
    no_material_indicator: 'no_material_indicator',
    review_recommended: 'review_recommended',
    elevated_risk_indicator: 'elevated_risk_indicator',
    critical_risk_indicator: 'critical_risk_indicator',
  };

  var CLIENT_TIMEOUT_MS = 25000;

  var selectedChain = 'ethereum';
  var lastResult = null;
  var stageTimer = null;
  var abortController = null;

  var chainTabsEl = document.getElementById('chainTabs');
  var addressInput = document.getElementById('addressInput');
  var addressValidation = document.getElementById('addressValidation');
  var analyzeBtn = document.getElementById('analyzeBtn');
  var analyzeForm = document.getElementById('analyzeForm');
  var resultArea = document.getElementById('resultArea');

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'html') node.innerHTML = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  // --- Step 1: chain selector -------------------------------------------------------

  function renderChainTabs() {
    chainTabsEl.innerHTML = '';
    NETWORKS.forEach(function (net) {
      var operational = OPERATIONAL_STATUSES.indexOf(net.status) !== -1;
      var btn = el('button', {
        type: 'button',
        class: 'chain-tab' + (net.key === selectedChain ? ' active' : ''),
        role: 'radio',
        'aria-checked': net.key === selectedChain ? 'true' : 'false',
        'aria-label': net.label + ', status: ' + STATUS_LABEL[net.status],
        'data-chain': net.key,
      });
      if (!operational) {
        btn.disabled = true;
        btn.title = net.label + ' is currently ' + STATUS_LABEL[net.status].toLowerCase() + '.';
      }
      var nameRow = el('span', { class: 'chain-tab-name' }, [
        el('img', { class: 'chain-tab-icon', src: './assets/chains/' + net.icon, alt: '' }),
        el('span', { text: net.label }),
      ]);
      var statusEl = el('span', { class: 'chain-tab-status', text: STATUS_LABEL[net.status] });
      btn.appendChild(nameRow);
      btn.appendChild(statusEl);
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        selectChain(net.key);
      });
      chainTabsEl.appendChild(btn);
    });
  }

  function selectChain(chainKey) {
    selectedChain = chainKey;
    Array.prototype.forEach.call(chainTabsEl.querySelectorAll('.chain-tab'), function (tab) {
      var isActive = tab.dataset.chain === chainKey;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  // --- Step 2: address validation ---------------------------------------------------

  function validateAddress(raw) {
    var trimmed = (raw || '').trim();
    if (!trimmed) return { valid: false, message: '' };
    if (!/^0x/i.test(trimmed)) {
      return { valid: false, message: 'A contract address must start with 0x.' };
    }
    if (!ADDRESS_REGEX.test(trimmed)) {
      return { valid: false, message: 'That doesn’t look like a valid contract address. It should be 0x followed by exactly 40 hexadecimal characters.' };
    }
    return { valid: true, message: 'Looks like a valid address format.', value: trimmed };
  }

  function updateValidationUI() {
    var raw = addressInput.value;
    var trimmed = raw.trim();
    if (raw !== trimmed && document.activeElement !== addressInput) {
      addressInput.value = trimmed;
    }
    var result = validateAddress(addressInput.value);
    addressValidation.textContent = result.message;
    addressValidation.className = 'validation-message' + (result.value ? ' valid' : (addressInput.value.trim() ? ' invalid' : ''));
    addressInput.setAttribute('aria-invalid', (!result.valid && addressInput.value.trim()) ? 'true' : 'false');
    analyzeBtn.disabled = !result.valid;
    return result;
  }

  addressInput.addEventListener('input', updateValidationUI);
  addressInput.addEventListener('blur', function () {
    addressInput.value = addressInput.value.trim();
    updateValidationUI();
  });

  // --- Loading stage list -------------------------------------------------------------

  function renderLoadingState() {
    var list = el('ul', { class: 'stage-list', 'aria-live': 'polite' },
      LOADING_STAGES.map(function (label, i) {
        return el('li', { class: 'stage-item', 'data-stage': String(i) }, [
          el('span', { class: 'stage-dot', 'aria-hidden': 'true' }),
          el('span', { text: label }),
        ]);
      })
    );
    var wrap = el('div', { class: 'loading-state', role: 'status' }, [
      el('h2', { text: 'Analyzing contract…' }),
      list,
      el('p', { class: 'loading-timeout-note', text: 'This usually takes a few seconds. If a network is slow to respond, this can take longer.' }),
    ]);
    resultArea.innerHTML = '';
    resultArea.appendChild(wrap);

    var stageIndex = 0;
    var items = list.querySelectorAll('.stage-item');
    function advance() {
      items.forEach(function (item, i) {
        item.classList.toggle('done', i < stageIndex);
        item.classList.toggle('active', i === stageIndex);
      });
      if (stageIndex < items.length - 1) stageIndex += 1;
    }
    advance();
    stageTimer = setInterval(advance, 1100);
  }

  function stopLoadingStages(markAllDone) {
    if (stageTimer) {
      clearInterval(stageTimer);
      stageTimer = null;
    }
    if (markAllDone) {
      var items = resultArea.querySelectorAll('.stage-item');
      items.forEach(function (item) {
        item.classList.remove('active');
        item.classList.add('done');
      });
    }
  }

  // --- Generic banner states (errors / insufficient data) ----------------------------

  var STATE_COPY = {
    invalid_address: { title: 'Invalid address', tone: 'error', message: function (m) { return m; } },
    unsupported_network: { title: 'Unsupported network', tone: 'error', message: function (m) { return m; } },
    unsupported_contract: { title: 'Not a contract', tone: 'neutral', message: function () { return 'This address has no deployed contract bytecode — it looks like a regular wallet (EOA), not a smart contract.'; } },
    rate_limited: { title: 'Too many requests', tone: 'error', message: function (m) { return m; } },
    rpc_failure: { title: 'Network unreachable', tone: 'error', message: function (m) { return m; } },
    timeout: { title: 'Analysis timed out', tone: 'error', message: function (m) { return m; } },
    engine_unavailable: { title: 'Analysis engine unavailable', tone: 'neutral', message: function () { return 'The analysis engine integration is currently unavailable. Please try again later.'; } },
    internal_error: { title: 'Something went wrong', tone: 'error', message: function (m) { return m; } },
    insufficient_data: { title: 'Insufficient evidence', tone: 'neutral', message: function () { return 'We couldn’t gather enough information to assess this contract.'; } },
    network_error: { title: 'Could not reach ChainWise', tone: 'error', message: function (m) { return m; } },
  };

  function renderBanner(resultStatus, message, opts) {
    opts = opts || {};
    var copy = STATE_COPY[resultStatus] || STATE_COPY.internal_error;
    var banner = el('div', { class: 'state-banner ' + copy.tone, role: 'alert' }, [
      el('h2', { text: copy.title }),
      el('p', { text: copy.message(message) }),
    ]);
    if (resultStatus === 'insufficient_data') {
      banner.appendChild(el('p', { class: 'action-note', text: 'Never treat "no data" as "safe" — it means we don’t know, not that it’s fine.' }));
    }
    if (opts.retry) {
      var retryBtn = el('button', { type: 'button', class: 'retry-btn', text: 'Retry' });
      retryBtn.addEventListener('click', opts.retry);
      banner.appendChild(retryBtn);
    }
    resultArea.innerHTML = '';
    resultArea.appendChild(banner);
  }

  // --- Result rendering ----------------------------------------------------------------

  function dimensionLabel(key) {
    var map = {
      verification: 'Contract Verification & Transparency',
      adminControls: 'Privileged Access & Admin Controls',
      upgradeability: 'Upgradeability & Proxy Risk',
      tokenRestrictions: 'Token & Transaction Restrictions',
      liquidity: 'Liquidity & Market Structure',
      ownership: 'Ownership & Wallet Concentration',
      governance: 'Governance & Operational Controls',
      exploitSignals: 'Exploit, Anomaly & External Signals',
    };
    return map[key] || key;
  }

  function badgeClassFor(dim) {
    if (dim.state === 'assessed') return LEVEL_BADGE_CLASS[dim.level] || 'insufficient';
    return dim.state === 'not_applicable' ? 'not_applicable' : 'insufficient';
  }

  function renderDimensionCard(dim) {
    var badgeClass = badgeClassFor(dim);
    var head = el('div', { class: 'dimension-card-head' }, [
      el('div', { class: 'dimension-name', text: dim.name }),
      el('span', { class: 'dimension-badge ' + badgeClass, text: dim.levelLabel }),
    ]);
    var card = el('div', { class: 'dimension-card' }, [head]);

    if (dim.state === 'assessed') {
      var barFill = el('div', { class: 'dimension-bar-fill' }, [
        el('div', { class: 'dimension-bar-progress', style: 'width:' + dim.subscore + '%' }),
      ]);
      card.appendChild(barFill);
      card.appendChild(el('p', { class: 'dimension-confidence', text: 'Confidence: ' + dim.confidence + '% · Last checked ' + new Date(dim.lastChecked).toLocaleString() }));
    }
    card.appendChild(el('p', { class: 'dimension-explanation', text: dim.explanation }));

    if (dim.findings && dim.findings.length) {
      var details = el('details', {}, []);
      details.appendChild(el('summary', { text: 'Findings & evidence (' + dim.findings.length + ')' }));
      dim.findings.forEach(function (f) {
        var item = el('div', { class: 'finding-item' }, [el('div', { text: f.summary })]);
        if (f.evidence) {
          var ev = f.evidence;
          var line = 'Source: ' + (ev.dataSource || ev.type || 'on-chain data');
          if (ev.blockNumber) line += ' · Block #' + ev.blockNumber;
          if (ev.retrievedAt) line += ' · Retrieved ' + new Date(ev.retrievedAt).toLocaleString();
          var evLine = el('div', { class: 'evidence-line', text: line });
          if (ev.explorerUrl) {
            evLine.appendChild(document.createTextNode(' · '));
            evLine.appendChild(el('a', { href: ev.explorerUrl, target: '_blank', rel: 'noopener', text: 'View on explorer' }));
          }
          item.appendChild(evLine);
        }
        details.appendChild(item);
      });
      card.appendChild(details);
    }

    if (dim.limitations && dim.limitations.length) {
      card.appendChild(el('p', { class: 'dimension-limitations', text: 'Known limitation: ' + dim.limitations.join(' ') }));
    }

    return card;
  }

  function buildDimensionChartSvg(dimensions) {
    var width = 640;
    var rowHeight = 34;
    var height = dimensions.length * rowHeight + 10;
    var labelWidth = 260;
    var barMaxWidth = width - labelWidth - 60;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'chart-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-hidden', 'true');

    dimensions.forEach(function (dim, i) {
      var y = i * rowHeight + rowHeight / 2;
      var hasScore = dim.state === 'assessed';
      var pct = hasScore ? dim.subscore : 0;
      var barWidth = Math.max(2, (pct / 100) * barMaxWidth);

      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', '0');
      label.setAttribute('y', y + 4);
      label.setAttribute('fill', '#a0a8c8');
      label.setAttribute('font-size', '12');
      label.textContent = dim.name.length > 34 ? dim.name.slice(0, 33) + '…' : dim.name;
      svg.appendChild(label);

      var track = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      track.setAttribute('x', String(labelWidth));
      track.setAttribute('y', String(y - 6));
      track.setAttribute('width', String(barMaxWidth));
      track.setAttribute('height', '12');
      track.setAttribute('rx', '6');
      track.setAttribute('fill', '#1a1f3a');
      svg.appendChild(track);

      var bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bar.setAttribute('x', String(labelWidth));
      bar.setAttribute('y', String(y - 6));
      bar.setAttribute('width', String(hasScore ? barWidth : 6));
      bar.setAttribute('height', '12');
      bar.setAttribute('rx', '6');
      bar.setAttribute('fill', hasScore ? 'url(#dashGrad)' : '#3a4066');
      if (!hasScore) bar.setAttribute('stroke-dasharray', '3,3');
      svg.appendChild(bar);

      var valueText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valueText.setAttribute('x', String(labelWidth + barMaxWidth + 8));
      valueText.setAttribute('y', y + 4);
      valueText.setAttribute('fill', '#a0a8c8');
      valueText.setAttribute('font-size', '11');
      valueText.textContent = hasScore ? String(dim.subscore) : 'n/a';
      svg.appendChild(valueText);
    });

    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = '<linearGradient id="dashGrad" x1="0%" y1="0%" x2="100%" y2="0%">'
      + '<stop offset="0%" stop-color="#f7931a"/><stop offset="100%" stop-color="#7b3fe4"/></linearGradient>';
    svg.insertBefore(defs, svg.firstChild);

    return svg;
  }

  function tierFromScore(score) {
    if (score === null || score === undefined) return { color: 'var(--color-unknown)', tier: 'NOT ANALYZED' };
    if (score <= 33) return { color: 'var(--color-success)', tier: 'LOW' };
    if (score <= 66) return { color: 'var(--color-warning)', tier: 'MEDIUM' };
    if (score <= 89) return { color: 'var(--color-accent-orange)', tier: 'HIGH' };
    return { color: 'var(--color-critical)', tier: 'CRITICAL' };
  }

  // Same LOW/MEDIUM/HIGH/CRITICAL legend shown on the homepage's Research & Case Studies
  // section, reused here so a result can be read without leaving the dashboard page.
  function buildRiskLegend() {
    return el('div', { class: 'risk-legend' }, [
      el('div', { class: 'risk-legend-bar' }),
      el('div', { class: 'risk-legend-labels' }, [
        el('span', {}, [el('span', { class: 'dot', style: 'background:var(--color-success);' }), document.createTextNode('LOW 0–33')]),
        el('span', {}, [el('span', { class: 'dot', style: 'background:var(--color-warning);' }), document.createTextNode('MEDIUM 34–66')]),
        el('span', {}, [el('span', { class: 'dot', style: 'background:var(--color-accent-orange);' }), document.createTextNode('HIGH 67–89')]),
        el('span', {}, [el('span', { class: 'dot', style: 'background:var(--color-critical);' }), document.createTextNode('CRITICAL 90–100')]),
      ]),
      el('p', { class: 'risk-legend-caption', text: 'Scores are directional risk indicators, not guarantees — always verify independently.' }),
    ]);
  }

  // --- Top flags: plain-language translation of the most severe findings --------------

  var FLAG_TEMPLATES = {
    verification: function (dim) {
      var verified = /is verified/.test((dim.findings[0] || {}).summary || '');
      if (verified) return null;
      return 'This contract’s source code is not publicly verified, so nobody can independently check what it actually does.';
    },
    adminControls: function (dim) {
      var count = dim.findings.length;
      if (count === 0) return null;
      return 'The contract gives its admin ' + count + ' privileged function' + (count > 1 ? 's' : '') + ' (like pause or mint) that can directly affect user funds.';
    },
    upgradeability: function (dim) {
      if (dim.level === 'no_material_indicator') return null;
      return 'This contract’s logic can be swapped out after deployment — what you see today may not be what runs tomorrow.';
    },
    tokenRestrictions: function (dim) {
      if (dim.findings.length === 0) return null;
      return 'The contract code contains patterns that could restrict how you buy, sell, or transfer this token.';
    },
    governance: function (dim) {
      var summary = (dim.findings[0] || {}).summary || '';
      if (/wallet with no contract code/.test(summary)) {
        return 'A single private-key wallet — not a multisig — has full administrative control over this contract.';
      }
      return null;
    },
  };

  function buildTopFlags(dimensions) {
    var flags = (dimensions || [])
      .filter(function (d) { return d.state === 'assessed'; })
      .map(function (d) {
        var templateFn = FLAG_TEMPLATES[d.key];
        var text = templateFn ? templateFn(d) : null;
        return text ? { subscore: d.subscore, text: text } : null;
      })
      .filter(Boolean)
      .sort(function (a, b) { return b.subscore - a.subscore; })
      .slice(0, 3);
    return flags;
  }

  function renderTopFlagsCard(dimensions) {
    var flags = buildTopFlags(dimensions);
    if (!flags.length) return null;
    var list = el('ul', { class: 'top-flags-list' }, flags.map(function (f) {
      return el('li', { class: 'top-flags-item', text: f.text });
    }));
    return el('div', { class: 'result-card top-flags-card' }, [
      el('h3', { text: 'Top Flags' }),
      list,
    ]);
  }

  function copyToClipboard(text, btn) {
    var done = function () {
      var original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = original; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* no-op */ }
    document.body.removeChild(ta);
    done();
  }

  function renderResult(data) {
    lastResult = data;
    resultArea.innerHTML = '';

    var statusPillClass = data.resultStatus === 'success' ? 'complete' : data.resultStatus === 'partial' ? 'partial' : 'insufficient';
    var verifiedName = null;
    (data.dimensions || []).forEach(function (d) {
      if (d.key === 'verification') {
        var f = (d.findings || [])[0];
        if (f && f.evidence && f.evidence.contractName) verifiedName = f.evidence.contractName;
      }
    });

    var header = el('div', { class: 'result-card' });
    var topRow = el('div', { class: 'result-header-top' }, [
      el('span', { class: 'status-pill ' + statusPillClass, text: data.assessmentStatus }),
    ]);
    header.appendChild(topRow);

    var addressRow = el('div', { class: 'address-copy-row' }, [
      el('code', { text: data.contractAddress }),
    ]);
    var copyBtn = el('button', { type: 'button', class: 'copy-btn', text: 'Copy' });
    copyBtn.addEventListener('click', function () { copyToClipboard(data.contractAddress, copyBtn); });
    addressRow.appendChild(copyBtn);
    if (data.explorerUrl) {
      addressRow.appendChild(el('a', { href: data.explorerUrl, target: '_blank', rel: 'noopener', class: 'explorer-link-btn', text: 'View on explorer ↗' }));
    }

    var metaGrid = el('div', { class: 'result-meta-grid' }, [
      metaItem('Contract Address', null, addressRow, true),
      metaItem('Network', data.network),
      metaItem('Verified Name', verifiedName || 'Not available'),
      metaItem('Analyzed At', new Date(data.analyzedAt).toLocaleString()),
      metaItem('Engine Version', data.engineVersion),
      metaItem('Data Freshness', data.dataFreshness === 'cached' ? 'Cached (up to 6h old)' : 'Live'),
      metaItem('Confidence', data.confidence + '%'),
    ]);
    header.appendChild(metaGrid);

    var scoreRow = el('div', { class: 'score-row' });
    if (data.overallScore !== null && data.overallScore !== undefined) {
      // The banner's tier/color is driven by the single highest-severity dimension, not the
      // mean overallScore - one critical-severity dimension must never be averaged down to a
      // reassuring headline. The number shown in the ring is still the overall score.
      var bannerScore = (data.worstDimensionScore !== null && data.worstDimensionScore !== undefined)
        ? data.worstDimensionScore
        : data.overallScore;
      var tier = tierFromScore(bannerScore);
      var ring = el('div', { class: 'risk-ring', style: '--ring-color:' + tier.color + ';--ring-pct:' + data.overallScore }, [
        el('div', { class: 'risk-ring-inner' }, [
          el('div', { class: 'risk-score', text: String(data.overallScore) }),
          el('div', { class: 'risk-label', style: 'color:' + tier.color, text: tier.tier }),
        ]),
      ]);
      scoreRow.appendChild(el('div', { class: 'risk-ring-wrap' }, [ring]));
      scoreRow.appendChild(el('div', { class: 'no-score-note', html: (data.resultStatus === 'partial'
        ? '<strong>Partial assessment.</strong> Only some risk dimensions had enough evidence to score — see below for what was and wasn’t assessed.'
        : 'This score reflects only the dimensions with enough evidence below — always review individual findings.') }));
    } else {
      scoreRow.appendChild(el('div', { class: 'no-score-note', html: '<strong>No score — insufficient evidence.</strong> We couldn’t gather enough information to assess this contract confidently. Never treat "no data" as "safe" — it means we don’t know, not that it’s fine.' }));
    }
    header.appendChild(scoreRow);

    if (data.overallScore !== null && data.overallScore !== undefined) {
      header.appendChild(buildRiskLegend());
    }

    header.appendChild(el('p', { class: 'result-disclaimer', text: 'Beta automated preliminary screening. This is not a full smart-contract audit, financial advice, or a legal declaration that a protocol is fraudulent or safe.' }));

    var exportBtn = el('button', { type: 'button', class: 'export-btn', id: 'exportBtn', text: '📄 Export Assessment' });
    exportBtn.disabled = !(data.resultStatus === 'success' || data.resultStatus === 'partial');
    exportBtn.addEventListener('click', function () { exportAssessment(data); });
    header.appendChild(exportBtn);

    if (data.resultStatus === 'success' || data.resultStatus === 'partial') {
      header.appendChild(el('div', { class: 'post-analysis-social' }, [
        el('span', { text: 'Follow for more risk research:' }),
        el('a', { href: 'https://twitter.com/chainwise', target: '_blank', rel: 'noopener', text: 'Follow Twitter' }),
        el('span', { text: '|' }),
        el('a', { href: 'https://medium.com/@chainwise', target: '_blank', rel: 'noopener', text: 'Follow Medium' }),
      ]));
    }

    resultArea.appendChild(header);

    var topFlagsCard = renderTopFlagsCard(data.dimensions);
    if (topFlagsCard) resultArea.appendChild(topFlagsCard);

    var orderedDims = (data.dimensions || []).slice().sort(function (a, b) {
      return DIMENSION_ORDER.indexOf(a.key) - DIMENSION_ORDER.indexOf(b.key);
    });

    if (orderedDims.length) {
      var chartCard = el('div', { class: 'chart-card' }, [
        el('h3', { text: 'Risk Dimension Overview' }),
        buildDimensionChartSvg(orderedDims),
      ]);
      resultArea.appendChild(chartCard);

      var dimSection = el('div', { class: 'dimensions-section' }, [
        el('h3', { text: 'The 8 Risk Dimensions' }),
      ]);
      var grid = el('div', { class: 'dimension-grid' });
      orderedDims.forEach(function (dim) { grid.appendChild(renderDimensionCard(dim)); });
      dimSection.appendChild(grid);
      resultArea.appendChild(dimSection);
    }

    if (data.limitations && data.limitations.length) {
      var limCard = el('div', { class: 'result-card' }, [
        el('h3', { text: 'Known Limitations', style: 'margin-bottom:0.75rem;font-size:1rem;' }),
      ]);
      var ul = el('ul', { style: 'padding-left:1.2rem;color:var(--color-text-secondary);font-size:0.85rem;' });
      data.limitations.forEach(function (l) { ul.appendChild(el('li', { text: l, style: 'margin-bottom:0.4rem;' })); });
      limCard.appendChild(ul);
      resultArea.appendChild(limCard);
    }

    if (!hasShownEngageModal && (data.resultStatus === 'success' || data.resultStatus === 'partial')) {
      hasShownEngageModal = true;
      openEngageModal();
    }
  }

  function metaItem(label, value, customValueNode, wide) {
    var valueNode = customValueNode || el('div', { class: 'meta-value', text: value });
    if (!customValueNode) valueNode.className = 'meta-value';
    return el('div', { class: 'meta-item' + (wide ? ' meta-item-wide' : '') }, [
      el('div', { class: 'meta-label', text: label }),
      valueNode,
    ]);
  }

  function exportAssessment(data) {
    var payload = {
      contractAddress: data.contractAddress,
      network: data.network,
      chainId: data.chainId,
      analyzedAt: data.analyzedAt,
      engineVersion: data.engineVersion,
      resultStatus: data.resultStatus,
      assessmentStatus: data.assessmentStatus,
      overallScore: data.overallScore,
      confidence: data.confidence,
      dimensions: data.dimensions,
      findings: data.findings,
      evidence: data.evidence,
      dataSources: data.dataSources,
      limitations: data.limitations,
      disclaimer: data.disclaimer,
      exportedAt: new Date().toISOString(),
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var safeName = (data.contractAddress || 'assessment').replace(/[^a-z0-9-_]+/gi, '_');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'chainwise-assessment-' + safeName + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // --- Submit flow ---------------------------------------------------------------------

  function runAnalysis() {
    var validation = validateAddress(addressInput.value);
    if (!validation.valid) {
      updateValidationUI();
      return;
    }

    renderLoadingState();

    if (abortController) abortController.abort();
    abortController = new AbortController();
    var timeoutHandle = setTimeout(function () { abortController.abort(); }, CLIENT_TIMEOUT_MS);

    var params = new URLSearchParams({ address: validation.value, chain: selectedChain });
    fetch('/api/analyze?' + params.toString(), { signal: abortController.signal })
      .then(function (response) {
        return response.json().then(function (data) { return { ok: response.ok, status: response.status, data: data }; });
      })
      .then(function (result) {
        clearTimeout(timeoutHandle);
        stopLoadingStages(true);
        var data = result.data;
        if (data.resultStatus === 'success' || data.resultStatus === 'partial' || data.resultStatus === 'insufficient_data' || data.resultStatus === 'unsupported_contract') {
          if (data.resultStatus === 'unsupported_contract') {
            renderBanner('unsupported_contract');
          } else if (data.resultStatus === 'insufficient_data' && (!data.dimensions || !data.dimensions.length)) {
            renderBanner('insufficient_data');
          } else {
            renderResult(data);
          }
        } else {
          var message = (data.errors && data.errors[0] && data.errors[0].message) || 'Analysis could not be completed.';
          renderBanner(data.resultStatus, message, { retry: runAnalysis });
        }
      })
      .catch(function (err) {
        clearTimeout(timeoutHandle);
        stopLoadingStages(false);
        if (err.name === 'AbortError') {
          renderBanner('timeout', 'The request took too long and was cancelled.', { retry: runAnalysis });
        } else {
          renderBanner('network_error', 'Could not reach the ChainWise analysis API. Check your connection and try again.', { retry: runAnalysis });
        }
      });
  }

  analyzeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (analyzeBtn.disabled) return;
    runAnalysis();
  });

  // --- Init ------------------------------------------------------------------------------

  renderChainTabs();
  var urlChain = (new URLSearchParams(window.location.search).get('chain') || '').toLowerCase();
  var match = NETWORKS.filter(function (n) { return n.key === urlChain && OPERATIONAL_STATUSES.indexOf(n.status) !== -1; })[0];
  if (match) selectChain(match.key);
  updateValidationUI();

  // --- Newsletter modal (unrelated to analysis engine) ------------------------------------

  var hasShownEngageModal = false;

  (function () {
    var modal = document.getElementById('engageModal');
    var closeBtn = document.getElementById('engageModalClose');
    var form = document.getElementById('engageForm');
    var emailInput = document.getElementById('engageEmail');
    var mobileInput = document.getElementById('engageMobile');
    var submitBtn = document.getElementById('engageSubmit');
    var statusEl = document.getElementById('engageStatus');

    window.openEngageModal = function () {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      emailInput.focus();
    };

    function closeEngageModal() {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    }

    closeBtn.addEventListener('click', closeEngageModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeEngageModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('active')) closeEngageModal();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitBtn.disabled = true;
      statusEl.textContent = 'Submitting...';
      statusEl.className = 'engage-status';
      fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          mobile: mobileInput.value.trim(),
          source: 'dashboard-popup',
        }),
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (data) { return { ok: response.ok, data: data, status: response.status }; });
        })
        .then(function (result) {
          if (!result.ok) throw new Error(result.data.error || ('Request failed (' + result.status + ')'));
          statusEl.textContent = "You're on the list — thanks!";
          statusEl.className = 'engage-status success';
          form.reset();
          setTimeout(closeEngageModal, 1500);
        })
        .catch(function (err) {
          statusEl.textContent = err.message;
          statusEl.className = 'engage-status error';
        })
        .finally(function () {
          submitBtn.disabled = false;
        });
    });
  })();
})();
