// Vercel serverless function: POST /api/subscribe
// Body: { email: string, mobile?: string, source: string }
//
// This validates and accepts email/SMS opt-ins from the homepage newsletter
// form, the research-section case-study capture, the dashboard post-analysis
// popup, and the footer form. It does NOT send any email or SMS today — no
// email service provider (e.g. Mailchimp, SendGrid) or SMS provider (e.g.
// Twilio) is connected to this project. Submissions are validated and
// written to the function's logs (visible in the Vercel dashboard) as a
// stopgap. Wiring a real ESP/SMS provider is a follow-up integration, not
// something this endpoint fabricates.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\+?[0-9()\-.\s]{7,20}$/;

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const email = String(body.email || '').trim();
  const mobile = String(body.mobile || '').trim();
  const source = String(body.source || 'unknown').trim();

  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }
  if (mobile && !MOBILE_RE.test(mobile)) {
    res.status(400).json({ error: 'That mobile number doesn\'t look valid.' });
    return;
  }

  console.log('[subscribe]', JSON.stringify({
    email,
    mobile: mobile || null,
    source,
    at: new Date().toISOString(),
  }));

  res.status(200).json({
    success: true,
    message: 'Submission received.',
    demo: true,
  });
};
