import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1512, height: 950 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('dialog', (d) => d.accept('Test design'));
await page.goto('http://localhost:5190', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(2000);
for (const p of ['card', 'car']) {
  await page.click(`[data-preset="${p}"]`); await wait(600);
}
await page.click('#vort-toggle'); await wait(800);
await page.screenshot({ path: 'scripts/v2-vort.png' });
await page.click('#vort-toggle');
await page.click('[data-preset="cylinder"]');
await page.click('[data-dim="3d"]');
await wait(6000);
const m3 = await page.evaluate(() => ({ m: window.__AEROLAB__.store.state.metrics, surf: window.__AEROLAB__.sim3d.surface.length, rec: window.__AEROLAB__.sim3d.recoveries }));
console.log('3D cylinder', JSON.stringify({cd:m3.m.cd, cl:m3.m.cl, links:m3.m.boundaryCells, surf:m3.surf, rec:m3.rec}));
await page.screenshot({ path: 'scripts/v2-3d.png' });
for (const b of ['wall','revolve','wing']) {
  await page.click(`[data-build="${b}"]`); await wait(2500);
  const r = await page.evaluate(() => { const m = window.__AEROLAB__.store.state.metrics; return [m.cd, m.cl, window.__AEROLAB__.sim3d.surface.length]; });
  console.log(b, r.map((v) => +v.toFixed(3)));
}
await page.click('[data-preset="airfoil"]'); await wait(1500);
await page.click('#run-benchmark'); await wait(6500);
console.log('bench', await page.evaluate(() => document.getElementById('bench-note').textContent));
console.log('board', await page.evaluate(() => document.getElementById('leaderboard').innerText.slice(0, 120)));
await page.screenshot({ path: 'scripts/v2-3d-wing.png' });
await page.click('[data-dim="2d"]'); await wait(1500);
await page.click('[data-input="camera"]'); await wait(800);
await page.click('#cam-start'); await wait(2500);
await page.click('#cam-center'); await wait(1500);
console.log('cam', await page.evaluate(() => [document.getElementById('cam-state').textContent, document.getElementById('cam-status').innerText]));
await page.screenshot({ path: 'scripts/v2-cam.png' });
console.log(logs.filter((l) => !l.includes('[log]')).join('\n') || 'no console issues');
await browser.close();
