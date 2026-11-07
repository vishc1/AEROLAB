import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
await page.goto('http://localhost:5190', { waitUntil: 'networkidle0' });
await new Promise((resolve) => setTimeout(resolve, 5000));

const info = await page.evaluate(() => {
  const stage = document.getElementById('stage').getBoundingClientRect();
  return {
    viewport: [window.innerWidth, window.innerHeight],
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    stage: [Math.round(stage.width), Math.round(stage.height)],
    canvas: [document.getElementById('gl-canvas').width, document.getElementById('gl-canvas').height],
    fps: window.__AEROLAB__.store.state.fps,
    fluid: [window.__AEROLAB__.fluid.width, window.__AEROLAB__.fluid.height],
  };
});
console.log(JSON.stringify({ info, logs: [...new Set(logs)] }, null, 2));
await page.screenshot({ path: 'scripts/mobile.png', fullPage: true });

await page.click('#toggle-run');
await new Promise((resolve) => setTimeout(resolve, 300));
const paused = await page.evaluate(() => ({
  running: window.__AEROLAB__.store.state.running,
  bodyPaused: document.body.classList.contains('is-paused'),
  overlay: document.getElementById('pause-overlay').classList.contains('is-visible'),
  label: document.getElementById('live-label').textContent,
}));
console.log(JSON.stringify({ paused }, null, 2));

await page.click('#toggle-run');
await page.click('#open-docs');
await new Promise((resolve) => setTimeout(resolve, 400));
const modal = await page.evaluate(() => ({
  hidden: document.getElementById('docs-modal').hidden,
  title: document.getElementById('docs-title').textContent,
}));
console.log(JSON.stringify({ modal }, null, 2));
await page.screenshot({ path: 'scripts/mobile-modal.png', fullPage: false });

await browser.close();
