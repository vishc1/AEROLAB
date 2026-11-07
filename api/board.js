/**
 * Class leaderboard — Vercel function backed by Vercel Blob.
 *
 * A room is a short code a teacher shares with the class. Every five-second
 * test posted to the room lands in one JSON blob, so the whole class climbs
 * the same board live. Reads bypass the CDN cache; writes use the blob ETag
 * for optimistic concurrency and retry on conflict.
 */
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const MAX_ENTRIES = 30;
const ROOM = /^[A-Z0-9]{4,8}$/;

const roomPath = (room) => `rooms/${room}.json`;

async function readRoom(room) {
  const result = await get(roomPath(room), { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return { entries: [], etag: null };
  const text = await new Response(result.stream).text();
  try {
    const data = JSON.parse(text);
    return { entries: Array.isArray(data.entries) ? data.entries : [], etag: result.blob.etag };
  } catch {
    return { entries: [], etag: result.blob.etag };
  }
}

async function writeRoom(room, entries, etag) {
  const options = {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  };
  if (etag) options.ifMatch = etag;
  await put(roomPath(room), JSON.stringify({ entries, updatedAt: Date.now() }), options);
}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({ error: 'rooms not configured' });
    return;
  }

  if (req.method === 'GET') {
    const room = clean(req.query?.room, 8).toUpperCase();
    if (!ROOM.test(room)) {
      res.status(400).json({ error: 'bad room code' });
      return;
    }
    try {
      const { entries } = await readRoom(room);
      res.status(200).json({ room, entries });
    } catch (error) {
      console.error(error);
      res.status(502).json({ error: 'room unavailable' });
    }
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    const room = clean(body?.room, 8).toUpperCase();
    const name = clean(body?.name, 32) || 'Anonymous';
    const design = clean(body?.design, 32) || 'Custom shape';
    const cd = finite(body?.cd);
    const cl = finite(body?.cl);
    const score = finite(body?.score);
    if (!ROOM.test(room) || cd === null || cl === null || score === null) {
      res.status(400).json({ error: 'bad entry' });
      return;
    }
    const entry = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      design,
      cd: Number(cd.toFixed(4)),
      cl: Number(cl.toFixed(4)),
      score: Math.max(0, Math.min(100, Math.round(score))),
      at: Date.now(),
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const { entries, etag } = await readRoom(room);
        const next = [...entries, entry].sort((a, b) => b.score - a.score || a.cd - b.cd).slice(0, MAX_ENTRIES);
        await writeRoom(room, next, etag);
        res.status(200).json({ room, entries: next, entry });
        return;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError && attempt < 3) continue;
        console.error(error);
        res.status(502).json({ error: 'could not save' });
        return;
      }
    }
    return;
  }

  res.status(405).json({ error: 'GET or POST' });
}
