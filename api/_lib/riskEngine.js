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
// owner()-vs-EOA, explorer verification flag) are real but weak/partial evidence, and a
// "critical" verdict should never be produced from evidence this thin.

const { scanBytecodeForSelectors, scanSourceForRestrictions } = require('./selectors');

const ENGINE_VERSION = '2.0.0-beta.1';

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

function computeOwnershipConcentration(key = 'ownership', name = 'Ownership & Wallet Concentration') {
  return notIntegratedDimension(key, name, 'Not yet integrated', [
    'Token holder distribution and wallet-concentration analysis require a chain-indexing provider (e.g. Covalent, Moralis, or a paid explorer tier) that is not yet integrated into this engine.',
  ]);
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

function computeDimensions({ onChain, verification, chainConfig, address, retrievedAt }) {
  return [
    computeContractVerification({ verification, chainConfig, address, retrievedAt }),
    computeAdminControls({ onChain, chainConfig, address, retrievedAt }),
    computeUpgradeability({ onChain, chainConfig, address, retrievedAt }),
    computeTokenRestrictions({ verification, chainConfig }),
    computeLiquidity(),
    computeOwnershipConcentration(),
    computeGovernance({ onChain, chainConfig, address, retrievedAt }),
    computeExploitSignals(),
  ];
}

// Only computes an overall score/confidence when enough dimensions were actually assessed.
// Coverage fraction directly discounts confidence - thin evidence must never look as
// confident as full evidence.
function summarizeDimensions(dimensions) {
  const assessed = dimensions.filter((d) => d.state === 'assessed');
  const coverageFraction = assessed.length / dimensions.length;

  if (assessed.length < 3) {
    return { overallScore: null, confidence: 0, resultStatus: 'insufficient_data', coverageFraction };
  }

  const overallScore = Math.round(assessed.reduce((sum, d) => sum + d.subscore, 0) / assessed.length);
  const rawConfidence = assessed.reduce((sum, d) => sum + d.confidence, 0) / assessed.length;
  const confidence = Math.round(rawConfidence * coverageFraction);
  const resultStatus = assessed.length >= 6 ? 'success' : 'partial';

  return { overallScore, confidence, resultStatus, coverageFraction };
}

module.exports = {
  ENGINE_VERSION,
  levelFromScore,
  computeDimensions,
  summarizeDimensions,
};
