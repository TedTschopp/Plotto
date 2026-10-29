import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateOutline, seededRandom} from '../js/engine.js';
import {loadCharacterNames, saveCharacterNames, CHARACTER_NAMES_KEY} from '../js/name-storage.js';

const books = ['mf', 'fm'].map((edition) => JSON.parse(readFileSync(new URL(`../data/plotto-${edition}.json`, import.meta.url))));
const memoryStorage = () => {
  const data = new Map();
  return {getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key)};
};

test('saved main and supporting names restore a usable cast in either edition', () => {
  const storage = memoryStorage();
  const names = {a: 'Márta', b: 'Sam', 'A-3': 'Rówan & <Co>', 'F-B': '李明'};
  assert.equal(saveCharacterNames(books[0], names, () => storage), true);
  for (const book of books) {
    const restored = loadCharacterNames(book, () => storage);
    assert.equal(restored.available, true);
    assert.deepEqual(restored.names, names);
    assert.deepEqual(generateOutline(book, {main: '269', names: restored.names}, seededRandom(12)).state.names, names);
  }
});

test('corrupted or unsupported saved values cannot break outline generation', () => {
  const storage = memoryStorage();
  for (const raw of ['{broken', 'null', '[]', '"name"', '42',
    '{"a":{},"b":"Sam","A-3":"Rowan","unknown":"bad","__proto__":"bad"}']) {
    storage.setItem(CHARACTER_NAMES_KEY, raw);
    const restored = loadCharacterNames(books[0], () => storage);
    assert.equal(restored.available, true);
    assert.doesNotThrow(() => generateOutline(books[0], {main: '75a', names: restored.names}));
    assert.equal(Object.hasOwn(restored.names, '__proto__'), false);
    assert.equal(Object.hasOwn(restored.names, 'unknown'), false);
  }
});

test('restored names are trimmed and bounded before being reused', () => {
  const storage = memoryStorage();
  storage.setItem(CHARACTER_NAMES_KEY, JSON.stringify({a: '  Ada  ', b: 'x'.repeat(100),
    ...Object.fromEntries(Array.from({length: 150}, (_, i) => [`CH-${i + 1}`, 'Child']))}));
  const {names} = loadCharacterNames(books[0], () => storage);
  assert.equal(names.a, 'Ada');
  assert.equal(names.b.length, 60);
  assert.equal(Object.keys(names).length, 128);
  assert.doesNotThrow(() => generateOutline(books[0], {main: '75a', names}));
});

test('clearing all names removes only Plotto’s saved cast', () => {
  const storage = memoryStorage();
  storage.setItem('theme', 'dark');
  saveCharacterNames(books[0], {a: 'Ada', b: '', 'A-3': 'Rowan'}, () => storage);
  assert.equal(saveCharacterNames(books[0], {a: '', b: ''}, () => storage), true);
  assert.equal(storage.getItem(CHARACTER_NAMES_KEY), null);
  assert.equal(storage.getItem('theme'), 'dark');
  assert.deepEqual(loadCharacterNames(books[0], () => storage).names, {a: '', b: ''});
});

test('blocked storage access and failed writes remain nonfatal', () => {
  const blocked = () => { throw new Error('SecurityError'); };
  assert.deepEqual(loadCharacterNames(books[0], blocked), {names: {a: '', b: ''}, available: false});
  assert.equal(saveCharacterNames(books[0], {a: 'Ada', b: ''}, blocked), false);
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(saveCharacterNames(books[0], {a: 'Ada', b: ''}, () => storage), false);
  storage.removeItem = () => { throw new Error('SecurityError'); };
  assert.equal(saveCharacterNames(books[0], {a: '', b: ''}, () => storage), false);
});
