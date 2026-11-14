/**
 * Describe-to-silhouette — Vercel serverless function.
 *
 * Takes up to two short object descriptions and asks Claude for a side-view
 * silhouette polygon of each, facing left into the wind, so the tunnel can
 * test it. The browser has a built-in library for common objects and only
 * calls this for descriptions it does not recognise; without an API key it
 * simply tells the user which words it knows.
 */
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You turn short object descriptions into 2D side-view silhouettes for a classroom wind tunnel.

Return ONLY a JSON object, no prose and no code fences, of the form:
{"shapes":[{"name":"short label","points":[[x,y],...],"why":"one sentence"}]}

Rules for each polygon:
- 12 to 40 vertices, listed in order around the outline, forming one simple closed polygon with no holes and no self-intersections.
- Coordinates are in a unit SQUARE: x from 0 to 1 running left to right, y from 0 to 1 running top to bottom. Draw the object at its true proportions: a long object spans x from 0 to 1 and is short in y; a tall object spans y and is narrow in x. Never stretch it to fill both axes.
- The wind comes from the LEFT. Orient the object so its front faces left and it rests as it normally would (wheels or feet at the bottom).
- Merge wheels, legs, fins and other parts into the body outline. Think silhouette, not drawing.
- "name" is at most four words. "why" is one plain sentence a 14-year-old would understand predicting how the air will behave around it (where it separates, how big the wake is).
If a description is not a physical object you can draw in profile, still return a sensible object that matches the words best.`;

const MODEL = 'claude-opus-5-5';

function clean(text) {
  return String(text ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
}

function parseJson(text) {
  const trimmed = text.replace(/```json|```/g, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no json');
  return JSON.parse(trimmed.slice(start, end + 1));
}

function validPolygon(raw) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 80) return null;
  const pts = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
  }
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  return Math.abs(area) / 2 >= 0.02 ? pts : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'shapes not configured' });
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
  const prompts = Array.isArray(body?.prompts) ? body.prompts.map(clean).filter(Boolean).slice(0, 2) : [];
  if (!prompts.length) {
    res.status(400).json({ error: 'describe at least one object' });
    return;
  }

  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1800,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Objects, in order:\n${prompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nReturn exactly ${prompts.length} shapes in that order.`,
        },
      ],
    });
    if (response.stop_reason === 'refusal') {
      res.status(502).json({ error: 'declined' });
      return;
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    const data = parseJson(text);
    const shapes = (Array.isArray(data.shapes) ? data.shapes : []).slice(0, prompts.length).map((s, i) => {
      const points = validPolygon(s?.points);
      if (!points) return null;
      return {
        name: clean(s?.name) || prompts[i],
        points,
        why: clean(s?.why).slice(0, 200) || '',
      };
    });
    if (shapes.length !== prompts.length || shapes.some((s) => !s)) {
      res.status(502).json({ error: 'could not draw that' });
      return;
    }
    res.status(200).json({ shapes, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'rate limited' });
      return;
    }
    if (error instanceof Anthropic.AuthenticationError) {
      res.status(503).json({ error: 'shapes not configured' });
      return;
    }
    console.error(error);
    res.status(502).json({ error: 'shapes unavailable' });
  }
}
