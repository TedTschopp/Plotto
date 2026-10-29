import {validateState, MAX_SHARED_HASH_LENGTH} from './engine.js';

export const CURRENT_STORY_KEY = 'plotto-current-story-v1';

function storyControls(controls) {
  const limits = {group: 64, b: 2, a: 2, c: 2, main: 5};
  const result = {};
  for (const [key, limit] of Object.entries(limits)) {
    result[key] = typeof controls?.[key] === 'string' && controls[key].length <= limit ? controls[key] : '';
  }
  if (!/^\d{1,4}[a-m]?$/.test(result.main)) result.main = '';
  return result;
}

export function loadCurrentStory(storage = () => globalThis.localStorage) {
  let raw;
  try { raw = storage().getItem(CURRENT_STORY_KEY); }
  catch { return {snapshot: null, available: false, invalid: false}; }
  if (raw === null) return {snapshot: null, available: true, invalid: false};
  try {
    if (raw.length > MAX_SHARED_HASH_LENGTH) throw new Error('Saved story is too large');
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !saved.state || typeof saved.state !== 'object' || Array.isArray(saved.state) ||
        !['mf', 'fm'].includes(saved.state.edition)) throw new Error('Invalid saved story');
    return {snapshot: {state: saved.state, controls: storyControls(saved.controls)}, available: true, invalid: false};
  } catch {
    return {snapshot: null, available: true, invalid: true};
  }
}

export function saveCurrentStory(book, state, controls, storage = () => globalThis.localStorage) {
  try {
    validateState(state, book);
    const serialized = JSON.stringify({version: 1, state, controls: storyControls(controls)});
    if (serialized.length > MAX_SHARED_HASH_LENGTH) return false;
    storage().setItem(CURRENT_STORY_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
