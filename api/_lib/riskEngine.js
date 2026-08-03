// Deterministic, evidence-linked risk engine.
//
// Every dimension here is computed the same way every time from the same on-chain facts -
// there is no LLM guessing and no fixed demo numbers. A dimension is only "assessed" (given
// a level/subscore) when the engine actually has a real signal to assess it from; otherwise
// it is honestly reported as `insufficient_data` or `not_applicable`. Missing data is never
// treated as low risk.
//
// Subscores are intentionally capped below the CRITICAL band (90-100): the signals this
// phase of the engine can gather (bytecode selector presence, EIP-1967 storage slots,
// owner()-vs-EOA, explorer verification flag, top-holder concentration) are real but
// weak/partial evidence, and a "critical" verdict should never be produced from evidence
// this thin.
//
// As of 2.1.0, the 8 conceptual dimensions split into two groups:
//   - computeDimensions() returns the 6 that can actually produce a real assessment today:
//     verification, adminControls, upgradeability, tokenRestrictions, ownership, governance.
//     ("Live but gated" dimensions - tokenRestrictions, ownership, governance - still count
//     here even though any individual contract may come back insufficient_data for them; the
//     code path to genuinely assess them exists and is exercised in practice.)
//   - computeRoadmapDimensions() returns the 2 that are permanent stubs with no data provider
//     integrated at all yet - liquidity and exploitSignals. These are surfaced separately
//     (see api/analyze.js's `roadmapDimensions` field) instead of being mixed into the scored
//     set, where they would silently distort summarizeDimensions()'s coverage/confidence math
//     and overstate what the engine actually does.

const { scanBytecodeForSelectors, scanSourceForRestrictions } = require('./selectors');

const ENGINE_VERSION = '2.1.0';

const LEVELS = [
  { max: 33, level: 'no_material_indicator', label: 'No material indicator detected' },
  { max: 66, level: 'review_recommended', label: 'Review recommended' },
  { max: 89, level: 'elevated_risk_indicator', label: 'Elevated risk indicator' },
  { max: 100, level: 'critical_risk_indicator', label: 'Critical risk indicator' },
];

function levelFromScore(score) {
  const band = LEVELS.find((b) => score <= b.max) || LEVELS[LEVELS.length - 1];
  return { level: band.level, label: band.label };
}

function insufficientDimension(key, name, dataSource, limitations) {
  return {
    key,
    name,
    state: 'insufficient_data',
    level: null,
    levelLabel: 'Insufficient data',
    subscore: null,
    confidence: null,
    findings: [],
    dataSource,
    lastChecked: new Date().toISOString(),
    explanation: 'We could not gather enough information to assess this dimension. This does not mean the contract is safe on this dimension - it means we do not know.',
    limitations,
  };
}

// Distinct from insufficientDimension: this is for dimensions that have NO code path to
// ever assess them yet (no integration exists at all, for any contract), versus a
// per-contract evidence gap. The wording matters - "not built yet" reads very differently
// from "something went wrong trying to check this contract," and users should never
// confuse a roadmap gap for a broken feature or a bad sign about the contract itself.
function notIntegratedDimension(key, name, dataSource, limitations) {
  return {
    key,
    name,
    state: 'insufficient_data',
    level: null,
    levelLabel: 'Insufficient data',
    subscore: null,
    confidence: null,
    findings: [],
    dataSource,
    lastChecked: new Date().toISOString(),
    explanation: 'This risk dimension is not available yet in ChainWise Beta - it depends on a third-party data source that is not connected to the engine (see the limitation below). This is a roadmap gap, not an error, and it is not specific to this contract.',
    limitations,
  };
}

function notApplicableDimension(key, name, reason) {
  return {
    key,
    name,
    state: 'not_applicable',
    level: null,
    levelLabel: 'Not applicable',
    subscore: null,
    confidence: null,
    findings: [],
    dataSource: null,
    lastChecked: new Date().toISOString(),
    explanation: reason,
    limitations: [],
  };
}

function assessedDimension({ key, name, subscore, confidence, findings, dataSource, explanation, limitations }) {
  const { level, label } = levelFromScore(subscore);
  return {
    key,
    name,
    state: 'assessed',
    level,
    levelLabel: label,
    subscore,
    confidence,
    findings,
    dataSource,
    lastChecked: new Date().toISOString(),
    explanation,
    limitations: limitations || [],
  };
}

