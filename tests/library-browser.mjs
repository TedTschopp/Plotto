// Browser-level library checks, using a temporary profile and real browser restart.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateOutline, seededRandom} from '../js/engine.js';
import {CURRENT_STORY_KEY} from '../js/story-storage.js';
import {STORY_LIBRARY_KEY} from '../js/story-library.js';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PLOTTO_URL || 'http://127.0.0.1:8765';
const profile = await mkdtemp(join(tmpdir(), 'plotto-library-'));
const book = JSON.parse(await readFile(new URL('../data/plotto-mf.json', import.meta.url), 'utf8'));
const legacy = {version: 1, state: generateOutline(book, {main: '269', names: {a: 'Márta', b: 'Sam', 'A-3': 'Rówan'}}, seededRandom(12)).state,
  controls: {group: 'Love and Courtship', a: '7', b: '1', c: '5', main: '269'}};
let context;
const errors = [];
const ready = async (p) => p.locator('#outline[aria-busy="false"] .main-stage .story-text').waitFor();
const launch = async () => {
  context = await chromium.launchPersistentContext(profile, {headless: true, viewport: {width: 1360, height: 1000},
    permissions: ['clipboard-read', 'clipboard-write']});
  context.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
  await context.addInitScript(({oldKey, newKey, legacy, origin}) => {
    if (location.origin !== origin) return;
    if (!localStorage.getItem(oldKey) && !localStorage.getItem(newKey)) localStorage.setItem(oldKey, JSON.stringify(legacy));
  }, {oldKey: CURRENT_STORY_KEY, newKey: STORY_LIBRARY_KEY, legacy, origin: new URL(base).origin});
  const p = await context.newPage();
  await p.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(p);
  return p;
};
const library = (p) => p.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORY_LIBRARY_KEY);
const active = async (p) => {const lib = await library(p); return lib.stories.find((story) => story.id === lib.activeId);};
const outline = (p) => p.locator('#outline-content').innerText();
const openOptions = async (p) => {
  const summary = p.locator('summary').filter({hasText: 'Names & a starting conflict'});
  if (!await summary.evaluate((node) => node.parentElement.open)) await summary.click();
};
const choose = async (p, id) => {
  await p.locator('#story-picker').selectOption(id);
  await p.waitForFunction(({key, id}) => JSON.parse(localStorage.getItem(key)).activeId === id &&
    document.getElementById('story-picker').value === id && document.getElementById('outline').getAttribute('aria-busy') === 'false',
  {key: STORY_LIBRARY_KEY, id});
};
await mkdir('test-results', {recursive: true});
try {
  let page = await launch();
  assert.equal((await library(page)).stories.length, 1);
  assert.equal(await page.locator('#story-title').inputValue(), 'My saved story');
  assert.deepEqual((await active(page)).state, legacy.state);
  assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), CURRENT_STORY_KEY), legacy);
  await page.locator('#story-title').fill('River');
  await page.locator('#story-title').pressSequentially(' · One');
  assert.equal(await page.locator('#story-title').inputValue(), 'River · One');
  assert.ok(await page.locator('#story-title').evaluate((input) => input === document.activeElement && input.selectionStart === input.value.length));
  const firstId = (await active(page)).id;
  const firstText = await outline(page);
  await page.locator('#new-story').click();
  const secondId = (await active(page)).id;
  assert.notEqual(firstId, secondId);
  await page.locator('#story-title').fill('Second <story>');
  await openOptions(page);
  await page.locator('#start-conflict').fill('75a');
  await page.locator('#generate').click();
  await page.locator('#name-a').fill('Jamie');
  await page.locator('#name-b').fill('Sky');
  await page.locator('#name-A-3').fill('Different rival');
  await page.locator('#edition').selectOption('fm');
  await page.waitForFunction(() => document.querySelector('.main-stage .story-ref')?.getAttribute('href').startsWith('plotto-fm'));
  const secondText = await outline(page);
  const secondState = (await active(page)).state;
  await choose(page, firstId);
  assert.equal(await outline(page), firstText);
  assert.equal(await page.locator('#story-title').inputValue(), 'River · One');
  assert.equal(await page.locator('#name-A-3').inputValue(), 'Rówan');
  assert.equal(await page.locator('#edition').inputValue(), 'mf');
  await page.locator('#name-A-3').fill('Reed');
  const editedFirstText = await outline(page);
  await choose(page, secondId);
  assert.equal(await outline(page), secondText);
  assert.deepEqual((await active(page)).state, secondState);
  // Clearing the open cast must leave the other story’s cast intact.
  await openOptions(page);
  await page.locator('#clear-names').click();
  await choose(page, firstId);
  assert.equal(await outline(page), editedFirstText);
  assert.equal(await page.locator('#name-a').inputValue(), 'Márta');
  await context.close();
  context = undefined;
  page = await launch();
  assert.equal((await active(page)).id, firstId);
  assert.equal(await outline(page), editedFirstText);
  await choose(page, secondId);
  assert.equal(await page.locator('#name-a').inputValue(), '');
  await choose(page, firstId);
  await page.locator('#copy-story').click();
  const copyId = (await active(page)).id;
  assert.notEqual(copyId, firstId);
  assert.equal(await page.locator('#story-title').inputValue(), 'River · One (copy)');
  await openOptions(page);
  await page.locator('#name-a').fill('Copy only');
  await choose(page, firstId);
  assert.equal(await page.locator('#name-a').inputValue(), 'Márta');
  const shared = {...generateOutline(book, {main: '75a', names: {a: 'Guest', b: 'Visitor'}}, seededRandom(9)).state,
    title: 'Shared & <literal>'};
  const beforeShared = await library(page);
  const sharedPage = await context.newPage();
  await sharedPage.goto(`${base}/#outline=${encodeURIComponent(JSON.stringify(shared))}`, {waitUntil: 'domcontentloaded'});
  await ready(sharedPage);
  assert.equal(await sharedPage.locator('#story-title').inputValue(), shared.title);
  assert.deepEqual(await library(sharedPage), beforeShared);
  await sharedPage.locator('#save-story').click();
  assert.equal(new URL(sharedPage.url()).hash, '');
  assert.equal((await library(sharedPage)).stories.length, 4);
  await sharedPage.locator('#copy-outline').click();
  await sharedPage.waitForFunction(() => document.getElementById('status').textContent === 'Outline copied.');
  assert.ok((await sharedPage.evaluate(() => navigator.clipboard.readText())).includes(`Title: ${shared.title}`));
  await sharedPage.locator('#copy-link').click();
  await sharedPage.waitForFunction(() => document.getElementById('status').textContent.startsWith('Link copied.'));
  const url = await sharedPage.evaluate(() => navigator.clipboard.readText());
  assert.equal(JSON.parse(decodeURIComponent(new URL(url).hash.slice(9))).title, shared.title);
  await sharedPage.close();
  await choose(page, secondId);
  await choose(page, firstId);
  // A failed save must keep the current story open instead of navigating away.
  const preserved = await library(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    window.restorePlottoTestWrites = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, STORY_LIBRARY_KEY);
  await page.locator('#story-title').fill('Still open, unsaved');
  await page.locator('#story-picker').selectOption(secondId);
  assert.equal(await page.locator('#story-picker').inputValue(), firstId);
  assert.equal(await page.locator('#story-title').inputValue(), 'Still open, unsaved');
  assert.equal(await outline(page), editedFirstText);
  assert.deepEqual(await library(page), preserved);
  await page.locator('#new-story').click();
  assert.deepEqual(await library(page), preserved);
  await page.evaluate(() => window.restorePlottoTestWrites());
  await page.locator('#save-story').click();
  assert.equal((await active(page)).title, 'Still open, unsaved');
  // Failed edition loading during a switch rolls back to the open story.
  const recovery = await context.newPage();
  await recovery.route('**/data/plotto-fm.json', (route) => route.fulfill({status: 503, body: 'unavailable'}));
  await recovery.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(recovery);
  await recovery.locator('#story-picker').selectOption(secondId);
  await recovery.locator('#retry:visible').waitFor();
  assert.equal(await recovery.locator('#story-picker').inputValue(), firstId);
  assert.equal(await outline(recovery), editedFirstText);
  await recovery.unroute('**/data/plotto-fm.json');
  await recovery.locator('#retry').click();
  await ready(recovery);
  assert.equal(await recovery.locator('#story-picker').inputValue(), secondId);
  await recovery.close();
  await choose(page, secondId);
  await choose(page, firstId);
  await page.locator('.story-library').scrollIntoViewIfNeeded();
  // A stale tab must offer a separate copy instead of overwriting newer work.
  const stale = await context.newPage();
  await stale.goto(base, {waitUntil: 'domcontentloaded'});
  await ready(stale);
  await page.locator('#story-title').fill('Latest revision');
  await stale.locator('#story-title').fill('Older tab work');
  assert.match(await stale.locator('#story-memory-note').innerText(), /another tab/);
  assert.equal((await active(page)).title, 'Latest revision');
  await stale.locator('#copy-story').click();
  assert.notEqual((await active(stale)).id, firstId);
  assert.equal((await library(stale)).stories.find((entry) => entry.id === firstId).title, 'Latest revision');
  await stale.close();
  await choose(page, secondId);
  await choose(page, firstId);
  await page.locator('.story-library').scrollIntoViewIfNeeded();
  await page.screenshot({path: 'test-results/library-desktop.png'});
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.story-library').scrollIntoViewIfNeeded();
  await page.screenshot({path: 'test-results/library-mobile.png'});
  assert.deepEqual(errors, []);
  console.log('Library browser checks passed: migration, title typing, independent casts, switching, restart, copies, shared titles, save failure and failed-switch recovery.');
} finally {
  await context?.close();
  await rm(profile, {recursive: true, force: true});
}
