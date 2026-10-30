// Pure Plotto rules. This module has no browser or network dependencies.
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let x = Math.imul(value ^ (value >>> 15), 1 | value);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (items, random) => items.length ? items[Math.floor(random() * items.length)] : null;
const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const atomPattern = (value) => `(?<![\\w-])${escapePattern(value)}(?![\\w-])`;
const symbolPattern = /(?<![\w-])[ab]?[A-Z]+(?:-[A-Z0-9]+)*(?![\w-])/g;
const abbreviationPattern = /((?:[A-Z]\.){2,}(?:[A-Z](?![\w-]))?)/g;
const symbolCatalogs = new WeakMap();
export const MAX_SHARED_HASH_LENGTH = 128000;

export const nameKey = (symbol) => symbol === 'A' || symbol === 'B' ? symbol.toLowerCase() : symbol;

function symbolCatalog(book) {
  if (!symbolCatalogs.has(book)) {
    const symbols = Object.keys(book.characters);
    symbolCatalogs.set(book, new Set([...symbols, ...symbols.map((symbol) => symbol.split('-')[0]), 'AUX', 'Y', 'Z']));
  }
  return symbolCatalogs.get(book);
}

function isSymbol(symbol, book) {
  const plain = symbol.replace(/^[ab](?=[A-Z])/, '');
  const catalog = symbolCatalog(book);
  return catalog.has(plain) || (plain.endsWith('X') && catalog.has(plain.slice(0, -1))) ||
    (/^(.+)-\d+$/.test(plain) && catalog.has(plain.replace(/-\d+$/, '')));
}

function validNameKey(key, book) {
  return key === 'a' || key === 'b' || (key !== 'A' && key !== 'B' && key.length <= 20 &&
    /^[ab]?[A-Z]+(?:-[A-Z0-9]+)*$/.test(key) && isSymbol(key, book));
}

export function normalizeNames(names, book) {
  const result = {a: '', b: ''};
  if (!names || typeof names !== 'object' || Array.isArray(names)) return result;
  for (const [key, value] of Object.entries(names)) {
    if (!validNameKey(key, book) || typeof value !== 'string') continue;
    if (!Object.hasOwn(result, key) && Object.keys(result).length >= 128) continue;
    const name = value.trim().slice(0, 60);
    if (name || key === 'a' || key === 'b') result[key] = name;
  }
  return result;
}

export function characterRole(symbol, book) {
  if (Object.hasOwn(book.characters, symbol)) return book.characters[symbol];
  if (/^[ab][A-Z]/.test(symbol)) {
    const gender = symbol[0] === 'a' ? 'male' : 'female';
    return characterRole(symbol.slice(1), book).replace(/^(male|female)\b/, gender);
  }
  if (symbol.endsWith('X') && symbolCatalog(book).has(symbol.slice(0, -1))) {
    return `mysterious ${characterRole(symbol.slice(0, -1), book)}`;
  }
  if (/^(.+)-\d+$/.test(symbol)) return characterRole(symbol.replace(/-\d+$/, ''), book);
  const relative = book.characters[`${symbol}-A`] ?? book.characters[`${symbol}-B`];
  if (relative) return relative.replace(/^(male|female) /, '').replace(/ of [AB]$/, '');
  return 'additional character or object in this story';
}

export function outlineCharacters(outline, book) {
  const entries = [...outline.before.entries, outline.main, ...outline.after.entries];
  // Read the adapted source, never custom names or reference/audit instructions.
  const text = entries.flatMap((entry) => [entry.text, ...entry.notes.filter((note) =>
    !note.startsWith('Editorial repair:'))]).join(' ').replace(abbreviationPattern, '');
  const symbols = new Set([...text.matchAll(symbolPattern)].map((match) => match[0]).filter((symbol) => isSymbol(symbol, book)));
  return [...symbols].map((symbol) => ({symbol, description: characterRole(symbol, book)}));
}

export function sharedState(outline, book) {
  const names = {a: outline.state.names.a, b: outline.state.names.b};
  for (const {symbol} of outlineCharacters(outline, book)) {
    const key = nameKey(symbol);
    if (outline.state.names[key]) names[key] = outline.state.names[key];
  }
  return {...outline.state, names};
}

