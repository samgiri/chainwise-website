// Vercel serverless function: GET /api/cases
//
// Lists published case studies - see api/_lib/caseStudies.js for the single
// source of truth. There is no real, published case study yet; every entry
// carries `isIllustrative: true` and is a hypothetical/composite example, not
// a real finding. `inProgress: true` tells visitors verified case studies are
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
