// Run 3 — inspection only: reopen the existing session, go to 轨迹, and expand
// the multi_model_run tool-card row so the name + arguments + full result are
// legible in one screenshot. No new model call is made.
const fs = require('node:fs');
const path = require('node:path');
const PW = 'C:\\Users\\admin\\.dsh\\profiles\\desktop\\node_modules\\playwright-core';
const { chromium } = require(PW);

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const url = process.env.DSH_WEB_URL;
const MODELS = ['deepseek-official/deepseek-flash', 'deepseek-official/deepseek-v4-pro'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const cont = page.getByRole('button', { name: '继续', exact: true });
  if (await cont.count()) {
    await cont.first().click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  // reopen the most recent multi_model_run session from the sidebar
  const items = page.locator('text=/Call multi_model_run/');
  log('session items', await items.count());
  await items.first().click();
  await page.waitForTimeout(4000);

  // trace tab
  for (const loc of [page.getByRole('tab', { name: '轨迹' }), page.getByText('轨迹', { exact: true })]) {
    if (await loc.count()) {
      await loc.first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(3000);
      break;
    }
  }

  // inventory of elements that carry the tool name inside the trace pane
  const inv = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t.includes('multi_model_run')) continue;
      if (t.length > 400) continue;
      out.push({
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        cls: (el.className || '').toString().slice(0, 70),
        childCount: el.children.length,
        cursor: getComputedStyle(el).cursor,
        text: t.slice(0, 120),
      });
    }
    return out.slice(0, 40);
  });
  log('candidates', inv.length);
  fs.writeFileSync(path.join(OUT, 'trace-candidates.json'), JSON.stringify(inv, null, 2), 'utf8');

  // click the smallest element that looks like the tool-card row
  const pick = page
    .locator('[class*="row"], [class*="step"], [class*="call"], li, button')
    .filter({ hasText: /^multi_model_run \{/ })
    .first();
  let clicked = false;
  if (await pick.count()) {
    await pick.click({ timeout: 6000 }).catch(() => {});
    clicked = true;
  } else {
    const alt = page.locator('text=/multi_model_run \\{/').first();
    if (await alt.count()) {
      await alt.click({ timeout: 6000 }).catch(() => {});
      clicked = true;
    }
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'ui-06-toolcard-detail.png') });

  const text = await page.evaluate(() => document.body.innerText || '');
  fs.writeFileSync(path.join(OUT, 'trace-detail.txt'), text, 'utf8');
  const both = MODELS.every((m) => text.includes(m));
  console.log('CLICKED=' + clicked, 'BOTH_MODELS_IN_TRACE=' + both);
  await browser.close();
})().catch((e) => {
  console.error('RUN3_FAILED', e && e.stack ? e.stack : e);
  process.exit(2);
});