function buildEvidence({ type, description, chainConfig, address, blockNumber, retrievedAt, extra }) {
  return {
    type,
    description,
    contractAddress: address,
    chainId: chainConfig.chainId,
    network: chainConfig.label,
    blockNumber: blockNumber ?? null,
    explorerUrl: `${chainConfig.explorer}/address/${address}`,
    retrievedAt,
    ...extra,
  };
}

function computeContractVerification({ verification, chainConfig, address, retrievedAt }) {
  const key = 'verification';
  const name = 'Contract Verification & Transparency';
  if (!verification) {
    return insufficientDimension(key, name,
      chainConfig.explorerApiChainId ? `${chainConfig.explorer} (verification lookup not configured)` : `${chainConfig.explorer} (not supported for this chain)`,
      ['Source-verification lookup requires an ETHERSCAN_API_KEY environment variable, which is not configured in this environment.']);
  }

  const evidence = buildEvidence({
    type: 'explorer_source_verification',
    description: verification.isVerified
      ? `Source code is verified on ${chainConfig.explorer}${verification.contractName ? ` as "${verification.contractName}"` : ''}.`
      : `No verified source code was found on ${chainConfig.explorer} for this address.`,
    chainConfig, address, retrievedAt,
    extra: { contractName: verification.contractName, compilerVersion: verification.compilerVersion },
  });

  const subscore = verification.isVerified ? 10 : 60;
  return assessedDimension({
    key, name, subscore,
    confidence: 90,
    findings: [{ summary: evidence.description, evidence }],
    dataSource: chainConfig.explorer,
    explanation: verification.isVerified
      ? 'Publicly verified source code lets anyone read exactly what the contract does, which supports transparency.'
      : 'Without verified source code, the exact contract logic cannot be independently read - this is a real transparency gap, not proof of wrongdoing.',
    limitations: ['Verification status reflects only whether source was published to the explorer, not whether that source was independently audited.'],
  });
}

function computeAdminControls({ onChain, chainConfig, address, retrievedAt }) {
  const key = 'adminControls';
  const name = 'Privileged Access & Admin Controls';
  if (!onChain.isContract) {
    return notApplicableDimension(key, name, 'This address is not a deployed contract, so privileged-function analysis does not apply.');
  }

  const found = scanBytecodeForSelectors(onChain.bytecode);
  const findings = found.map((f) => ({
    summary: `Detected function selector 0x${f.selector} (${f.signature}). ${f.note}`,
    evidence: buildEvidence({
      type: 'bytecode_selector',
      description: `Selector 0x${f.selector} for ${f.signature} found in deployed bytecode.`,
      chainConfig, address, retrievedAt,
      extra: { selector: `0x${f.selector}`, functionSignature: f.signature, codeSizeBytes: onChain.codeSizeBytes },
    }),
  }));

  const subscore = found.length === 0 ? 15 : found.length <= 2 ? 40 : 65;
  return assessedDimension({
    key, name, subscore,
    confidence: 55,
    findings,
    dataSource: `${chainConfig.label} RPC (eth_getCode)`,
    explanation: found.length === 0
      ? 'No commonly privileged function selectors (pause, mint, blacklist, ownership transfer) were found via bytecode scan.'
      : `Found ${found.length} commonly privileged function selector(s) in the bytecode. Many legitimate contracts use these too - presence alone is not proof of misuse.`,
    limitations: [
      'This is a raw bytecode substring scan, not a decompiler - it can miss logic hidden behind a proxy (see Upgradeability) and cannot confirm how/when these functions are actually restricted or used.',
    ],
  });
}

