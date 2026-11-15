// Converts an uploaded .blend to .glb by running Blender headless. Only works
// where Blender is installed (local dev, `npm run serve`); static hosting has
// no Blender, so the client falls back to asking for a glb/stl export.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_BYTES = 75 * 1024 * 1024;
const CANDIDATES = [
  process.env.BLENDER_PATH,
  '/Applications/Blender.app/Contents/MacOS/Blender',
  '/usr/bin/blender',
  '/usr/local/bin/blender',
  'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe',
].filter(Boolean);

function findBlender() {
  return CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

const EXPORT_PY =
  'import bpy,sys; out=sys.argv[sys.argv.index("--")+1]; ' +
  'bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function blendMiddleware(req, res, next) {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname !== '/api/blend') return next();
  const reply = (code, body, type = 'application/json') => {
    res.statusCode = code;
    res.setHeader('Content-Type', type);
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const blender = findBlender();
  if (req.method === 'GET') return reply(200, { available: Boolean(blender) });
  if (req.method !== 'POST') return reply(405, { error: 'method not allowed' });
  if (!blender) return reply(501, { error: 'Blender is not installed on this server' });

  readBody(req).then(async (body) => {
    if (body.length < 12 || body.subarray(0, 7).toString() !== 'BLENDER') {
      // Compressed .blend files start with a zstd/gzip header; Blender reads those too.
      const zstd = body[0] === 0x28 && body[1] === 0xb5;
      const gzip = body[0] === 0x1f && body[1] === 0x8b;
      if (!zstd && !gzip) return reply(400, { error: 'not a .blend file' });
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-blend-'));
    const input = path.join(dir, 'in.blend');
    const output = path.join(dir, 'out.glb');
    fs.writeFileSync(input, body);
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    execFile(blender, ['-b', input, '--python-expr', EXPORT_PY, '--', output], { timeout: 60000 }, (err) => {
      if (err || !fs.existsSync(output)) { cleanup(); return reply(500, { error: 'Blender could not export this file' }); }
      const glb = fs.readFileSync(output);
      cleanup();
      reply(200, glb, 'model/gltf-binary');
    });
  }).catch(() => reply(413, { error: 'file too large or upload failed' }));
}

export function blendPlugin() {
  return {
    name: 'aerolab-blend-api',
    configureServer(server) { server.middlewares.use(blendMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(blendMiddleware); },
  };
}
