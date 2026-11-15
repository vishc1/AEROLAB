// Measures Cd for canonical shapes in the live solver and prints it next to
// published reference values. Requires `npm run dev -- --port 5190`.
import puppeteer from 'puppeteer-core';

const URL = process.env.URL || 'http://localhost:5190';
const CASES = [
  { preset: 'cylinder', wind: 18, visc: 0.026 },
  { preset: 'cylinder', wind: 18, visc: 0.1 },
  { preset: 'cylinder', wind: 18, visc: 0.2 },
  { preset: 'plate', wind: 18, visc: 0.026 },
  { preset: 'airfoil', wind: 18, visc: 0.026 },
];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1512, height: 950 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'networkidle0' });
for (const c of CASES) {
  await page.evaluate((c) => {
    const { store } = window.__AEROLAB__;
    store.patch({ windSpeed: c.wind, viscosity: c.visc });
    document.querySelector(`[data-preset="${c.preset}"]`)?.click();
  }, c);
  await new Promise((r) => setTimeout(r, 12000));
  const samples = [];
  for (let i = 0; i < 40; i++) {
    samples.push(await page.evaluate(() => {
      const m = window.__AEROLAB__.store.state.metrics;
      return [m.cd, m.cl, m.re];
    }));
    await new Promise((r) => setTimeout(r, 250));
  }
  const avg = (k) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
  console.log(JSON.stringify({ ...c, re: Math.round(avg(2)), cd: +avg(0).toFixed(3), cl: +avg(1).toFixed(3) }));
}
await browser.close();