function computeUpgradeability({ onChain, chainConfig, address, retrievedAt }) {
  const key = 'upgradeability';
  const name = 'Upgradeability & Proxy Risk';
  if (!onChain.isContract) {
    return notApplicableDimension(key, name, 'This address is not a deployed contract, so proxy analysis does not apply.');
  }

  const isProxy = Boolean(onChain.proxyImplementation);
  const evidence = buildEvidence({
    type: 'eip1967_storage_slot',
    description: isProxy
      ? `EIP-1967 implementation slot points to ${onChain.proxyImplementation}, indicating this is an upgradeable proxy.`
      : 'The EIP-1967 implementation storage slot is empty; no standard upgradeable-proxy pattern was detected.',
    chainConfig, address, retrievedAt,
    extra: { implementationAddress: onChain.proxyImplementation, adminAddress: onChain.proxyAdmin },
  });

  const subscore = isProxy ? 70 : 20;
  return assessedDimension({
    key, name, subscore,
    confidence: 75,
    findings: [{ summary: evidence.description, evidence }],
    dataSource: `${chainConfig.label} RPC (eth_getStorageAt, EIP-1967 slots)`,
    explanation: isProxy
      ? 'This contract can have its logic replaced by whoever controls the proxy admin - upgradeability is a real risk factor even when used legitimately.'
      : 'No standard proxy pattern was detected, suggesting contract logic cannot be swapped after deployment via the most common upgrade mechanism.',
    limitations: ['Only the standard EIP-1967 slot pattern is checked; non-standard or custom proxy implementations would not be detected by this check.'],
  });
}

function computeTokenRestrictions({ verification, chainConfig }) {
  const key = 'tokenRestrictions';
  const name = 'Token & Transaction Restrictions';
  if (!verification || !verification.isVerified || !verification.sourceCode) {
    return insufficientDimension(key, name, verification ? `${chainConfig.explorer} (source not verified)` : 'Not yet integrated',
      ['Detecting transfer/trading restrictions reliably requires verified source code, which was not available for this contract.']);
  }

  const hits = scanSourceForRestrictions(verification.sourceCode);
  const subscore = hits.length === 0 ? 20 : 55;
  return assessedDimension({
    key, name, subscore,
    confidence: 45,
    findings: hits.map((kw) => ({
      summary: `Verified source contains a pattern associated with transfer/trading restrictions: "${kw}".`,
      evidence: { type: 'source_keyword', keyword: kw, dataSource: chainConfig.explorer },
    })),
    dataSource: `${chainConfig.explorer} (verified source keyword scan)`,
    explanation: hits.length === 0
      ? 'No common transfer-restriction keywords (max transaction, blacklist, cooldown, anti-whale) were found in verified source.'
      : 'Verified source contains keywords commonly associated with transfer or trading restrictions. These are common in legitimate token launches too and require manual review to interpret.',
    limitations: ['Keyword matching on source text, not a control-flow analysis - it cannot confirm whether a restriction is currently active or how it is gated.'],
  });
}

function computeLiquidity(key = 'liquidity', name = 'Liquidity & Market Structure') {
  return notIntegratedDimension(key, name, 'Not yet integrated', [
    'Liquidity depth, lock status, and market-structure analysis require a DEX/liquidity data provider that is not yet integrated into this engine. (A free, RPC-only path exists for standard Uniswap-V2-style pairs - reading factory/pair reserves directly on-chain - but it has not shipped yet because it needs to be verified against live pairs before release.)',
  ]);
}

