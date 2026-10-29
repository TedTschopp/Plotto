// Optional supporting-cast browser checks; uses the same environment as browser.mjs.
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PLOTTO_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1360, height: 1000}, permissions: ['clipboard-read', 'clipboard-write']});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const name = 'Rówan & <Co>';
const rival = (p = page) => p.getByLabel('Name for A-3 (optional)', {exact: true});
const main = (p = page) => p.locator('.main-stage .story-text');
const ready = async (p = page) => p.locator('#outline[aria-busy="false"] .main-stage .story-text').waitFor();
const generate = async (conflict) => {
  await page.locator('#start-conflict').fill(conflict);
  await page.locator('#generate').click();
  await page.locator(`.main-stage .story-ref[href$="#${conflict}"]`).waitFor();
};
await mkdir('test-results', {recursive: true});
try {
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await ready();
  await page.locator('summary').filter({hasText: 'Names & a starting conflict'}).click();
  await generate('269');
  assert.equal(await rival().isVisible(), true);
  assert.equal(await page.locator('#role-A-3').innerText(), 'male rival or enemy of A');
  assert.equal(await page.locator('#role-F-B').innerText(), 'father of B');
  assert.equal(await rival().getAttribute('aria-describedby'), 'role-A-3');
  await rival().pressSequentially('Rowan');
  assert.equal(await rival().inputValue(), 'Rowan');
  assert.ok(await rival().evaluate((input) => input === document.activeElement && input.selectionStart === 5));
  await rival().evaluate((input) => input.setSelectionRange(1, 1));
  await rival().pressSequentially('x');
  assert.equal(await rival().inputValue(), 'Rxowan');
  assert.ok(await rival().evaluate((input) => input === document.activeElement && input.selectionStart === 2));
  await rival().fill(name);
  await page.getByLabel('Name for F-B (optional)', {exact: true}).fill('李明');
  assert.ok((await main().innerText()).includes(name));
  assert.ok((await main().innerText()).includes('李明'));
  assert.equal(await main().locator('*').count(), 0);
  assert.ok((await page.locator('#characters dt').allTextContents()).includes(`A-3 · ${name}`));
  await page.locator('#copy-outline').click();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Outline copied.');
  const exported = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(exported.includes(`A-3 = ${name}`));
  assert.ok(exported.includes('F-B = 李明'));
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-outline').click();
  const download = await downloadPromise;
  assert.equal(await readFile(await download.path(), 'utf8'), exported);
  await page.locator('#copy-link').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Link copied.'));
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const restored = await context.newPage();
  await restored.goto(url, {waitUntil: 'domcontentloaded'});
  await ready(restored);
  assert.equal(await rival(restored).inputValue(), name);
  assert.equal(await restored.getByLabel('Name for F-B (optional)', {exact: true}).inputValue(), '李明');
  assert.equal(await restored.locator('#outline-content').innerText(), await page.locator('#outline-content').innerText());
  await restored.close();
  // Keep a name through linked rerolls, a different story, and an edition change.
  await generate('75a');
  assert.equal(await rival().inputValue(), name);
  for (const direction of ['before', 'after']) {
    if (await page.locator(`#${direction}-reroll`).isEnabled()) {
      await page.locator(`#${direction}-reroll`).click();
      assert.equal(await rival().inputValue(), name);
    }
  }
  await page.locator('#edition').selectOption('fm');
  await page.waitForFunction(() => document.getElementById('role-A-3')?.textContent === 'female rival or enemy of A');
  assert.equal(await rival().inputValue(), name);
  await rival().fill('');
  assert.match(await main().innerText(), /A-3/);
  await rival().fill(name);
  await generate('269');
  assert.equal(await rival().inputValue(), name);
  // Capture the new fields in both responsive layouts.
  await page.locator('#supporting-cast').scrollIntoViewIfNeeded();
  await page.screenshot({path: 'test-results/cast-desktop.png'});
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#supporting-cast').scrollIntoViewIfNeeded();
  await page.screenshot({path: 'test-results/cast-mobile.png'});
  await rival().fill('R'.repeat(60));
  await page.locator('#character-key summary').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // A dataset failure must also disable the new name fields.
  const recovery = await context.newPage();
  await recovery.route('**/data/plotto-fm.json', (route) => route.fulfill({status: 503, body: 'unavailable'}));
  await recovery.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(recovery);
  await recovery.locator('summary').filter({hasText: 'Names & a starting conflict'}).click();
  await recovery.locator('#start-conflict').fill('75a');
  await recovery.locator('#generate').click();
  await rival(recovery).waitFor();
  await recovery.locator('#edition').selectOption('fm');
  await recovery.locator('#retry:visible').waitFor();
  assert.equal(await recovery.locator('#supporting-cast').evaluate((section) => section.inert), true);
  await recovery.locator('#edition').selectOption('mf');
  await ready(recovery);
  assert.equal(await recovery.locator('#supporting-cast').evaluate((section) => section.inert), false);
  await recovery.close();
  assert.deepEqual(errors, []);
  console.log('Supporting cast checks passed: detection, role labels, typing/caret, Unicode and literal names, copy/download, share restore, rerolls, regeneration, editions, clearing, mobile layout and loading recovery.');
} finally {
  await browser.close();
}
