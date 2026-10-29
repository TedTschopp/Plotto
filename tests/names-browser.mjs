// Optional persistence checks in a temporary browser profile, including a full restart.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateOutline, seededRandom} from '../js/engine.js';
import {CHARACTER_NAMES_KEY} from '../js/name-storage.js';
import {CURRENT_STORY_KEY} from '../js/story-storage.js';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PLOTTO_URL || 'http://127.0.0.1:8765';
const profile = await mkdtemp(join(tmpdir(), 'plotto-names-'));
const errors = [];
let context;
const launch = async () => {
  context = await chromium.launchPersistentContext(profile, {headless: true, viewport: {width: 1360, height: 1000}});
  context.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
  const page = await context.newPage();
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(page);
  return page;
};
const ready = async (p) => p.locator('#outline[aria-busy="false"] .main-stage .story-text').waitFor();
const options = async (p) => {
  const details = p.locator('details').filter({has: p.locator('summary', {hasText: 'Names & a starting conflict'})});
  if (!await details.evaluate((node) => node.open)) await details.locator('summary').click();
};
const generate = async (p, conflict = '269') => {
  await options(p);
  await p.locator('#start-conflict').fill(conflict);
  await p.locator('#generate').click();
  await p.locator(`.main-stage .story-ref[href$="#${conflict}"]`).waitFor();
};
const savedNames = (p) => p.evaluate((key) => JSON.parse(localStorage.getItem(key)), CHARACTER_NAMES_KEY);
await mkdir('test-results', {recursive: true});
try {
  let page = await launch();
  await options(page);
  await page.locator('#name-a').fill('Márta');
  await page.locator('#name-b').fill('Sam');
  await generate(page);
  await page.locator('#name-A-3').fill('Rówan & <Co>');
  await page.locator('#name-F-B').fill('李明');
  const cast = {a: 'Márta', b: 'Sam', 'A-3': 'Rówan & <Co>', 'F-B': '李明'};
  assert.deepEqual(await savedNames(page), cast);
  await page.reload({waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.equal(await page.locator('#name-a').inputValue(), cast.a);
  assert.equal(await page.locator('#name-b').inputValue(), cast.b);
  await generate(page);
  assert.equal(await page.locator('#name-A-3').inputValue(), cast['A-3']);
  assert.equal(await page.locator('#name-F-B').inputValue(), cast['F-B']);
  await context.close();
  context = undefined;
  page = await launch();
  assert.equal(await page.locator('#name-a').inputValue(), cast.a);
  await generate(page);
  assert.equal(await page.locator('#name-A-3').inputValue(), cast['A-3']);
  assert.equal(await page.locator('#name-F-B').inputValue(), cast['F-B']);
  // Shared outlines retain their exact cast without changing local preferences.
  const book = JSON.parse(await readFile(new URL('../data/plotto-mf.json', import.meta.url), 'utf8'));
  const shared = generateOutline(book, {main: '269', names: {a: 'Visitor', b: 'Guest', 'A-3': 'Their rival'}}, seededRandom(12)).state;
  const sharedPage = await context.newPage();
  await sharedPage.goto(`${base}/#outline=${encodeURIComponent(JSON.stringify(shared))}`, {waitUntil: 'domcontentloaded'});
  await ready(sharedPage);
  assert.equal(await sharedPage.locator('#name-a').inputValue(), 'Visitor');
  assert.equal(await sharedPage.locator('#name-A-3').inputValue(), 'Their rival');
  assert.equal(await sharedPage.locator('#name-F-B').inputValue(), '');
  assert.deepEqual(await savedNames(sharedPage), cast);
  await sharedPage.locator('#name-A-3').fill('My new rival');
  assert.deepEqual(await savedNames(sharedPage), {...cast, 'A-3': 'My new rival'});
  await sharedPage.close();
  // Test reusable name preferences independently of the newly saved shared story.
  await page.evaluate((key) => localStorage.removeItem(key), CURRENT_STORY_KEY);
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.equal(await page.locator('#name-a').inputValue(), cast.a);
  await generate(page);
  assert.equal(await page.locator('#name-A-3').inputValue(), 'My new rival');
  // An empty field is remembered as empty; other names survive.
  await page.locator('#name-F-B').fill('');
  await page.locator('#name-a').fill('');
  await page.reload({waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.equal(await page.locator('#name-a').inputValue(), '');
  assert.equal(await page.locator('#name-b').inputValue(), cast.b);
  await generate(page);
  assert.equal(await page.locator('#name-F-B').inputValue(), '');
  assert.equal(await page.locator('#name-A-3').inputValue(), 'My new rival');
  assert.match(await page.locator('#name-memory-note').innerText(), /saved automatically/);
  await page.locator('#name-b').scrollIntoViewIfNeeded();
  await page.screenshot({path: 'test-results/names-desktop.png'});
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('#name-b').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path: 'test-results/names-mobile.png'});
  // Clear also works when the shared outline has no names of its own.
  const blank = {...shared, names: {a: '', b: ''}};
  await page.goto(`${base}/#outline=${encodeURIComponent(JSON.stringify(blank))}`, {waitUntil: 'domcontentloaded'});
  await ready(page);
  await options(page);
  assert.equal(await page.locator('#clear-names').isEnabled(), true);
  await page.locator('#clear-names').click();
  assert.equal(await savedNames(page), null);
  assert.equal(await page.locator('#name-A-3').inputValue(), '');
  await page.reload({waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.equal(await page.locator('#name-a').inputValue(), '');
  assert.equal(await page.locator('#name-b').inputValue(), '');
  await generate(page);
  assert.equal(await page.locator('#name-A-3').inputValue(), '');
  assert.equal(await page.locator('#clear-names').isEnabled(), false);
  // Denied reads and denied writes must not prevent naming or generation.
  const blocked = await context.newPage();
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    get() { throw new DOMException('Blocked', 'SecurityError'); },
  }));
  await blocked.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(blocked);
  await options(blocked);
  await blocked.locator('#name-a').fill('Still works');
  await generate(blocked, '75a');
  assert.match(await blocked.locator('.main-stage .story-text').innerText(), /^Still works/);
  assert.match(await blocked.locator('#name-memory-note').innerText(), /could not save/);
  await blocked.close();
  const full = await context.newPage();
  await full.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, CHARACTER_NAMES_KEY);
  await full.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(full);
  await options(full);
  await full.locator('#name-a').fill('Ada');
  assert.equal(await full.locator('#name-a').inputValue(), 'Ada');
  assert.match(await full.locator('#name-memory-note').innerText(), /could not save/);
  await generate(full, '75a');
  assert.match(await full.locator('.main-stage .story-text').innerText(), /^Ada/);
  await full.close();
  assert.deepEqual(errors, []);
  console.log('Saved-name browser checks passed: reload, complete browser restart, all cast roles, Unicode, shared-link precedence, individual edits, clearing, mobile layout and unavailable/full storage.');
} finally {
  await context?.close();
  await rm(profile, {recursive: true, force: true});
}
