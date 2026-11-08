/**
 * Tiny shared-leaderboard API (no dependencies, JSON file storage).
 *   GET  /api/scores?dim=2D|3D  -> { scores: [...], players }
 *   POST /api/scores            -> { name, cd, cl, dim }
 * Mounted by Vite (dev + preview) and by server/serve.mjs, so everyone who
 * opens the same host sees the same board.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { efficiency, liftToDrag, normaliseDim } from '../src/scoring.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.SCORES_FILE || path.join(here, 'data', 'scores.json');
const MAX_PER_DIM = 100;
const lastPost = new Map();

let cache = null;
function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    cache = [];
  }
  return cache;
}
function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache));
  } catch (error) {
    console.warn('[scores] could not persist:', error.message);
  }
}

const clean = (text) =>
  String(text ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 24);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function scoresMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/api/scores') return next();
  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (req.method === 'GET') {
    const dim = url.searchParams.get('dim');
    const all = load();
    const rows = (dim ? all.filter((s) => s.dim === normaliseDim(dim)) : all)
      .slice()
      .sort((a, b) => b.efficiency - a.efficiency)
      .slice(0, 25);
    return send(res, 200, { scores: rows, players: new Set(all.map((s) => s.name)).size, total: all.length });
  }

  if (req.method === 'POST') {
    const ip = req.socket?.remoteAddress || 'x';
    const now = Date.now();
    if (now - (lastPost.get(ip) || 0) < 1500) return send(res, 429, { error: 'slow down' });
    lastPost.set(ip, now);
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2048) req.destroy();
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const cd = Number(body.cd);
      const cl = Number(body.cl);
      const name = clean(body.name);
      if (!name || !Number.isFinite(cd) || !Number.isFinite(cl) || Math.abs(cd) > 100 || Math.abs(cl) > 100) {
        return send(res, 400, { error: 'invalid entry' });
      }
      const dim = normaliseDim(body.dim);
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
      const all = load();
      all.push(entry);
      const keep = ['2D', '3D'].flatMap((d) =>
        all
          .filter((s) => s.dim === d)
          .sort((a, b) => b.efficiency - a.efficiency)
          .slice(0, MAX_PER_DIM),
      );
      cache = keep;
      save();
      return send(res, 201, { entry });
    });
    return undefined;
  }
  return send(res, 405, { error: 'method not allowed' });
}

export function scoresPlugin() {
  return {
    name: 'aerolab-scores-api',
    configureServer(server) {
      server.middlewares.use(scoresMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(scoresMiddleware);
    },
  };
}
