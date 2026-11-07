import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1512, height: 950, deviceScaleFactor: 1 });
await page.goto('https://slipstream-indol.vercel.app/', {
  waitUntil: 'networkidle0',
  timeout: 60000,
});
await new Promise((resolve) => setTimeout(resolve, 4000));
const height = await page.evaluate(() => document.body.scrollHeight);
console.log('height', height);
await page.screenshot({ path: 'scripts/reference-full.png', fullPage: true });
await page.evaluate(() => window.scrollBy(0, 700));
await new Promise((resolve) => setTimeout(resolve, 1200));
await page.screenshot({ path: 'scripts/reference-lower.png' });
process.exit(0);
