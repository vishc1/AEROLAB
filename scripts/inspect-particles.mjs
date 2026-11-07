import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1512, height: 950, deviceScaleFactor: 1 });
await page.goto('http://localhost:5190', { waitUntil: 'networkidle0' });
await new Promise((resolve) => setTimeout(resolve, 5000));
const data = await page.evaluate(() => {
  const app = window.__AEROLAB__;
  const gl = app.particles.gl;
  const res = app.particles.res;
  const arr = new Float32Array(res * res * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, app.particles.particles.read.fbo);
  gl.readPixels(0, 0, res, res, gl.RGBA, gl.FLOAT, arr);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let minX = 9, maxX = -9, minY = 9, maxY = -9, sumX = 0, sumY = 0, alive = 0, zero = 0;
  for (let i = 0; i < res * res; i += 1) {
    const x = arr[i * 4];
    const y = arr[i * 4 + 1];
    const w = arr[i * 4 + 3];
    if (w > 0) {
      alive += 1;
      sumX += x; sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else zero += 1;
  }

  const v = new Float32Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, app.fluid.velocity.read.fbo);
  gl.readPixels(150, 96, 1, 1, gl.RGBA, gl.FLOAT, v);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    alive, zero, minX, maxX, minY, maxY,
    meanX: sumX / alive, meanY: sumY / alive,
    sample: Array.from(arr.slice(0, 16)),
    velocityCenter: Array.from(v),
  };
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
