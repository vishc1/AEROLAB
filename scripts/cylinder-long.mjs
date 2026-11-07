import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1512, height: 950, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto('http://localhost:5190', { waitUntil: 'networkidle0' });
await page.click('[data-preset="cylinder"]');
await new Promise((resolve) => setTimeout(resolve, 20000));
const info = await page.evaluate(() => ({
  metrics: window.__AEROLAB__.store.state.metrics,
  fps: window.__AEROLAB__.store.state.fps,
  time: window.__AEROLAB__.fluid.time,
}));
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'scripts/cylinder-long.png' });
process.exit(0);