export function replaceTogether(text, changes) {
  // Match once against the original text, so A→A-8 and A-3→A cannot cascade.
  const matches = [];
  for (const change of changes) {
    let found = [...text.matchAll(new RegExp(atomPattern(change.from), 'g'))];
    if (change.last) found = found.slice(-1);
    found.forEach((match) => matches.push({start: match.index, end: match.index + match[0].length, value: change.to}));
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  let result = '', end = 0;
  for (const match of matches) {
    if (match.start < end) continue;
    result += text.slice(end, match.start) + match.value;
    end = match.end;
  }
  return result + text.slice(end);
}

export function applyOperations(text, operations) {
  const notes = [];
  for (const operation of operations) {
    if (operation.type === 'change') text = replaceTogether(text, operation.changes);
    else if (operation.type === 'transpose') {
      text = replaceTogether(text, [{from: operation.from, to: operation.to}, {from: operation.to, to: operation.from}]);
    } else if (operation.type === 'eliminate') {
      text = replaceTogether(text, [{from: operation.value, to: ''}]);
    } else if (operation.type === 'add') {
      notes.push(`Include ${operation.value} in this situation.`);
    }
  }
  return {text: text.replace(/ {2,}/g, ' ').trim(), notes};
}

export function selectText(text, reference) {
  if (reference.section) {
    const [from, to] = reference.section;
    const marks = [...text.matchAll(/\*+/g)];
    const start = from ? marks.find((m) => m[0].length === from) : null;
    const end = marks.find((m) => m[0].length === to);
    if ((from && !start) || !end || (start && start.index >= end.index)) return null;
    text = text.slice(start ? start.index + start[0].length : 0, end.index);
  }
  if (reference.numbers?.length) {
    const marks = [...text.matchAll(/\[(\d+)\]/g)];
    if (reference.numbers.some((n) => !marks.some((m) => Number(m[1]) === n))) return null;
    const prefix = text.slice(0, marks[0].index);
    const choices = marks.flatMap((mark, i) => reference.numbers.includes(Number(mark[1]))
      ? [text.slice(mark.index + mark[0].length, marks[i + 1]?.index ?? text.length).trim()] : []);
    text = prefix + choices.join(' / ');
  }
  return text;
}

export function cleanText(text) {
  return text.replace(/\((\d[^()]*)\)/g, '').replace(/@\{[^}]+\}/g, '')
    .replace(/\*+/g, ' · ').replace(/\[(\d+)\]/g, 'Option $1: ')
    .replace(/\s+/g, ' ').replace(/\s+([,;:.])/g, '$1').replace(/(?:\s*·\s*)+$/g, '').trim();
}

export function indexBook(book) {
  return new Map(book.conflicts.map((conflict) => [conflict.id, conflict]));
}

function variantsFor(reference, index) {
  if (reference.unavailable) return [];
  const conflict = index.get(reference.id);
  return (conflict?.variants ?? []).filter((variant) =>
    (!reference.variants.length || reference.variants.includes(variant.id)) && selectText(variant.text, reference) !== null);
}

function usable(expression, index, excluded) {
  if (expression.type === 'reference') return !excluded.has(expression.id) && variantsFor(expression, index).length > 0;
  const check = (child) => usable(child, index, excluded);
  return expression.type === 'choice' ? expression.items.some(check) : expression.items.every(check);
}

function resolve(expression, index, excluded, random) {
  if (expression.type === 'choice') {
    return resolve(pick(expression.items.filter((item) => usable(item, index, excluded)), random), index, excluded, random);
  }
  if (expression.type === 'sequence') return expression.items.flatMap((item) => resolve(item, index, excluded, random));
  const conflict = index.get(expression.id);
  const variant = pick(variantsFor(expression, index), random);
  const adapted = applyOperations(selectText(variant.text, expression), expression.operations);
  return [{id: conflict.id, variant: variant.id, reference: expression.label,
    text: cleanText(adapted.text), notes: [...adapted.notes, ...expression.notes], correctionId: expression.correctionId ?? null}];
}

export function stageOptions(book, mainKey, direction, excludedIds = []) {
  const index = indexBook(book);
  const {conflict, variant} = getMain(book, mainKey, index);
  const excluded = new Set([conflict.id, ...excludedIds]);
  return variant[direction].map((group, groupIndex) => ({...group, groupIndex}))
    .filter((group) => usable(group.expression, index, excluded));
}

function getMain(book, key, index = indexBook(book)) {
  const match = /^(\d{1,4})([a-m]?)$/.exec(String(key).trim());
  if (!match || !index.has(Number(match[1]))) throw new Error('Choose a conflict from 1 to 1462, optionally followed by its variant letter.');
  const conflict = index.get(Number(match[1]));
  const variant = conflict.variants.find((v) => v.id === match[2]);
  if (!variant) throw new Error(`Conflict ${conflict.id} has these variants: ${conflict.variants.map((v) => v.id || '(whole conflict)').join(', ')}.`);
  return {conflict, variant};
}

function renderStage(book, state, direction, excluded) {
  const options = stageOptions(book, state.main, direction, excluded);
  const random = seededRandom(state[direction].seed);
  const group = options.find((option) => option.groupIndex === state[direction].group) ?? pick(options, random);
  if (!group) return {entries: [], group: null, options};
  return {entries: resolve(group.expression, indexBook(book), new Set([Number.parseInt(state.main, 10), ...excluded]), random),
    group: group.groupIndex, label: group.label, options};
}

export function renderOutline(book, state) {
  validateState(state, book);
  const {conflict, variant} = getMain(book, state.main);
  const before = renderStage(book, state, 'before', []);
  const after = renderStage(book, state, 'after', before.entries.map((entry) => entry.id));
  return {state, conflict,
    a: book.clauses.a.find((clause) => clause.id === state.a),
    b: book.clauses.b.find((clause) => clause.id === conflict.bClause),
    c: book.clauses.c.find((clause) => clause.id === state.c),
    main: {id: conflict.id, variant: variant.id, reference: state.main, text: cleanText(variant.text), notes: []},
    before, after};
}

