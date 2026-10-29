import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateOutline, renderOutline, seededRandom, MAX_SHARED_HASH_LENGTH} from '../js/engine.js';
import {CURRENT_STORY_KEY, loadCurrentStory, saveCurrentStory} from '../js/story-storage.js';

const books = ['mf', 'fm'].map((edition) => JSON.parse(readFileSync(new URL(`../data/plotto-${edition}.json`, import.meta.url))));
const memoryStorage = () => {
  const data = new Map();
  return {getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
};
const controls = {group: 'Love and Courtship', b: '1', a: '7', c: '5', main: '75a'};

test('saved stories reproduce the exact outline, names, edition and generator choices', () => {
  for (const book of books) {
    const storage = memoryStorage();
    const outline = generateOutline(book, {...controls, names: {a: 'Márta', b: 'Sam', 'A-3': 'Rówan'}}, seededRandom(12));
    outline.state.before.group = outline.before.group;
    outline.state.after.group = outline.after.group;
    assert.equal(saveCurrentStory(book, outline.state, controls, () => storage), true);
    const loaded = loadCurrentStory(() => storage);
    assert.equal(loaded.available, true);
    assert.equal(loaded.invalid, false);
    assert.deepEqual(loaded.snapshot.state, outline.state);
    assert.deepEqual(loaded.snapshot.controls, controls);
    assert.deepEqual(renderOutline(book, loaded.snapshot.state), renderOutline(book, outline.state));
  }
});

test('missing and malformed saved stories have a usable recovery result', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadCurrentStory(() => storage), {snapshot: null, available: true, invalid: false});
  for (const raw of ['{broken', 'null', '[]', '{"version":2}', '{"version":1,"state":[]}',
    '{"version":1,"state":{"edition":"unknown"}}', 'x'.repeat(MAX_SHARED_HASH_LENGTH + 1)]) {
    storage.setItem(CURRENT_STORY_KEY, raw);
    assert.deepEqual(loadCurrentStory(() => storage), {snapshot: null, available: true, invalid: true});
  }
});

test('invalid changes and old source revisions cannot replace a valid saved story', () => {
  const storage = memoryStorage();
  const book = books[0];
  const state = generateOutline(book, {main: '75a'}, seededRandom(12)).state;
  saveCurrentStory(book, state, controls, () => storage);
  const saved = storage.getItem(CURRENT_STORY_KEY);
  for (const change of [{hash: 'old'}, {main: '1463'}, {names: {a: {}, b: ''}}, {before: {seed: -1}}]) {
    assert.equal(saveCurrentStory(book, {...state, ...change}, controls, () => storage), false);
    assert.equal(storage.getItem(CURRENT_STORY_KEY), saved);
  }
});

test('saved controls are bounded and contain no extra fields or cast preferences', () => {
  const storage = memoryStorage();
  const state = generateOutline(books[0], {main: '75a'}, seededRandom(12)).state;
  assert.equal(saveCurrentStory(books[0], state, {...controls, group: 'x'.repeat(65), a: {}, main: '<bad>',
    names: {a: 'Other cast'}, extra: 'unused'}, () => storage), true);
  assert.deepEqual(loadCurrentStory(() => storage).snapshot.controls, {group: '', b: '1', a: '', c: '5', main: ''});
});

test('unavailable or full storage leaves existing saved work untouched', () => {
  const blocked = () => { throw new Error('SecurityError'); };
  assert.deepEqual(loadCurrentStory(blocked), {snapshot: null, available: false, invalid: false});
  const storage = memoryStorage();
  const state = generateOutline(books[0], {main: '75a'}, seededRandom(12)).state;
  storage.setItem('plotto-character-names-v1', 'separate cast');
  saveCurrentStory(books[0], state, controls, () => storage);
  const saved = storage.getItem(CURRENT_STORY_KEY);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(saveCurrentStory(books[0], state, controls, blocked), false);
  assert.equal(saveCurrentStory(books[0], {...state, a: 1}, controls, () => storage), false);
  assert.equal(storage.getItem(CURRENT_STORY_KEY), saved);
  assert.equal(storage.getItem('plotto-character-names-v1'), 'separate cast');
});
