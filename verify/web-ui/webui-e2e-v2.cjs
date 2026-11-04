// Run 2 — canonical Web-UI evidence capture.
// Same real flow as webui-e2e.cjs, plus the 轨迹 (trace) tab so the
// multi_model_run TOOL CARD itself (name + arguments) is captured, not just the
// assistant's verbatim printout.
//
// Usage: node webui-e2e-v2.cjs   (env DSH_WEB_URL holds the printed URL incl. token)
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  if (!url) throw new Error('DSH_WEB_URL missing');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, name) });
    log('shot', name);
  };
  const mainText = () =>
    page.evaluate(() => {
      const cands = [...document.querySelectorAll('main, [class*="scroll"], [class*="conversation"], [class*="transcript"]')];
      const best = cands.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0];
      return (best ? best.innerText : document.body.innerText) || '';
    });

  const result = { url: url.split('?')[0], prompt: PROMPT, steps: [], ok: false };

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await shot('ui-01-initial.png');
  result.steps.push('loaded UI');

  const cont = page.getByRole('button', { name: '继续', exact: true });
  if (await cont.count()) {
    await cont.first().click().catch(() => {});
    await page.waitForTimeout(1200);
    result.steps.push('dismissed preview dialog');
  }

  const composer = page.locator('div[role="textbox"]').first();
  await composer.waitFor({ state: 'visible', timeout: 30000 });
  await composer.click();
  await page.keyboard.type(PROMPT, { delay: 6 });
  await page.waitForTimeout(600);
  result.composerText = await composer.innerText().catch(() => '');
  await shot('ui-02-composer-filled.png');
  result.steps.push('filled composer');

  await page.getByRole('button', { name: '发送消息' }).click({ timeout: 15000 });
  result.steps.push('clicked 发送消息');
  await page.waitForTimeout(4000);

  // wait for both models in the conversation view
  let text = '';
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    text = await mainText();
    if (MODELS.every((m) => text.includes(m))) break;
    await sleep(3000);
  }
  result.conversationText = text;
  result.sawBothInConversation = MODELS.every((m) => text.includes(m));
  result.sawToolNameInConversation = /multi_model_run/.test(text);
  log('conversation models', result.sawBothInConversation);

  // give the turn time to fully settle
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    const busy = await page.locator('button[aria-label*="停止"]').count().catch(() => 0);
    if (!busy) break;
  }
  await page.waitForTimeout(2500);
  text = await mainText();
  await shot('ui-03-final-answer.png');
  result.steps.push('captured final answer (对话 tab)');

  // --- trace tab: the actual tool card ---
  let switched = false;
  for (const loc of [
    page.getByRole('tab', { name: '轨迹' }),
    page.getByText('轨迹', { exact: true }),
  ]) {
    if (await loc.count()) {
      await loc.first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(3500);
      switched = true;
      break;
    }
  }
  result.traceTabSwitched = switched;
  if (switched) {
    const traceText = await mainText();
    fs.writeFileSync(path.join(OUT, 'trace.txt'), traceText, 'utf8');
    result.traceText = traceText.slice(0, 20000);
    result.traceHasBothModels = MODELS.every((m) => traceText.includes(m));
    result.traceHasToolName = /multi_model_run/.test(traceText);
    await shot('ui-04-trace-toolcard.png');

    // expand the tool card if it is collapsed
    const card = page.locator('text=multi_model_run').first();
    if (await card.count()) {
      await card.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await shot('ui-05-trace-toolcard-expanded.png');
      const after = await mainText();
      fs.writeFileSync(path.join(OUT, 'trace-expanded.txt'), after, 'utf8');
      result.traceExpandedHasBothModels = MODELS.every((m) => after.includes(m));
    }
  }

  result.console = consoleLines.slice(0, 60);
  result.ok =
    result.sawToolNameInConversation && result.sawBothInConversation && result.traceHasToolName !== false;

  fs.writeFileSync(path.join(OUT, 'conversation.txt'), text, 'utf8');
  fs.writeFileSync(
    path.join(OUT, 'ui-result.json'),
    JSON.stringify(result, null, 2),
    'utf8',
  );
  console.log('RESULT_OK=' + result.ok);
  console.log('TRACE_SWITCHED=' + switched);
  console.log('TRACE_TOOL_NAME=' + result.traceHasToolName);
  console.log('TRACE_BOTH_MODELS=' + result.traceHasBothModels);
  await browser.close();
})().catch((e) => {
  console.error('E2E_V2_FAILED', e && e.stack ? e.stack : e);
  process.exit(2);
});