export function generateOutline(book, options = {}, random = Math.random) {
  let conflict, variant;
  const index = indexBook(book);
  if (options.main?.trim()) {
    const match = /^(\d{1,4})([a-m]?)$/.exec(options.main.trim());
    conflict = match && index.get(Number(match[1]));
    if (!conflict) throw new Error('Choose a conflict from 1 to 1462, optionally followed by its variant letter.');
    variant = match[2] ? conflict.variants.find((v) => v.id === match[2]) : pick(conflict.variants, random);
    if (!variant) throw new Error(`Conflict ${conflict.id} has no variant ${match[2]}.`);
  } else {
    const candidates = book.conflicts.filter((c) => (!options.group || c.group === options.group) &&
      (!options.b || c.bClause === Number(options.b)));
    if (!candidates.length) throw new Error('No conflicts match this theme and story action. Choose another action or use any theme.');
    conflict = pick(candidates, random);
    variant = pick(conflict.variants, random);
  }
  const state = {v: 1, edition: book.edition, hash: book.sourceHash, main: `${conflict.id}${variant.id}`,
    a: Number(options.a) || pick(book.clauses.a, random).id,
    c: Number(options.c) || pick(book.clauses.c, random).id,
    before: {seed: Math.floor(random() * 4294967296)}, after: {seed: Math.floor(random() * 4294967296)},
    names: normalizeNames(options.names, book)};
  return renderOutline(book, state);
}

export function validateState(state, book) {
  if (!state || state.v !== 1 || state.edition !== book.edition || state.hash !== book.sourceHash ||
      !book.clauses.a.some((c) => c.id === state.a) || !book.clauses.c.some((c) => c.id === state.c)) {
    throw new Error('This saved outline is invalid or uses an older book dataset. Generate a new outline below.');
  }
  getMain(book, state.main);
  for (const direction of ['before', 'after']) {
    const stage = state[direction];
    if (!stage || !Number.isInteger(stage.seed) || stage.seed < 0 || stage.seed > 4294967295 ||
        (stage.group !== undefined && (!Number.isInteger(stage.group) || stage.group < 0 || stage.group > 100))) {
      throw new Error('This outline contains an invalid linked suggestion. Generate a new outline below.');
    }
  }
  if (!state.names || Array.isArray(state.names) || typeof state.names !== 'object' ||
      !Object.hasOwn(state.names, 'a') || !Object.hasOwn(state.names, 'b') || Object.keys(state.names).length > 128 ||
      Object.entries(state.names).some(([key, value]) => !validNameKey(key, book) || typeof value !== 'string' || value.length > 60)) {
    throw new Error('This outline contains an invalid character name. Generate a new outline below.');
  }
}

export function namedText(text, names) {
  const changes = Object.entries(names).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) =>
    ({from: key === 'a' || key === 'b' ? key.toUpperCase() : key, to: value.trim()}));
  // Letters inside abbreviations such as U.S.A. are not cast symbols.
  return text.split(abbreviationPattern).map((part, index) => index % 2 ? part : replaceTogether(part, changes)).join('');
}

export function namedNote(note, names) {
  return note.startsWith('Editorial repair:') ? note : namedText(note, names);
}

export function outlineText(outline, book, title = '') {
  const {state} = outline;
  const lines = ['PLOTTO · A story outline', '', `${outline.a.text} / ${outline.b.text} / ${outline.c.text}`, ''];
  if (title.trim()) lines.splice(1, 0, `Title: ${title.trim()}`);
  const stages = [['Lead-up', outline.before.entries], ['Main conflict', [outline.main]], ['Carry-on', outline.after.entries]];
  for (const [label, entries] of stages) {
    lines.push(label.toUpperCase());
    if (!entries.length) lines.push('No usable linked suggestion in the source for this stage.');
    entries.forEach((entry) => {
      lines.push(`[${entry.id}${entry.variant}] ${namedText(entry.text, state.names)}`);
      entry.notes.forEach((note) => lines.push(`Note: ${namedNote(note, state.names)}`));
      if (entry.reference !== `${entry.id}${entry.variant}`) lines.push(`Source instruction: ${entry.reference}`);
    });
    lines.push('');
  }
  lines.push(`Edition: A=${state.edition === 'mf' ? 'male, B=female' : 'female, B=male'}`);
  const used = book ? new Set(['a', 'b', ...outlineCharacters(outline, book).map(({symbol}) => nameKey(symbol))]) : null;
  for (const [key, value] of Object.entries(state.names)) {
    if (value && (!used || used.has(key))) lines.push(`${key === 'a' || key === 'b' ? key.toUpperCase() : key} = ${value}`);
  }
  lines.push('Source: William Wallace Cook, Plotto (1928). Adapt these suggestions to your own story.');
  return lines.join('\n');
}
