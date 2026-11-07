/**
 * AI flow coach — Vercel serverless function.
 *
 * Receives the result of a five-second test (coefficients, forces, road-speed
 * translation and a silhouette thumbnail) and asks Claude to explain, like a
 * patient physics teacher, what the air did to this particular shape and one
 * concrete change to try next. The browser falls back to the built-in
 * rule-based coach when this endpoint is unavailable or ANTHROPIC_API_KEY is
 * not configured.
 */
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are the flow coach inside AEROLAB, a browser wind tunnel used in classrooms.
A student just ran a five-second test on a 2D silhouette. You get the measured drag coefficient (Cd), lift coefficient (Cl), lift-to-drag ratio, Reynolds number, a road-speed translation (what this drag would cost a car at 100 km/h), and a picture of the silhouette with air flowing left to right.

Reply in plain English for a curious 14-year-old, in at most three short sentences:
1. Say what the air is doing around THIS shape (look at the picture: where it is blunt, where it tapers, whether it is tilted) and connect that to the numbers.
2. Give one concrete change to try next, phrased as an action in the tunnel (sculpt, erase, tilt, add a tail, round an edge).
Do not use bullet points, headings or markdown. Do not restate every number. Never mention that you are an AI or that the model is 2D.`;

const FALLBACK_MODEL = 'claude-opus-5-5';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'coach not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'bad request' });
    return;
  }

  const { metrics = {}, context = {}, thumb } = body;
  const num = (v, d = 3) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : 'n/a');
  const facts = [
    `Shape: ${String(context.label || 'custom shape').slice(0, 60)} (${context.dim || '2D'} solver, input ${context.input || 'draw'}).`,
    context.mission ? `Active mission: ${String(context.mission).slice(0, 80)}.` : '',
    `Cd ${num(metrics.cd)}, Cl ${num(metrics.cl)}, L/D ${num(metrics.ld, 2)}, Re ${num(metrics.re, 0)} (${metrics.regime || 'unknown'} regime).`,
    metrics.road
      ? `At 100 km/h on a car this drag would take ${num(metrics.road.powerKw, 1)} kW, about ${num(metrics.road.litresPer100km, 1)} L/100 km and ${num(metrics.road.co2gPerKm, 0)} g CO2/km.`
      : '',
    context.baseline
      ? `Pinned baseline for comparison: ${String(context.baseline.name).slice(0, 40)} with Cd ${num(context.baseline.cd)}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const content = [];
  if (typeof thumb === 'string' && thumb.startsWith('data:image/png;base64,') && thumb.length < 400000) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: thumb.slice('data:image/png;base64,'.length) },
    });
  }
  content.push({ type: 'text', text: `${facts}\n\nExplain this result and suggest one change.` });

  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: FALLBACK_MODEL,
      max_tokens: 400,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') {
      res.status(502).json({ error: 'coach declined' });
      return;
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .trim();
    if (!text) {
      res.status(502).json({ error: 'empty' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ text, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'rate limited' });
      return;
    }
    if (error instanceof Anthropic.AuthenticationError) {
      res.status(503).json({ error: 'coach not configured' });
      return;
    }
    console.error(error);
    res.status(502).json({ error: 'coach unavailable' });
  }
}
