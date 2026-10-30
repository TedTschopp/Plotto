import {validateState, MAX_SHARED_HASH_LENGTH} from './engine.js';
import {loadCurrentStory, storyControls} from './story-storage.js';

export const STORY_LIBRARY_KEY = 'plotto-story-library-v1';
export const MAX_STORY_TITLE = 120;
const MAX_LIBRARY_LENGTH = 5000000;
const emptyLibrary = () => ({version: 1, activeId: null, stories: []});
const fail = (error) => ({ok: false, error});

function validEntry(entry) {
  return entry && typeof entry.id === 'string' && /^[\w-]{1,80}$/.test(entry.id) &&
    typeof entry.title === 'string' && entry.title.trim() && entry.title.length <= MAX_STORY_TITLE &&
    Number.isSafeInteger(entry.revision) && entry.revision > 0 && Number.isFinite(entry.updatedAt) &&
    entry.state && typeof entry.state === 'object' && !Array.isArray(entry.state) && ['mf', 'fm'].includes(entry.state.edition);
}

export function loadStoryLibrary(storage = () => globalThis.localStorage) {
  let target, raw;
  try { target = storage(); raw = target.getItem(STORY_LIBRARY_KEY); }
  catch { return {library: emptyLibrary(), available: false, invalid: false}; }
  if (raw === null) {
    const legacy = loadCurrentStory(() => target);
    const library = emptyLibrary();
    if (legacy.snapshot) {
      library.activeId = 'legacy-current-story';
      library.stories.push({id: library.activeId, title: 'My saved story', revision: 1, updatedAt: Date.now(), ...legacy.snapshot});
      try { target.setItem(STORY_LIBRARY_KEY, JSON.stringify(library)); }
      catch { return {library, available: false, invalid: false}; }
    }
    return {library, available: true, invalid: false};
  }
  try {
    if (raw.length > MAX_LIBRARY_LENGTH) throw new Error('Library is too large');
    const library = JSON.parse(raw);
    if (library?.version !== 1 || !Array.isArray(library.stories) || !library.stories.every(validEntry) ||
        new Set(library.stories.map((entry) => entry.id)).size !== library.stories.length ||
        (library.activeId !== null && !library.stories.some((entry) => entry.id === library.activeId))) {
      throw new Error('Invalid story library');
    }
    return {library, available: true, invalid: false};
  } catch { return {library: emptyLibrary(), available: true, invalid: true}; }
}

function writeLibrary(library, storage) {
  const serialized = JSON.stringify(library);
  if (serialized.length > MAX_LIBRARY_LENGTH) throw new Error('Library is too large');
  storage().setItem(STORY_LIBRARY_KEY, serialized);
}

function titleFor(value, library, id) {
  const title = typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_STORY_TITLE) : '';
  if (title) return title;
  const used = new Set(library.stories.filter((story) => story.id !== id).map((story) => story.title));
  let candidate = 'Untitled story', number = 2;
  while (used.has(candidate)) candidate = `Untitled story ${number++}`;
  return candidate;
}

export function saveLibraryStory(book, draft, storage = () => globalThis.localStorage) {
  try {
    validateState(draft.state, book);
    if (JSON.stringify(draft.state).length > MAX_SHARED_HASH_LENGTH) return fail('This story is too large to save.');
    const loaded = loadStoryLibrary(storage);
    if (!loaded.available || loaded.invalid) return fail('This browser could not save your story. Copy a link to keep your work.');
    const library = loaded.library;
    const existing = draft.id ? library.stories.find((story) => story.id === draft.id) : null;
    if (draft.id && !existing) return fail('This story is missing from the library. Save a copy to keep your work.');
    const content = {title: titleFor(draft.title, library, draft.id), state: draft.state, controls: storyControls(draft.controls)};
    const unchanged = existing && JSON.stringify([existing.title, existing.state, existing.controls]) ===
      JSON.stringify([content.title, content.state, content.controls]);
    if (existing && existing.revision !== draft.revision && !unchanged) {
      return fail('This story changed in another tab. Save a copy to keep both versions.');
    }
    const story = unchanged ? existing : {id: existing?.id ?? crypto.randomUUID(), ...content,
      revision: (existing?.revision ?? 0) + 1, updatedAt: Date.now()};
    library.stories = existing ? library.stories.map((entry) => entry.id === story.id ? story : entry) : [...library.stories, story];
    library.activeId = story.id;
    writeLibrary(library, storage);
    return {ok: true, story: structuredClone(story), library};
  } catch { return fail('This browser could not save your story. Copy a link to keep your work.'); }
}

export function activateLibraryStory(id, revision, storage = () => globalThis.localStorage) {
  try {
    const loaded = loadStoryLibrary(storage);
    if (!loaded.available || loaded.invalid) return fail('Saved stories could not be read in this browser.');
    const story = loaded.library.stories.find((entry) => entry.id === id);
    if (!story || story.revision !== revision) return fail('This story changed in another tab. Choose it again to load the latest version.');
    loaded.library.activeId = id;
    writeLibrary(loaded.library, storage);
    return {ok: true, story};
  } catch { return fail('This browser could not switch stories. Your current story is still open.'); }
}
