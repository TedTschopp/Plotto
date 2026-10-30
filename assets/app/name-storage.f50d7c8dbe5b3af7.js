import {normalizeNames} from './engine.f50d7c8dbe5b3af7.js';

export const CHARACTER_NAMES_KEY = 'plotto-character-names-v1';

export function loadCharacterNames(book, storage = () => globalThis.localStorage) {
  try {
    const saved = storage().getItem(CHARACTER_NAMES_KEY);
    let names;
    try { names = JSON.parse(saved); } catch { names = null; }
    return {names: normalizeNames(names, book), available: true};
  } catch {
    return {names: {a: '', b: ''}, available: false};
  }
}

export function saveCharacterNames(book, names, storage = () => globalThis.localStorage) {
  try {
    const normalized = normalizeNames(names, book);
    const target = storage();
    if (Object.values(normalized).some(Boolean)) target.setItem(CHARACTER_NAMES_KEY, JSON.stringify(normalized));
    else target.removeItem(CHARACTER_NAMES_KEY);
    return true;
  } catch {
    return false;
  }
}
