/**
 * Global shared leaderboard — Vercel function backed by Vercel Blob.
 *
 * Same contract as server/scores-api.mjs (which serves `vite dev` / preview):
 *   GET  /api/scores?dim=2D|3D  -> { scores, players, total }
 *   POST /api/scores            -> { name, cd, cl, dim } -> { entry }
 * Scores are recomputed server-side from Cd/Cl so a client can't invent one.
 */
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { efficiency, liftToDrag, normaliseDim } from '../src/scoring.js';

const PATH = 'scores/global.json';
const MAX_PER_DIM = 100;
const lastPost = new Map();

const clean = (text) => String(text ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);

async function readAll() {
  const result = await get(PATH, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return { all: [], etag: null };
  const text = await new Response(result.stream).text();
  try {
    const data = JSON.parse(text);
    return { all: Array.isArray(data) ? data : [], etag: result.blob.etag };
  } catch {
    return { all: [], etag: result.blob.etag };
  }
}

async function writeAll(all, etag) {
  const options = {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  };
  if (etag) options.ifMatch = etag;
  await put(PATH, JSON.stringify(all), options);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({ error: 'scores not configured' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const dim = req.query?.dim ? normaliseDim(req.query.dim) : null;
      const { all } = await readAll();
      const scores = (dim ? all.filter((s) => s.dim === dim) : all)
        .slice()
        .sort((a, b) => b.efficiency - a.efficiency)
        .slice(0, 25);
      res.status(200).json({ scores, players: new Set(all.map((s) => s.name)).size, total: all.length });
    } catch (error) {
      console.error(error);
      res.status(502).json({ error: 'scores unavailable' });
    }
    return;
  }

  if (req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'x';
    const now = Date.now();
    if (now - (lastPost.get(ip) || 0) < 1500) {
      res.status(429).json({ error: 'slow down' });
      return;
    }
    lastPost.set(ip, now);

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    const cd = Number(body?.cd);
    const cl = Number(body?.cl);
    const name = clean(body?.name);
    if (!name || !Number.isFinite(cd) || !Number.isFinite(cl) || Math.abs(cd) > 100 || Math.abs(cl) > 100) {
      res.status(400).json({ error: 'invalid entry' });
      return;
    }
    const dim = normaliseDim(body?.dim);
    const entry = {
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      dim,
      drag: cd,
      lift: cl,
      ld: liftToDrag(cd, cl),
      efficiency: efficiency(cd, cl, dim),
      ts: now,
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const { all, etag } = await readAll();
        const merged = [...all, entry];
        const keep = ['2D', '3D'].flatMap((d) =>
          merged.filter((s) => s.dim === d).sort((a, b) => b.efficiency - a.efficiency).slice(0, MAX_PER_DIM),
        );
        await writeAll(keep, etag);
        res.status(201).json({ entry });
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
