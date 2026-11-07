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
if (!state.hasApp || state.errorVisible) throw new Error(`App failed to initialize: ${state.errorText}`);
if (!Number.isFinite(state.state.metrics.cd) || !Number.isFinite(state.state.metrics.cl)) {
  throw new Error('Drag or lift telemetry is not finite');
}
if (state.state.fps < 24 || state.glInfo.history < 10) {
  throw new Error(`Solver did not reach a healthy live state: ${JSON.stringify(state.glInfo)}`);
}
await browser.close();
