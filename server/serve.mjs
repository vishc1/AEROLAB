/** Production-style server: serves dist/ plus the shared leaderboard API. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoresMiddleware } from './scores-api.mjs';
import { blendMiddleware } from './blend-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 8787);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
};

http
  .createServer((req, res) => {
    scoresMiddleware(req, res, () => blendMiddleware(req, res, () => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.join(root, pathname === '/' ? 'index.html' : pathname);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    }));
  })
  .listen(port, '0.0.0.0', () => console.log(`AEROLAB + shared leaderboard on http://0.0.0.0:${port}`));
