// Run 4 — inspection only: widen the trace view so the multi_model_run tool-call
// row is legible in one frame (name + arguments + both model ids in the result
// preview). No new model call.
const fs = require('node:fs');
const path = require('node:path');
const PW = 'C:\\Users\\admin\\.dsh\\profiles\\desktop\\node_modules\\playwright-core';
const { chromium } = require(PW);
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const url = process.env.DSH_WEB_URL;
const MODELS = ['deepseek-official/deepseek-flash', 'deepseek-official/deepseek-v4-pro'];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const cont = page.getByRole('button', { name: '继续', exact: true });
  if (await cont.count()) {
    await cont.first().click().catch(() => {});
    await page.waitForTimeout(1000);
  }
  // open the run-2 session
  await page.locator('[role="treeitem"]', { hasText: 'Call multi_model_run with PONG task' }).first().click();
  await page.waitForTimeout(3500);

  for (const loc of [page.getByRole('tab', { name: '轨迹' }), page.getByText('轨迹', { exact: true })]) {
    if (await loc.count()) {
      await loc.first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(3000);
      break;
    }
  }
  // shrink type so the whole row fits
  await page.addStyleTag({ content: 'html{zoom:0.8}' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'ui-06-trace-wide.png') });

  // try the 调用 (calls) filter for a per-call list
  const callsBtn = page.getByText('调用', { exact: true });
  if (await callsBtn.count()) {
    await callsBtn.first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'ui-07-trace-calls.png') });
    log('calls view shot');
  }
  const text = await page.evaluate(() => document.body.innerText || '');
  fs.writeFileSync(path.join(OUT, 'trace-wide.txt'), text, 'utf8');
  console.log('BOTH=' + MODELS.every((m) => text.includes(m)));
  await browser.close();
})().catch((e) => {
  console.error('RUN4_FAILED', e && e.stack ? e.stack : e);
  process.exit(2);
});
