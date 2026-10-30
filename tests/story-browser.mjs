// Optional current-story checks in a temporary profile, including a full restart.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateOutline, seededRandom} from '../js/engine.js';
import {STORY_LIBRARY_KEY} from '../js/story-library.js';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PLOTTO_URL || 'http://127.0.0.1:8765';
const profile = await mkdtemp(join(tmpdir(), 'plotto-story-'));
const errors = [];
let context;
const ready = async (p) => p.locator('#outline[aria-busy="false"] .main-stage .story-text').waitFor();
const launch = async () => {
  context = await chromium.launchPersistentContext(profile, {headless: true, viewport: {width: 1360, height: 1000}});
  context.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
  const page = await context.newPage();
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(page);
  return page;
};
const openOptions = async (p) => {
  const summary = p.locator('summary').filter({hasText: 'Names & a starting conflict'});
  if (!await summary.evaluate((node) => node.parentElement.open)) await summary.click();
};
const saved = (p) => p.evaluate((key) => {
  const library = JSON.parse(localStorage.getItem(key));
  const story = library.stories.find((entry) => entry.id === library.activeId);
  return {version: 1, state: story.state, controls: story.controls};
}, STORY_LIBRARY_KEY);
const snapshot = async (p) => ({text: await p.locator('#outline-content').innerText(),
  controls: await p.locator('#generator-fields').evaluate((fields) => Object.fromEntries(
    ['edition', 'theme', 'action', 'protagonist', 'ending', 'start-conflict', 'name-a', 'name-b']
      .map((id) => [id, fields.querySelector(`#${id}`).value]))), stored: await saved(p)});
