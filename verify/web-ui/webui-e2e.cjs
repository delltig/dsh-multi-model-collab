// End-to-end Web-UI verification of the multi_model_run plugin.
// Drives the real dsh web UI in headless Chrome: fills the composer, sends a
// prompt that calls multi_model_run, waits for both model results, and captures
// screenshots + transcript/DOM evidence.
//
// Usage: node webui-e2e.cjs   (env DSH_WEB_URL holds the printed URL incl. token)
const fs = require('node:fs');
const path = require('node:path');
const PW = 'C:\\Users\\admin\\.dsh\\profiles\\desktop\\node_modules\\playwright-core';
const { chromium } = require(PW);

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const url = process.env.DSH_WEB_URL;
const PROMPT =
  "Call the multi_model_run tool exactly once with task='Reply with exactly the single word PONG and nothing else.' and print the tool result verbatim.";

const MODELS = ['deepseek-official/deepseek-flash', 'deepseek-official/deepseek-v4-pro'];
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name), fullPage: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

(async () => {
  if (!url) throw new Error('DSH_WEB_URL missing');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  const result = { url: url.split('?')[0], prompt: PROMPT, steps: [], models: {}, ok: false };

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  log('loaded', await page.title());

  // 1) dismiss the preview-notes dialog if present
  const continueBtn = page.getByRole('button', { name: '继续', exact: true });
  if (await continueBtn.count()) {
    await continueBtn.first().click().catch(() => {});
    await page.waitForTimeout(1200);
    result.steps.push('dismissed preview dialog (继续)');
  }

  // 2) fill the composer
  const composer = page.locator('div[role="textbox"]').first();
  await composer.waitFor({ state: 'visible', timeout: 30000 });
  await composer.click();
  await page.waitForTimeout(300);
  await page.keyboard.type(PROMPT, { delay: 6 });
  await page.waitForTimeout(600);
  const composerText = await composer.innerText().catch(() => '');
  result.composerText = composerText;
  await shot(page, 'ui-02-composer-filled.png');
  log('composer filled', composerText.length);

  // 3) send
  const send = page.getByRole('button', { name: '发送消息' });
  await send.click({ timeout: 15000 });
  result.steps.push('clicked 发送消息');
  await page.waitForTimeout(5000);
  await shot(page, 'ui-03-sent.png');
  log('sent');

  // 4) poll the transcript until both model ids show up
  const mainText = async () =>
    page.evaluate(() => {
      const cands = [...document.querySelectorAll('main, [class*="scroll"], [class*="conversation"], [class*="transcript"]')];
      const best = cands.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0];
      return (best ? best.innerText : document.body.innerText) || '';
    });

  let text = '';
  const deadline = Date.now() + 240000;
  let sawMultiTool = false;
  let sawBoth = false;
  while (Date.now() < deadline) {
    text = await mainText();
    sawMultiTool = /multi_model_run/.test(text);
    sawBoth = MODELS.every((m) => text.includes(m));
    if (sawBoth) break;
    await sleep(4000);
  }
  result.sawToolName = sawMultiTool;
  result.sawBothModelIds = sawBoth;
  await shot(page, 'ui-04-tool-call.png');
  log('poll done', { sawMultiTool, sawBoth });

  // 5) let the agent finish its final message
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const busy = await page
      .locator('[class*="stop"], button[aria-label*="停止"]')
      .count()
      .catch(() => 0);
    if (!busy) break;
  }
  await page.waitForTimeout(3000);
  text = await mainText();
  await shot(page, 'ui-05-final-answer.png');

  // 6) try to expand a collapsed tool card, then shoot again
  const card = page.locator('text=multi_model_run').first();
  if (await card.count()) {
    await card.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    text = await mainText();
    await shot(page, 'ui-06-tool-card-expanded.png');
    result.steps.push('clicked multi_model_run card');
  }

  // 7) evidence files
  for (const m of MODELS) result.models[m] = text.includes(m);
  result.transcriptExcerpt = text.slice(0, 20000);
  result.console = consoleLines.slice(0, 60);
  result.ok = result.sawToolName && result.sawBothModelIds;

  fs.writeFileSync(path.join(OUT, 'transcript.txt'), text, 'utf8');
  const dom = await page.evaluate(() => document.documentElement.outerHTML);
  fs.writeFileSync(path.join(OUT, 'transcript-dom.html'), dom, 'utf8');
  fs.writeFileSync(path.join(OUT, 'e2e-result.json'), JSON.stringify(result, null, 2), 'utf8');

  console.log('RESULT_OK=' + result.ok);
  console.log('TOOL_NAME_SEEN=' + result.sawToolName);
  console.log('MODELS=' + JSON.stringify(result.models));
  await browser.close();
})().catch(async (e) => {
  console.error('E2E_FAILED', e && e.stack ? e.stack : e);
  process.exit(2);
});
