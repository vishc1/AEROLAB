import puppeteer from 'puppeteer-core';

const modelPath = process.argv[2] || '/tmp/aerolab-test.glb';
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
  await page.setViewport({ width: 1512, height: 1050, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('http://localhost:5190', { waitUntil: 'networkidle0' });
  await page.click('[data-input="model"]');
  await page.waitForFunction(() => !document.getElementById('model-browse').disabled);
  const input = await page.$('#model-file');
  await input.uploadFile(modelPath);
  await page.waitForFunction(
    () => document.getElementById('model-status').dataset.state === 'ready',
    { timeout: 15000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 1800));

  const result = await page.evaluate(() => {
    const app = window.__AEROLAB__;
    const solidCells = app.mask.getCpuMask().reduce((sum, value) => sum + value, 0);
    return {
      solidCells,
      state: document.getElementById('model-status').dataset.state,
      status: document.getElementById('model-status').textContent.trim(),
      filename: document.getElementById('model-name').textContent,
      triangles: document.getElementById('model-tris').textContent,
      drag: app.store.state.metrics.cd,
      lift: app.store.state.metrics.cl,
      modelReady: Boolean(app.modelImporter?.modelScene),
    };
  });

  if (!result.modelReady || result.solidCells < 20) {
    throw new Error(`Model did not create a usable tunnel mask: ${JSON.stringify(result)}`);
  }
  if (!Number.isFinite(result.drag) || !Number.isFinite(result.lift)) {
    throw new Error(`Model projection destabilized telemetry: ${JSON.stringify(result)}`);
  }

  await page.click('#model-hand-ar');
  await page.waitForFunction(
    () => Boolean(
      window.__AEROLAB__.modelImporter?.handArStream
      && window.__AEROLAB__.modelImporter?.handLandmarker
      && window.__AEROLAB__.modelImporter?.handArRunning
    ),
    { timeout: 30000 },
  );
  const handAr = await page.evaluate(() => {
    const importer = window.__AEROLAB__.modelImporter;
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    landmarks[0] = { x: 0.5, y: 0.74, z: 0 };
    landmarks[5] = { x: 0.37, y: 0.53, z: 0 };
    landmarks[9] = { x: 0.5, y: 0.44, z: -0.02 };
    landmarks[13] = { x: 0.59, y: 0.49, z: 0 };
    landmarks[17] = { x: 0.67, y: 0.56, z: 0.01 };
    const anchored = importer.updateHandAnchor(landmarks);
    const value = {
      cameraActive: Boolean(importer.handArStream),
      mediaPipeReady: Boolean(importer.handLandmarker),
      anchored,
      visible: importer.handArAnchor.visible,
      scale: importer.handArAnchor.scale.x,
      canvas: [document.getElementById('handar-canvas').width, document.getElementById('handar-canvas').height],
    };
    importer.showModelPreview();
    return value;
  });
  if (!handAr.cameraActive || !handAr.mediaPipeReady || !handAr.anchored || !handAr.visible || handAr.scale <= 0) {
    throw new Error(`Hand AR did not anchor the uploaded model: ${JSON.stringify(handAr)}`);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ ...result, handAr }, null, 2));
  await page.screenshot({ path: 'scripts/model-upload.png', fullPage: true });
} finally {
  await browser.close();
}
