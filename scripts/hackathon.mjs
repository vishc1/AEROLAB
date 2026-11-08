// End-to-end check for the hackathon features. Needs `npx vite --port 5190` running.
import puppeteer from 'puppeteer-core';
const URL = process.env.URL || 'http://localhost:5190';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1512, height: 950 });
const logs = [];
page.on('console', (m) => m.type() === 'error' && !m.text().includes('status of 400') && logs.push(m.text()));
page.on('pageerror', (e) => logs.push(e.message));
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };

await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(1500);

// 3D sketch mode
await page.evaluate(() => window.__AEROLAB__.setDim('3d'));
await sleep(1500);
const dockVisible = await page.evaluate(() => !document.getElementById('sketch-dock').hidden);
check('sketch dock visible in 3D', dockVisible);
const solid = () => page.evaluate(() => window.__AEROLAB__.sim3d.solid.reduce((a, b) => a + b, 0));
const s1 = await solid();
check('3D solid exists', s1 > 0, String(s1));
await page.click('[data-plan="delta"]');
await sleep(500);
const s2 = await solid();
check('planform preset changes solid', s2 !== s1, `${s1}->${s2}`);

// vorticity in 3D
await page.click('#vort-toggle');
await sleep(2500);
check('3D vorticity flag set', await page.evaluate(() => window.__AEROLAB__.sim3d.vorticity === true));

// equations + explain
await page.click('#eq-toggle');
await sleep(300);
check('equations card shows', await page.evaluate(() => !document.getElementById('eq-card').hidden));
check('explain text filled', await page.evaluate(() => document.getElementById('explain-text').textContent.length > 20));

// API
const api = await page.evaluate(async () => {
  const post = await fetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tester', cd: 0.4, cl: 0.2, dim: '3D' }) });
  await new Promise((r) => setTimeout(r, 1700));
  const get = await fetch('/api/scores?dim=3D').then((r) => r.json());
  await new Promise((r) => setTimeout(r, 1700));
  const forged = await fetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', cd: 'NaN', cl: 1, dim: '3D' }) });
  return { post: post.status, names: get.scores.map((s) => s.name), forged: forged.status };
});
check('API POST+GET', api.post < 300 && api.names.includes('Tester'), JSON.stringify(api));
check('API rejects bad input', api.forged >= 400, String(api.forged));

// Demo
await page.evaluate(() => window.__AEROLAB__.setDim('2d'));
await sleep(500);
await page.click('#demo-start');
await sleep(1500);
check('demo caption appears', await page.evaluate(() => !document.getElementById('demo-caption').hidden));
await page.keyboard.press('Escape');
await sleep(300);
check('demo stops on Esc', await page.evaluate(() => document.getElementById('demo-caption').hidden));

check('no console errors', logs.length === 0, logs.join(' | '));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
