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
await new Promise((resolve) => setTimeout(resolve, 8000));

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
          iterations: app.fluid.iterations,
          time: app.fluid.time,
          pressure: app.fluid.pressure.read.width,
          particles: app.particles.res,
          history: app.telemetry.history.length,
        }
      : null,
  };
});

const uniqueLogs = [...new Set(logs)];
console.log(JSON.stringify({ logs: uniqueLogs, state }, null, 2));

await page.screenshot({ path: 'scripts/smoke.png', fullPage: false });

// Interaction smoke test: pause, select cylinder, draw, resolution change.
await page.click('[data-preset="cylinder"]');
await new Promise((resolve) => setTimeout(resolve, 1200));
await page.mouse.move(700, 480);
await page.mouse.down();
await page.mouse.move(740, 520, { steps: 8 });
await page.mouse.up();
await page.evaluate(() => window.__AEROLAB__.setResolution(256));
await new Promise((resolve) => setTimeout(resolve, 6000));
const interaction = await page.evaluate(() => ({
  preset: window.__AEROLAB__.store.state.preset,
  resolution: window.__AEROLAB__.store.state.resolution,
  fluidSize: window.__AEROLAB__.fluid.size,
  fps: window.__AEROLAB__.store.state.fps,
  metrics: window.__AEROLAB__.store.state.metrics,
}));
console.log(JSON.stringify({ interaction }, null, 2));

await page.screenshot({ path: 'scripts/smoke-cylinder.png', fullPage: false });
await browser.close();
