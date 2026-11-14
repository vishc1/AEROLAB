/**
 * Outline-by-vision — Vercel serverless function.
 *
 * The browser sends one webcam frame with a red marker on the object the
 * user clicked. Claude returns that object's outline as a polygon so the
 * tunnel can test it even when the on-device segmenter fails (bad light,
 * white object on a white wall, no GPU, Safari without WASM GPU delegates).
 */
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You trace objects in webcam frames for a classroom wind tunnel.
The frame has a small red circle on it marking the object the user wants. Trace the full visible outline of THAT object only, as the air would see it from this side: include the whole object, exclude the hand, fingers, face, background and anything else.

Return ONLY a JSON object, no prose, no code fences:
{"found":true,"name":"two or three word label","points":[[x,y],...]}
or {"found":false,"reason":"short reason"} if there is no clear object under the marker.

Rules for points:
- 16 to 48 vertices in order around the outline, forming one simple closed polygon.
- Coordinates are fractions of the image: x from 0 (left) to 1 (right), y from 0 (top) to 1 (bottom).
- Follow the real silhouette closely, including corners and the exact tilt of the object. Do not simplify to a box unless it is a box.`;

const MODEL = 'claude-opus-5-5';

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
  return Math.abs(area) / 2 >= 0.002 ? pts : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'outline not configured' });
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
  const image = typeof body?.image === 'string' ? body.image : '';
  const match = image.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length > 900000) {
    res.status(400).json({ error: 'send a jpeg or png data url under 650 KB' });
    return;
  }
  const point = body?.point || {};
  const px = Number(point.x);
  const py = Number(point.y);

  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1200,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: `image/${match[1]}`, data: match[2] } },
            {
              type: 'text',
              text: `The red marker is at x=${Number.isFinite(px) ? px.toFixed(2) : '?'}, y=${Number.isFinite(py) ? py.toFixed(2) : '?'} of the image. Trace the object under it.`,
            },
          ],
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
    if (!data.found) {
      res.status(200).json({ found: false, reason: String(data.reason || '').slice(0, 120) });
      return;
    }
    const points = validPolygon(data.points);
    if (!points) {
      res.status(502).json({ error: 'bad outline' });
      return;
    }
    res.status(200).json({ found: true, name: String(data.name || 'object').slice(0, 40), points, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'rate limited' });
      return;
    }
    if (error instanceof Anthropic.AuthenticationError) {
      res.status(503).json({ error: 'outline not configured' });
      return;
    }
    console.error(error);
    res.status(502).json({ error: 'outline unavailable' });
  }
}
