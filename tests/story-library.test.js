import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateOutline, renderOutline, outlineText, seededRandom} from '../js/engine.js';
import {saveCurrentStory, CURRENT_STORY_KEY} from '../js/story-storage.js';
import {loadStoryLibrary, saveLibraryStory, activateLibraryStory, STORY_LIBRARY_KEY} from '../js/story-library.js';
const book = JSON.parse(readFileSync(new URL('../data/plotto-mf.json', import.meta.url)));
const state = generateOutline(book, {main: '75a', names: {a: 'Ada', b: 'Sam', 'A-3': 'Rówan'}}, seededRandom(12)).state;
const controls = {group: '', a: '7', b: '', c: '5', main: '75a'};
const memoryStorage = () => {
  const data = new Map();
  return {getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
};

test('the existing saved story migrates once with its exact state and a retained backup', () => {
  const storage = memoryStorage();
  saveCurrentStory(book, state, controls, () => storage);
  const legacy = storage.getItem(CURRENT_STORY_KEY);
  const first = loadStoryLibrary(() => storage).library;
  assert.equal(first.stories.length, 1);
  assert.equal(first.stories[0].title, 'My saved story');
  assert.deepEqual(first.stories[0].state, state);
  assert.deepEqual(first.stories[0].controls, controls);
  assert.deepEqual(loadStoryLibrary(() => storage).library, first);
  assert.equal(storage.getItem(CURRENT_STORY_KEY), legacy);
});

test('multiple stories with duplicate or Unicode titles remain independent', () => {
  const storage = memoryStorage();
  const one = saveLibraryStory(book, {state, controls, title: '  L’été <river>  '}, () => storage).story;
  const secondState = generateOutline(book, {main: '542', names: {a: 'Other', b: 'Cast'}}, seededRandom(3)).state;
  const two = saveLibraryStory(book, {state: secondState, controls, title: one.title}, () => storage).story;
  assert.notEqual(one.id, two.id);
  const activated = activateLibraryStory(one.id, one.revision, () => storage);
  assert.equal(activated.ok, true);
  const library = loadStoryLibrary(() => storage).library;
  assert.equal(library.activeId, one.id);
  assert.equal(library.stories.length, 2);
  assert.deepEqual(renderOutline(book, library.stories[0].state), renderOutline(book, state));
  assert.deepEqual(library.stories[1].state.names, secondState.names);
  assert.match(outlineText(renderOutline(book, state), book, one.title), /Title: L’été <river>/);
});

test('saving and renaming one story preserves other stories and avoids unnecessary revisions', () => {
  const storage = memoryStorage();
  const one = saveLibraryStory(book, {state, controls, title: 'First'}, () => storage).story;
  const two = saveLibraryStory(book, {state, controls, title: 'Second'}, () => storage).story;
  const renamed = saveLibraryStory(book, {...one, title: 'Renamed'}, () => storage);
  assert.equal(renamed.ok, true);
  assert.equal(renamed.story.revision, one.revision + 1);
  const same = saveLibraryStory(book, renamed.story, () => storage);
  assert.equal(same.story.revision, renamed.story.revision);
  assert.deepEqual(loadStoryLibrary(() => storage).library.stories.find((entry) => entry.id === two.id), two);
});

test('a stale tab cannot overwrite a newer version, and can save its work as a copy', () => {
  const storage = memoryStorage();
  const original = saveLibraryStory(book, {state, controls, title: 'Shared draft'}, () => storage).story;
  const newer = saveLibraryStory(book, {...original, title: 'Newer title'}, () => storage).story;
  assert.equal(saveLibraryStory(book, {...original, title: 'Older tab edits'}, () => storage).ok, false);
  assert.equal(activateLibraryStory(original.id, original.revision, () => storage).ok, false);
  const copy = saveLibraryStory(book, {state, controls, title: 'Older tab edits (copy)'}, () => storage);
  assert.equal(copy.ok, true);
  assert.deepEqual(loadStoryLibrary(() => storage).library.stories.find((entry) => entry.id === newer.id), newer);
});

test('blocked or full storage and corrupt libraries never replace saved work', () => {
  const storage = memoryStorage();
  const original = saveLibraryStory(book, {state, controls, title: 'Keep'}, () => storage).story;
  const raw = storage.getItem(STORY_LIBRARY_KEY);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(saveLibraryStory(book, {...original, title: 'Unsaved'}, () => storage).ok, false);
  assert.equal(activateLibraryStory(original.id, original.revision, () => storage).ok, false);
  assert.equal(storage.getItem(STORY_LIBRARY_KEY), raw);
  const corrupt = memoryStorage();
  corrupt.setItem(STORY_LIBRARY_KEY, '{broken');
  assert.equal(loadStoryLibrary(() => corrupt).invalid, true);
  assert.equal(saveLibraryStory(book, {state, controls, title: 'New'}, () => corrupt).ok, false);
  assert.equal(corrupt.getItem(STORY_LIBRARY_KEY), '{broken');
  const blocked = () => { throw new Error('SecurityError'); };
  assert.equal(loadStoryLibrary(blocked).available, false);
  assert.equal(saveLibraryStory(book, {state, controls, title: 'New'}, blocked).ok, false);
});
