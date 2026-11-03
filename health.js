// Open /api/health in the browser to see if keys are set and AI works.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const out = {
    GEMINI_API_KEY_set: !!process.env.GEMINI_API_KEY,
    GROQ_API_KEY_set: !!process.env.GROQ_API_KEY,
  };
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=5', {
        headers: { 'x-goog-api-key': key },
      });
      out.gemini_key_status = r.status;
      if (!r.ok) out.gemini_error = ((await r.json()).error || {}).message;
    } catch (e) { out.gemini_error = e.message; }
  }
  res.status(200).json(out);
};
