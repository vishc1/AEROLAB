import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('http://localhost:5190', { waitUntil: 'networkidle0' });
  await page.click('[data-input="camera"]');
  await page.waitForFunction(() => window.__AEROLAB__.camera.active, { timeout: 10000 });
  await page.click('#cam-mode-color');
  await page.click('#cam-pick-object');
  const pickerReady = await page.evaluate(() => ({
    highlighted: document.getElementById('cam-feed').classList.contains('is-picking'),
    prompt: document.getElementById('cam-prompt').textContent,
  }));
  await page.click('#cam-mode-hand');
  await page.waitForFunction(
    () => Boolean(window.__AEROLAB__.camera.handLandmarker),
    { timeout: 30000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 600));

  const result = await page.evaluate(() => {
    const feed = document.getElementById('cam-feed');
    const pixels = feed.getContext('2d').getImageData(0, 0, feed.width, feed.height).data;
    let luminance = 0;
    for (let index = 0; index < pixels.length; index += 40) {
      luminance += pixels[index] + pixels[index + 1] + pixels[index + 2];
    }
    return {
      cameraActive: window.__AEROLAB__.camera.active,
      mediaPipeReady: Boolean(window.__AEROLAB__.camera.handLandmarker),
      state: document.getElementById('cam-state').textContent,
      status: document.getElementById('cam-status').textContent.trim(),
      feedHasPixels: luminance > 0,
      privacyNoteVisible: !document.getElementById('cam-ai-note').hidden,
    };
  });
  result.pickerReady = pickerReady;

  if (!result.cameraActive || !result.mediaPipeReady || !result.feedHasPixels || !result.privacyNoteVisible || !result.pickerReady.highlighted) {
    throw new Error(`Camera AI did not initialize correctly: ${JSON.stringify(result)}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
