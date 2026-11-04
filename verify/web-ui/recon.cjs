// Recon of the dsh web UI: screenshot + DOM inventory of interactive elements.
// Usage: node recon.cjs   (env DSH_WEB_URL must hold the printed URL incl. token)
const path = require('node:path');
const PW = 'C:\\Users\\admin\\.dsh\\profiles\\desktop\\node_modules\\playwright-core';
const { chromium } = require(PW);

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const url = process.env.DSH_WEB_URL;

(async () => {
  if (!url) throw new Error('DSH_WEB_URL missing');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, 'recon-01-initial.png') });

  const info = await page.evaluate(() => {
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const all = [...document.querySelectorAll('*')];
    const interactive = all
      .filter((el) =>
        ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
        el.getAttribute('role') === 'button' ||
        el.isContentEditable ||
        el.getAttribute('contenteditable') === 'true')
      .slice(0, 120)
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        id: el.id || '',
        cls: (el.className || '').toString().slice(0, 80),
        aria: el.getAttribute('aria-label') || '',
        ph: el.getAttribute('placeholder') || '',
        testid: el.getAttribute('data-testid') || '',
        text: txt(el).slice(0, 80),
      }));
    return {
      title: document.title,
      bodyText: (document.body.innerText || '').slice(0, 4000),
      htmlLen: document.documentElement.outerHTML.length,
      interactive,
      textareas: [...document.querySelectorAll('textarea,[contenteditable="true"]')].map((el) => ({
        tag: el.tagName,
        cls: (el.className || '').toString(),
        ph: el.getAttribute('placeholder') || '',
        aria: el.getAttribute('aria-label') || '',
      })),
    };
  });

  console.log(JSON.stringify({ urlPath: url.split('?')[0], info, consoleLines: consoleLines.slice(0, 40) }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('RECON_FAILED', e && e.stack ? e.stack : e);
  process.exit(2);
});
