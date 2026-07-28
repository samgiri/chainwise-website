// Vercel serverless function: GET /api/cases
//
// Lists published case studies. Currently just Smart Solve DeFi - see
// api/_lib/caseStudies.js for the single source of truth (also used by
// /api/analyze's demo lookup). `inProgress: true` matches the homepage's
// Research & Case Studies section, which already tells visitors more
// cases are coming rather than fabricating ones that don't exist.

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
