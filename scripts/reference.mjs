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
await page.goto('https://slipstream-indol.vercel.app/', {
  waitUntil: 'networkidle0',
  timeout: 60000,
});
await new Promise((resolve) => setTimeout(resolve, 4000));
console.log(JSON.stringify(logs, null, 2));
console.log(await page.title());
await page.screenshot({ path: 'scripts/reference.png', fullPage: false });
process.exit(0);