function computeOwnershipConcentration({ onChain, ownership, chainConfig, address, retrievedAt }) {
  const key = 'ownership';
  const name = 'Ownership & Wallet Concentration';
  if (!onChain.isContract) {
    return notApplicableDimension(key, name, 'This address is not a deployed contract, so holder-concentration analysis does not apply.');
  }
  if (!ownership) {
    return notIntegratedDimension(key, name,
      chainConfig.explorerApiChainId ? `${chainConfig.explorer} (token holder list)` : `${chainConfig.explorer} (not supported for this chain)`,
      ['Top-holder distribution requires the block explorer\'s token-holder-list API, which is an Etherscan Pro-tier feature - a standard ETHERSCAN_API_KEY cannot retrieve it. This environment either has no key configured, the token has no ERC-20 supply/holder data, or the request failed or was rate-limited.']);
  }
  if (!ownership.topHolder) {
    return insufficientDimension(key, name, `${chainConfig.explorer} (token holder list)`,
      ['Every top holder returned by the explorer was a known burn/zero address, so a real top holder could not be identified to assess concentration against.']);
  }

  let topHolderPct;
  try {
    const qty = BigInt(ownership.topHolder.quantity);
    if (!(ownership.totalSupply > 0n)) throw new Error('non-positive supply');
    topHolderPct = Number((qty * 10000n) / ownership.totalSupply) / 100;
  } catch (err) {
    return insufficientDimension(key, name, `${chainConfig.explorer} (token holder list)`,
      ['The top holder quantity or total supply returned by the explorer could not be parsed as a number.']);
  }

  const topHolderIsContract = ownership.topHolderIsContract;
  const contractNote = topHolderIsContract === true
    ? ', and is itself a contract (e.g. a liquidity pool, staking, or vesting contract)'
    : topHolderIsContract === false
      ? ', and is a wallet (EOA), not a contract'
      : ' (could not determine whether this address is a wallet or a contract)';
  const evidence = buildEvidence({
    type: 'token_holder_concentration',
    description: `Top holder ${ownership.topHolder.address} holds ${topHolderPct.toFixed(1)}% of total supply${contractNote}.`,
    chainConfig, address, retrievedAt,
    extra: { topHolderAddress: ownership.topHolder.address, topHolderPct, topHolderIsContract },
  });

  // A contract-held balance (locked LP, staking, vesting) is not the same risk as an EOA
  // holding the same share, so it is scored well below the EOA concentration bands even at
  // a high percentage - it still gets a finding and evidence, just not a "risky" subscore.
  let subscore;
  let explanation;
  if (topHolderIsContract === true) {
    subscore = 20;
    explanation = `The largest holder (${topHolderPct.toFixed(1)}% of supply) is itself a contract, not a wallet - consistent with (but not proof of) locked liquidity, staking, or a vesting contract rather than a single party with direct sell control.`;
  } else if (topHolderPct > 50) {
    subscore = 75;
    explanation = `A single wallet holds ${topHolderPct.toFixed(1)}% of total supply - enough to move the market unilaterally if it sells. This is a real concentration risk, independent of whether that holder ever intends to sell.`;
  } else if (topHolderPct >= 25) {
    subscore = 45;
    explanation = `A single wallet holds ${topHolderPct.toFixed(1)}% of total supply - a meaningful concentration, though below a majority stake.`;
  } else {
    subscore = 15;
    explanation = `The largest wallet holder controls ${topHolderPct.toFixed(1)}% of total supply, which does not indicate outsized single-wallet concentration on its own.`;
  }

  return assessedDimension({
    key, name, subscore,
    confidence: 50,
    findings: [{ summary: evidence.description, evidence }],
    dataSource: `${chainConfig.explorer} (token holder list, Etherscan Pro tier)`,
    explanation,
    limitations: [
      'Based on the single largest holder only, not the full top-10 distribution, and reflects a one-time snapshot - concentration can change at any time.',
      'The contract-vs-wallet check only detects whether the top holder address has contract code; it cannot confirm a contract-held balance is genuinely locked, or that a wallet-held balance is not itself an exchange or multisig address.',
    ],
  });
}

function computeGovernance({ onChain, chainConfig, address, retrievedAt }) {
  const key = 'governance';
  const name = 'Governance & Operational Controls';
  if (!onChain.isContract) {
    return notApplicableDimension(key, name, 'This address is not a deployed contract, so governance-control analysis does not apply.');
  }
  if (!onChain.ownerAddress) {
    return insufficientDimension(key, name, `${chainConfig.label} RPC (eth_call owner())`, [
      'This contract does not expose a standard owner() function (or the call reverted), so single-key-vs-multisig control could not be determined this way.',
    ]);
  }

  const evidence = buildEvidence({
    type: 'owner_control_check',
    description: onChain.ownerIsContract
      ? `owner() returns ${onChain.ownerAddress}, which is itself a contract (possible multisig/timelock).`
      : `owner() returns ${onChain.ownerAddress}, a wallet with no contract code (a single private key).`,
    chainConfig, address, retrievedAt,
    extra: { ownerAddress: onChain.ownerAddress, ownerIsContract: onChain.ownerIsContract },
  });

  const subscore = onChain.ownerIsContract ? 25 : 65;
  return assessedDimension({
    key, name, subscore,
    confidence: 60,
    findings: [{ summary: evidence.description, evidence }],
    dataSource: `${chainConfig.label} RPC (eth_call owner(), eth_getCode)`,
    explanation: onChain.ownerIsContract
      ? 'Control is held by a contract address rather than a single wallet, which is consistent with (but does not confirm) a multisig or timelock.'
      : 'Control is held by a single wallet with no additional contract logic - a single compromised or malicious key could exercise full control.',
    limitations: ['Detects only whether the owner is a contract, not whether it is genuinely a multisig, its signer threshold, or a timelock delay.'],
  });
}

