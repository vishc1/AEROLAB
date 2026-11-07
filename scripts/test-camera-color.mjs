import puppeteer from 'puppeteer-core';

const videoFile = process.argv[2];
const clickX = Number(process.argv[3] || 0.5);
const clickY = Number(process.argv[4] || 0.5);
if (!videoFile) throw new Error('Usage: node scripts/test-camera-color.mjs <fixture.y4m> [x-ratio] [y-ratio]');

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${videoFile}`,
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://localhost:5190', { waitUntil: 'networkidle0' });
  await page.click('[data-input="camera"]');
  await page.waitForFunction(() => window.__AEROLAB__.camera.active, { timeout: 10000 });
  await page.waitForFunction(() => window.__AEROLAB__.camera.video.readyState >= 2, { timeout: 10000 });
  await page.click('#cam-mode-color');
  await page.evaluate(({ clickX, clickY }) => {
    window.__AEROLAB__.camera.sampleAt(240 * clickX, 160 * clickY);
  }, { clickX, clickY });
  try {
    await page.waitForFunction(() => window.__AEROLAB__.camera.objectTracked, { timeout: 8000 });
  } catch {
    // Fall through so failures include the sampled color and detector state.
  }
  const result = await page.evaluate(() => ({
    selected: document.getElementById('cam-hex').textContent,
    coverage: document.getElementById('cam-coverage').textContent,
    status: document.getElementById('cam-status').textContent.trim(),
    prompt: document.getElementById('cam-prompt').textContent,
    tracked: window.__AEROLAB__.camera.objectTracked,
    usable: window.__AEROLAB__.camera.usable,
    sourceCenter: window.__AEROLAB__.camera.trackedSourceCenter,
    hueProfile: window.__AEROLAB__.camera.colorProfile,
    selectedPoint: window.__AEROLAB__.camera.selectedPoint,
  }));
  if (!result.tracked || !result.usable) throw new Error(`Color object was not isolated: ${JSON.stringify(result)}`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
