// Serverless function (Vercel). Keeps API keys secret on the server.
// Tries Gemini first (free tier), falls back to Groq (free tier).
const businesses = require('../businesses.json');

const hits = new Map(); // best-effort per-IP limiter (resets on cold start)
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 8;
}

const TYPE_LABEL = { restaurant: 'restaurant', cafe: 'café', clinic: 'clinic' };

const ANGLES = [
  'Open with how the place made you feel.',
  'Open with the single thing that stood out most.',
  'Start with a short punchy sentence, then add detail.',
  'Write it like a quick note to a friend.',
  'Start by saying what brought you there.',
  'Open with a thank-you to the team.',
  'Begin with the overall verdict, then explain.',
  'Use a calm, matter-of-fact tone.'
];
const pick = () => ANGLES[Math.floor(Math.random() * ANGLES.length)];

function buildPrompt(biz, rating, tags) {
  const label = TYPE_LABEL[biz.type] || 'local business';
  const low = rating <= 3;
  const pointsLine = tags.length
    ? low
      ? `Areas the customer felt could be better: ${tags.join(', ')}.`
      : `Things the customer liked: ${tags.join(', ')}.`
    : 'The customer did not pick specific points; keep it general.';
  const clinicRule =
    biz.type === 'clinic'
      ? '- Never claim treatment results, cures, diagnoses or medical outcomes.\n'
      : '';
  return `Write 3 different short Google reviews in English, as written by a real customer of "${biz.name}", a ${label}.
Star rating given: ${rating}/5.
${pointsLine}

Rules:
- 25 to 55 words each, first person, simple natural everyday English.
- Tone must match the rating: 1-2 = polite, honest disappointment; 3 = mixed; 4-5 = warm and positive.
- Mention only the points listed above. Do NOT invent specifics such as dish names, staff names, prices, dates or wait times.
${clinicRule}- No emojis, no hashtags, no mention of AI, no offers or discounts, no all-caps.
- Make the three reviews clearly different in opening, structure and wording.
- Style hints (one per review, in order): 1) ${pick()} 2) ${pick()} 3) ${pick()}
- Variation code (ignore, just be original): ${Math.random().toString(36).slice(2, 8)}

Return ONLY JSON: {"reviews":["...","...","..."]}`;
}

function parseReviews(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]).reviews;
    if (!Array.isArray(arr)) return null;
    const clean = arr
      .filter((r) => typeof r === 'string')
      .map((r) => r.trim())
      .filter((r) => r.length > 10)
      .slice(0, 3);
    return clean.length ? clean : null;
  } catch (e) {
    return null;
  }
}

let cachedModels = null;
async function geminiModels(key) {
  if (process.env.GEMINI_MODEL) return [process.env.GEMINI_MODEL];
  if (cachedModels) return cachedModels;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': key },
    });
    if (r.ok) {
      const j = await r.json();
      const names = (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace('models/', ''))
        .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|live|audio|thinking|exp|preview|latest/.test(n));
      const lite = names.filter((n) => /lite/.test(n)).sort().reverse();
      const flash = names.filter((n) => !/lite/.test(n)).sort().reverse();
      const list = [...lite, ...flash].slice(0, 4);
      if (list.length) { cachedModels = list; return list; }
    }
  } catch (e) {}
  return ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('no gemini key');
  let lastErr = 'gemini failed';
  for (const model of await geminiModels(key)) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 1.1, responseMimeType: 'application/json' },
        }),
      }
    );
    if (r.ok) {
      const j = await r.json();
      const t = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      if (t) return t;
      lastErr = `gemini ${model}: empty reply`;
    } else {
      let msg = ''; try { msg = (await r.json()).error?.message || ''; } catch (e) {}
      lastErr = `gemini ${model} ${r.status}: ${msg}`.slice(0, 200);
      if (r.status === 400 && /API key/i.test(msg)) break;   // bad key, don't retry other models
    }
  }
  throw new Error(lastErr);
}

async function callGroq(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('no groq key');
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      temperature: 1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error('groq ' + r.status);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'Too many requests, please wait a minute.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const biz = businesses[body.b];
  if (!biz) return res.status(404).json({ error: 'Unknown business' });

  const rating = Math.min(5, Math.max(1, parseInt(body.rating, 10) || 5));
  const tags = (Array.isArray(body.tags) ? body.tags : [])
    .filter((t) => typeof t === 'string')
    .map((t) => t.replace(/[^\w\s&'\-\/]/g, '').slice(0, 40).trim())
    .filter(Boolean)
    .slice(0, 6);

  const prompt = buildPrompt(biz, rating, tags);

  const errors = [];
  for (const fn of [callGemini, callGroq]) {
    try {
      const reviews = parseReviews(await fn(prompt));
      if (reviews) return res.status(200).json({ reviews });
      errors.push(fn.name + ': could not read reply');
    } catch (e) {
      errors.push(e.message);
    }
  }
  return res.status(502).json({ error: 'AI is busy right now', detail: errors.join(' | ') });
};