function computeExploitSignals(key = 'exploitSignals', name = 'Exploit, Anomaly & External Signals') {
  return notIntegratedDimension(key, name, 'Not yet integrated', [
    'Known-exploit and anomaly-feed correlation requires a threat-intelligence data source that is not yet integrated into this engine.',
  ]);
}

function computeDimensions({ onChain, verification, ownership, chainConfig, address, retrievedAt }) {
  return [
    computeContractVerification({ verification, chainConfig, address, retrievedAt }),
    computeAdminControls({ onChain, chainConfig, address, retrievedAt }),
    computeUpgradeability({ onChain, chainConfig, address, retrievedAt }),
    computeTokenRestrictions({ verification, chainConfig }),
    computeOwnershipConcentration({ onChain, ownership, chainConfig, address, retrievedAt }),
    computeGovernance({ onChain, chainConfig, address, retrievedAt }),
  ];
}

// The 2 permanent stubs, kept out of computeDimensions()/summarizeDimensions() entirely so
// they can never silently dilute the coverage/confidence math for the 6 real dimensions.
// Surfaced separately by the caller (api/analyze.js's `roadmapDimensions` field) so the UI can
// render them as "coming soon" rather than as failed checks on the analyzed contract.
function computeRoadmapDimensions() {
  return [
    computeLiquidity(),
    computeExploitSignals(),
  ];
}

// Only computes an overall score/confidence when enough dimensions were actually assessed.
// Coverage fraction directly discounts confidence - thin evidence must never look as
// confident as full evidence. `dimensions` here is always the 6-item array from
// computeDimensions() - coverageFraction is assessed.length / 6 in practice, since the
// denominator is dimensions.length rather than a hardcoded constant.
//
// overallScore is the mean subscore across assessed dimensions - useful as a single summary
// number, but a mean can hide one severely risky dimension behind several low ones.
// worstDimensionScore is the max subscore instead: the UI's banner tier/color must be driven
// by this, not the mean, so a single critical-severity finding is never averaged down to a
// reassuring "medium" headline.
//
// The minimum-3-assessed floor for producing any score at all is intentionally NOT scaled
// down with the 8->6 dimension reduction: it represents "need at least this many independent
// real signals to trust an average," which doesn't get weaker just because the total pool of
// possible dimensions shrank. success/partial *are* scaled to preserve roughly the same
// relative strictness as the previous 8-dimension thresholds (success required 6/8 = 75%
// coverage; 5/6 ~= 83% is the closest whole-dimension equivalent without loosening it).
function summarizeDimensions(dimensions) {
  const assessed = dimensions.filter((d) => d.state === 'assessed');
  const coverageFraction = assessed.length / dimensions.length;

  if (assessed.length < 3) {
    return { overallScore: null, worstDimensionScore: null, confidence: 0, resultStatus: 'insufficient_data', coverageFraction };
  }

  const overallScore = Math.round(assessed.reduce((sum, d) => sum + d.subscore, 0) / assessed.length);
  const worstDimensionScore = Math.max(...assessed.map((d) => d.subscore));
  const rawConfidence = assessed.reduce((sum, d) => sum + d.confidence, 0) / assessed.length;
  const confidence = Math.round(rawConfidence * coverageFraction);
  const resultStatus = assessed.length >= 5 ? 'success' : 'partial';

  return { overallScore, worstDimensionScore, confidence, resultStatus, coverageFraction };
}

module.exports = {
  ENGINE_VERSION,
  levelFromScore,
  computeDimensions,
  computeRoadmapDimensions,
  summarizeDimensions,
};
