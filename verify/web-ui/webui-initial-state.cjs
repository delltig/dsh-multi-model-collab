// Run 5 — clean initial-state screenshot, plus a probe of the 插件 (plugins)
// panel for any listing of the patch-mounted plugin row. No model call.
const fs = require('node:fs');
const path = require('node:path');
const PW = 'C:\\Users\\admin\\.dsh\\profiles\\desktop\\node_modules\\playwright-core';
const { chromium } = require(PW);
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const url = process.env.DSH_WEB_URL;
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
    await page.waitForTimeout(1200);
  }
  const newSession = page.getByRole('button', { name: '新建会话' }).first();
  if (await newSession.count()) {
    await newSession.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: path.join(OUT, 'ui-01-initial.png') });

  const plugins = page.getByRole('button', { name: '插件', exact: true });
  if (await plugins.count()) {
    await plugins.first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, 'probe-plugins-panel.png') });
    const t = await page.evaluate(() => document.body.innerText || '');
    fs.writeFileSync(path.join(OUT, 'plugins-panel.txt'), t, 'utf8');
    log('plugin panel lists multi-model? ', /multi-model|multi_model/i.test(t));
  }
  await browser.close();
})().catch((e) => {
  console.error('RUN5_FAILED', e && e.stack ? e.stack : e);
  process.exit(2);
});
