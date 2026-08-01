// Vercel serverless function: GET /api/cases
//
// Lists published case studies - see api/_lib/caseStudies.js for the single
// source of truth. INVESTIGATED_CASES entries are real, sourced case studies
// (`isInvestigated: true`); ILLUSTRATIVE_CASES entries carry
// `isIllustrative: true` and are hypothetical/composite examples, not real
// findings. `inProgress: true` tells visitors more verified case studies are
// still coming.

const { CASE_STUDIES } = require('./_lib/caseStudies');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.status(200).json({
    cases: CASE_STUDIES,
    count: CASE_STUDIES.length,
    inProgress: true,
  });
};
