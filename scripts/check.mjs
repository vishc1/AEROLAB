import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1512, height: 950, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
page.on('requestfailed', (request) =>
  logs.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`),
);

await page.goto('http://localhost:5190', { waitUntil: 'networkidle0' });
await new Promise((resolve) => setTimeout(resolve, 7000));

const state = await page.evaluate(() => {
  const app = window.__AEROLAB__;
  const canvas = document.getElementById('gl-canvas');
  const overlay = document.getElementById('error-overlay');
  return {
    hasApp: Boolean(app),
    errorVisible: overlay ? !overlay.hidden : null,
    errorText: document.getElementById('error-text')?.textContent,
    canvas: canvas ? [canvas.width, canvas.height] : null,
    state: app ? JSON.parse(JSON.stringify(app.store.state)) : null,
    glInfo: app
      ? {
          size: app.fluid.size,
          width: app.fluid.width,
          height: app.fluid.height,
          iterations: app.fluid.iterations,
          time: app.fluid.time,
          pressure: [app.fluid.pressure.read.width, app.fluid.pressure.read.height],
          mask: [app.mask.width, app.mask.height],
          history: app.telemetry.history.length,
        }
      : null,
  };
});
console.log(JSON.stringify({ logs: [...new Set(logs)], state }, null, 2));

await page.screenshot({ path: 'scripts/new-viewport.png', fullPage: false });
await page.screenshot({ path: 'scripts/new-full.png', fullPage: true });

// benchmark
await page.click('#run-benchmark');
await new Promise((resolve) => setTimeout(resolve, 6200));
const bench = await page.evaluate(() => ({
  benchmark: window.__AEROLAB__.store.state.benchmark,
  label: document.getElementById('bench-label')?.textContent,
  note: document.getElementById('bench-note')?.textContent,
}));
console.log(JSON.stringify({ bench }, null, 2));

// geometry interaction
await page.click('[data-preset="cylinder"]');
await new Promise((resolve) => setTimeout(resolve, 1500));
const stage = await page.$('#stage');
const box = await stage.boundingBox();
await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.42);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.58, { steps: 10 });
await page.mouse.up();
await page.evaluate(() => window.__AEROLAB__.setResolution(256));
await new Promise((resolve) => setTimeout(resolve, 5000));

const interaction = await page.evaluate(() => {
  const s = window.__AEROLAB__.store.state;
  return {
    preset: s.preset,
    resolution: s.resolution,
    fluid: [window.__AEROLAB__.fluid.width, window.__AEROLAB__.fluid.height],
    fps: s.fps,
    metrics: s.metrics,
    benchmark: s.benchmark,
  };
});
console.log(JSON.stringify({ interaction, logs: [...new Set(logs)] }, null, 2));
await page.screenshot({ path: 'scripts/new-cylinder.png', fullPage: false });

await browser.close();