await mkdir('test-results', {recursive: true});
try {
  let page = await launch();
  await page.locator('summary').filter({hasText: 'Shape the masterplot'}).click();
  await page.locator('#theme').selectOption('Love and Courtship');
  await page.locator('#protagonist').selectOption('7');
  await page.locator('#action').selectOption('1');
  await page.locator('#ending').selectOption('5');
  await openOptions(page);
  await page.locator('#name-a').fill('Márta');
  await page.locator('#name-b').fill('Sam');
  await page.locator('#start-conflict').fill('269');
  await page.locator('#generate').click();
  await page.locator('#name-A-3').fill('Rówan');
  await page.locator('#name-F-B').fill('李明');
  for (const direction of ['before', 'after']) {
    const button = page.locator(`#${direction}-reroll`);
    if (await button.isEnabled()) {
      const previous = (await saved(page)).state[direction];
      await button.click();
      const next = (await saved(page)).state[direction];
      assert.notEqual(next.group, previous.group);
      assert.ok(Number.isInteger(next.seed));
    }
  }
  await page.locator('#edition').selectOption('fm');
  await page.waitForFunction(() => document.querySelector('.main-stage .story-ref')?.getAttribute('href').startsWith('plotto-fm'));
  const expected = await snapshot(page);
  assert.equal(expected.stored.state.edition, 'fm');
  assert.equal(expected.stored.state.main, '269');
  await page.reload({waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.deepEqual(await snapshot(page), expected);
  assert.match(await page.locator('#status').innerText(), /Your last story restored/);
  await context.close();
  context = undefined;
  page = await launch();
  assert.deepEqual(await snapshot(page), expected);
  assert.equal(await page.locator('#name-A-3').inputValue(), 'Rówan');
  // A failed dataset request and retry must preserve the saved story.
  const recovery = await context.newPage();
  await recovery.route('**/data/plotto-fm.json*', (route) => route.fulfill({status: 503, body: 'unavailable'}));
  await recovery.goto(base, {waitUntil: 'domcontentloaded'});
  await recovery.locator('#retry:visible').waitFor();
  assert.deepEqual(await saved(recovery), expected.stored);
  await recovery.unroute('**/data/plotto-fm.json*');
  await recovery.locator('#retry').click();
  await ready(recovery);
  assert.deepEqual(await snapshot(recovery), expected);
  await recovery.close();
  await page.locator('#outline-title').scrollIntoViewIfNeeded();
  await page.screenshot({path: 'test-results/story-desktop.png'});
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#outline-title').scrollIntoViewIfNeeded();
  await page.screenshot({path: 'test-results/story-mobile.png'});
  await page.setViewportSize({width: 1360, height: 1000});
  // Failed generation must leave the last successful save intact.
  await openOptions(page);
  await page.locator('#start-conflict').fill('1463');
  await page.locator('#generate').click();
  assert.deepEqual(await saved(page), expected.stored);
  // Choosing a new main conflict from search replaces the saved story.
  await page.locator('#search').fill('542');
  await page.locator('.conflict-result button').click();
  const nextStory = await snapshot(page);
  assert.equal(nextStory.stored.state.main, '542');
  await page.reload({waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.deepEqual(await snapshot(page), nextStory);
  const book = JSON.parse(await readFile(new URL('../data/plotto-mf.json', import.meta.url), 'utf8'));
  const shared = generateOutline(book, {main: '75a', names: {a: 'Guest', b: 'Visitor'}}, seededRandom(12)).state;
  const sharedPage = await context.newPage();
  await sharedPage.goto(`${base}/#outline=${encodeURIComponent(JSON.stringify(shared))}`, {waitUntil: 'domcontentloaded'});
  await ready(sharedPage);
  assert.equal(await sharedPage.locator('#name-a').inputValue(), 'Guest');
  assert.deepEqual(await saved(sharedPage), nextStory.stored);
  assert.match(await sharedPage.locator('#story-memory-note').innerText(), /separate draft/);
  await sharedPage.locator('#name-A-3').fill('New rival');
  const editedShared = await snapshot(sharedPage);
  assert.equal(editedShared.stored.state.main, '75a');
  await sharedPage.close();
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.deepEqual(await snapshot(page), editedShared);
  // Clearing names updates the saved story without changing its plot choices.
  await openOptions(page);
  await page.locator('#clear-names').click();
  const unnamed = await snapshot(page);
  await page.reload({waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.deepEqual(await snapshot(page), unnamed);
  assert.equal(await page.locator('#name-A-3').inputValue(), '');
  await openOptions(page);
  await page.locator('#name-a').fill('Kept name');
  const beforeCorruption = await page.evaluate((key) => localStorage.getItem(key), STORY_LIBRARY_KEY);
  await page.evaluate((key) => localStorage.setItem(key, '{broken'), STORY_LIBRARY_KEY);
  await page.reload({waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.match(await page.locator('#status').innerText(), /Saved stories could not be read/);
  assert.equal(await page.locator('#name-a').inputValue(), 'Kept name');
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORY_LIBRARY_KEY), '{broken');
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key: STORY_LIBRARY_KEY, value: beforeCorruption});
  await page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key));
    stored.stories.find((entry) => entry.id === stored.activeId).state.hash = 'older-source';
    localStorage.setItem(key, JSON.stringify(stored));
  }, STORY_LIBRARY_KEY);
  await page.reload({waitUntil: 'domcontentloaded'});
  await ready(page);
  assert.match(await page.locator('#status').innerText(), /saved story could not be restored/);
  assert.equal(await page.locator('#generate').isEnabled(), true);
  assert.equal((await saved(page)).state.hash, book.sourceHash);
  // Blocked or full storage keeps the app usable and the prior save intact.
  const previousSave = await saved(page);
  const full = await context.newPage();
  await full.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, STORY_LIBRARY_KEY);
  await full.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(full);
  await openOptions(full);
  await full.locator('#name-a').fill('Unsaved name');
  assert.match(await full.locator('#story-memory-note').innerText(), /could not save your story/);
  assert.deepEqual(await saved(full), previousSave);
  await full.close();
  const blocked = await context.newPage();
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    get() { throw new DOMException('Blocked', 'SecurityError'); },
  }));
  await blocked.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(blocked);
  assert.match(await blocked.locator('#story-memory-note').innerText(), /Copy a link/);
  assert.equal(await blocked.locator('#generate').isEnabled(), true);
  await blocked.close();
  assert.deepEqual(errors, []);
  console.log('Current-story browser checks passed: exact reload/restart, settings, cast, rerolls, edition, search, shared links, clearing names, invalid saves, dataset retry and unavailable/full storage.');
} finally {
  await context?.close();
  await rm(profile, {recursive: true, force: true});
}
