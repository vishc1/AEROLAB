import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1512, height: 950, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
await page.goto('http://localhost:5190', { waitUntil: 'networkidle0' });
await new Promise((resolve) => setTimeout(resolve, 8000));
const info = await page.evaluate(() => ({
  fps: window.__AEROLAB__.store.state.fps,
  metrics: window.__AEROLAB__.store.state.metrics,
  time: window.__AEROLAB__.fluid.time,
  bodyHeight: document.body.scrollHeight,
  controlsBottom: document.querySelector('.lab-controls')?.getBoundingClientRect().bottom,
  viewport: window.innerHeight,
}));
console.log(JSON.stringify({ info, logs: [...new Set(logs)] }, null, 2));
await page.screenshot({ path: 'scripts/final-viewport.png' });
await page.screenshot({ path: 'scripts/final-full.png', fullPage: true });
await browser.close();
