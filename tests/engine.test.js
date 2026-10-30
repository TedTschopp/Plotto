import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyOperations, replaceTogether, selectText, cleanText, generateOutline, renderOutline,
  stageOptions, seededRandom, namedText, outlineText, outlineCharacters, characterRole, sharedState,
  MAX_SHARED_HASH_LENGTH, endingClauses, masterplotText, masterplotConnection} from '../js/engine.js';

const books = ['mf', 'fm'].map((edition) => JSON.parse(readFileSync(new URL(`../data/plotto-${edition}.json`, import.meta.url))));
const corrections = JSON.parse(readFileSync(new URL('../data/source-corrections.json', import.meta.url))).slice(3);

test('character substitutions are simultaneous and respect complete symbols', () => {
  const result = replaceTogether('A helps A-3, A-2, and F-A. A’s plans affect A.', [
    {from: 'A', to: 'A-8'}, {from: 'A-3', to: 'A'},
  ]);
  assert.equal(result, 'A-8 helps A, A-2, and F-A. A-8’s plans affect A-8.');
  assert.equal(replaceTogether('A sees A, then A.', [{from: 'A', to: 'A-3', last: true}]), 'A sees A, then A-3.');
});

test('transpositions, phrase changes, eliminations and added-character notes retain their meaning', () => {
  const result = applyOperations('A sees B in a prison cell. B is the wife of A.', [
    {type: 'transpose', from: 'A', to: 'B'},
    {type: 'change', changes: [{from: 'wife of B', to: 'sweetheart of B'}]},
    {type: 'eliminate', value: 'prison cell'}, {type: 'add', value: 'CH'},
  ]);
  assert.equal(result.text, 'B sees A in a . A is the sweetheart of B.');
  assert.deepEqual(result.notes, ['Include CH in this situation.']);
});

test('star-delimited and numbered sections select exactly the requested material', () => {
  const text = 'The first part * The second part ** The third part ***';
  assert.equal(selectText(text, {section: [0, 1]}).trim(), 'The first part');
  assert.equal(selectText(text, {section: [1, 3]}).trim(), 'The second part ** The third part');
  assert.equal(selectText(text, {section: [2, 4]}), null);
  const numbered = 'A refuses because [1] fear; [2] duty; [3] jealousy';
  assert.equal(selectText(numbered, {numbers: [2]}), 'A refuses because duty;');
  assert.equal(selectText(numbered, {numbers: [1, 3]}), 'A refuses because fear; / jealousy');
  assert.equal(selectText(numbered, {numbers: [4]}), null);
  assert.equal(cleanText('A acts (123a) * A learns **'), 'A acts · A learns');
});

for (const book of books) {
  test(`${book.edition}: every source variant produces a traceable outline and survives a share round-trip`, () => {
    assert.equal(book.conflicts.length, 1462);
    let count = 0;
    for (const conflict of book.conflicts) {
      for (const variant of conflict.variants) {
        const main = `${conflict.id}${variant.id}`;
        const outline = generateOutline(book, {main, names: {a: 'Márta', b: 'Sam'}}, seededRandom(conflict.id));
        assert.equal(outline.state.main, main);
        assert.equal(outline.b.id, conflict.bClause);
        assert.deepEqual(renderOutline(book, JSON.parse(JSON.stringify(outline.state))), outline);
        for (const direction of ['before', 'after']) {
          const stage = outline[direction];
          assert.ok(stage.group === null || stageOptions(book, main, direction).some((option) => option.groupIndex === stage.group));
          for (const entry of stage.entries) {
            const target = book.conflicts.find((c) => c.id === entry.id);
            assert.ok(target.variants.some((v) => v.id === entry.variant));
            assert.ok(entry.text.trim().length > 0);
            assert.notEqual(entry.id, conflict.id);
          }
        }
        count++;
      }
    }
    assert.equal(count, 1852);
  });

  test(`${book.edition}: filters and explicit starting conflicts obey the selected scope`, () => {
    for (const group of ['Love and Courtship', 'Married Life', 'Enterprise']) {
      const outline = generateOutline(book, {group}, seededRandom(42));
      assert.equal(outline.conflict.group, group);
    }
    const outline = generateOutline(book, {b: 50, a: 7, c: 5}, seededRandom(24));
    assert.equal(outline.b.id, 50);
    assert.equal(outline.a.id, 7);
    assert.equal(outline.c.id, 5);
    assert.equal(generateOutline(book, {main: '542', group: 'Enterprise', b: 1}).conflict.id, 542);
    assert.throws(() => generateOutline(book, {main: '1463'}), /1 to 1462/);
    assert.throws(() => generateOutline(book, {main: '542a'}), /no variant/);
  });
}

test('compound references preserve sequence and alternatives choose one branch', () => {
  const book = books[0];
  const state = generateOutline(book, {main: '571'}, seededRandom(1)).state;
  const option = stageOptions(book, '571', 'after').find((option) => option.label.includes('572; 402'));
  assert.ok(option);
  state.after.group = option.groupIndex;
  const outline = renderOutline(book, state);
  assert.deepEqual(outline.after.entries.map((entry) => entry.id), [572, 402]);
  const next = generateOutline(book, {main: '458b'}, seededRandom(9)).state;
  const alternative = stageOptions(book, '458b', 'after').find((option) => option.label.includes(' or '));
  assert.ok(alternative);
  next.after.group = alternative.groupIndex;
  const result = renderOutline(book, next).after;
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].id, 688);
  assert.ok([307, 197, 973].includes(result.entries[1].id));
});

test('automatic masterplots use a neutral person and an indexed ending or an open outcome', () => {
  for (const book of books) {
    for (const main of ['813', '542', '75a', '364d']) {
      for (let seed = 0; seed < 8; seed++) {
        const outline = generateOutline(book, {main}, seededRandom(seed));
        assert.equal(outline.a.id, 15);
        const specific = endingClauses(outline, book).filter((id) => id !== 15);
        assert.equal(outline.c.id, specific.length === 1 ? specific[0] : 15);
        assert.equal(outline.b.id, outline.conflict.bClause);
        assert.ok(masterplotText(outline).endsWith('.'));
      }
    }
  }
});

test('a requested outcome prefers a book-linked ending and unmatched outcomes remain explicit', () => {
  for (const book of books) {
    const matched = generateOutline(book, {main: '813', a: 6, c: 9}, seededRandom(12));
    assert.equal(matched.a.id, 6);
    assert.equal(matched.after.entries.at(-1).id, 881);
    assert.ok(endingClauses(matched, book).includes(9));
    assert.match(masterplotConnection(matched, book), /terminal-conflict index/);
    const planned = generateOutline(book, {main: '813', c: 8}, seededRandom(12));
    assert.equal(planned.c.id, 8);
    assert.match(masterplotConnection(planned, book), /C8 is a planned outcome/);
    const excerpt = {...matched, after: {...matched.after,
      entries: [{...matched.after.entries.at(-1), complete: false}]}};
    assert.deepEqual(endingClauses(excerpt, book), []);
    assert.match(masterplotConnection(excerpt, book), /planned outcome/);
  }
});

test('automatic outcomes remain open when the book lists multiple specific endings', () => {
  const book = {...books[0], terminalClauses: Object.fromEntries(Object.keys(books[0].terminalClauses).map((key) => [key, [1, 9]]))};
  const outline = generateOutline(book, {main: '813'}, seededRandom(12));
  assert.equal(outline.c.id, 15);
  const chosen = generateOutline(book, {main: '813', c: 9}, seededRandom(12));
  assert.match(masterplotConnection(chosen, book), /several outcomes/);
});

test('B62 is universal and legacy saved masterplots retain their chosen clauses', () => {
  const book = books[0];
  const outline = generateOutline(book, {group: 'Enterprise', b: 62}, seededRandom(12));
  assert.equal(outline.b.id, 62);
  assert.equal(outline.conflict.group, 'Enterprise');
  assert.deepEqual(renderOutline(book, outline.state), outline);
  const legacy = {...outline.state, a: 13, c: 8};
  delete legacy.b;
  const restored = renderOutline(book, legacy);
  assert.equal(restored.a.id, 13);
  assert.equal(restored.c.id, 8);
  assert.equal(restored.b.id, restored.conflict.bClause);
});

test('names and text export preserve Unicode and do not rewrite relationship symbols', () => {
  assert.equal(namedText('A meets B and A-2 with F-A.', {a: 'Márta', b: 'Sam'}), 'Márta meets Sam and A-2 with F-A.');
  const outline = generateOutline(books[0], {main: '542', names: {a: 'Márta', b: 'Sam'}}, seededRandom(3));
  const text = outlineText(outline);
  assert.match(text, /\[542\] Márta/);
  assert.match(text, /LEAD-UP/);
  assert.match(text, /CARRY-ON/);
  assert.match(text, /A = Márta/);
});

test('supporting names replace complete symbols once without cascading into other names', () => {
  assert.equal(namedText('A meets A-3, A-3X, A-30, F-B, F-A and B.',
    {a: 'A-3', b: 'Sam', 'A-3': 'Márta', 'F-B': '李明'}),
  'A-3 meets Márta, A-3X, A-30, 李明, F-A and Sam.');
  assert.equal(namedText('A-3’s friend and A-3.', {'A-3': ''}), 'A-3’s friend and A-3.');
  assert.equal(namedText('A meets U in the U.S.A. and U.S.A', {a: 'Ada', U: 'Uri'}), 'Ada meets Uri in the U.S.A. and U.S.A');
});

test('cast detection reads adapted story symbols and added characters, excluding instructions and names', () => {
  const book = books[0];
  const outline = generateOutline(book, {main: '75a', names: {a: 'F-B', b: 'X-1'}}, seededRandom(12));
  const adapted = applyOperations('A meets A-3 and F-A.', [{type: 'change', changes: [{from: 'A-3', to: 'B-3'}]},
    {type: 'add', value: 'CH'}]);
  outline.before.entries = [{...outline.main, text: adapted.text, notes: adapted.notes, reference: '110 ch A to A-9'}];
  outline.main = {...outline.main, text: 'A asks “Who am I?” in the U.S.A. with F-B, SN, X-1, CH-2 and aB.'};
  outline.after.entries = [{...outline.main, text: 'B meets A-3X.', notes: ['Editorial repair: A-9 replaces F-M.']}];
  assert.deepEqual(outlineCharacters(outline, book).map(({symbol}) => symbol),
    ['A', 'B-3', 'F-A', 'CH', 'F-B', 'SN', 'X-1', 'CH-2', 'aB', 'B', 'A-3X']);
  assert.equal(characterRole('SN', book), 'son');
  assert.equal(characterRole('aB', book), 'male protagonist');
  assert.equal(characterRole('CH-2', book), 'a child');
});

test('supporting names survive regeneration, edition changes and share round-trips', () => {
  const names = {a: 'Márta', b: 'Sam', 'A-3': 'Rowan', 'F-B': '李明', 'A-9': 'Unused'};
  const first = generateOutline(books[0], {main: '269', names}, seededRandom(12));
  assert.match(outlineText(first, books[0]), /李明/);
  assert.match(outlineText(first, books[0]), /A-3 = Rowan/);
  assert.doesNotMatch(outlineText(first, books[0]), /A-9 = Unused/);
  const saved = sharedState(first, books[0]);
  assert.equal(saved.names['A-9'], undefined);
  assert.equal(first.state.names['A-9'], 'Unused');
  assert.deepEqual(renderOutline(books[0], JSON.parse(JSON.stringify(saved))).state.names, saved.names);
  assert.ok(encodeURIComponent(JSON.stringify(saved)).length < MAX_SHARED_HASH_LENGTH);
  const regenerated = generateOutline(books[0], {main: '75a', names: first.state.names}, seededRandom(7));
  assert.equal(regenerated.state.names['A-3'], 'Rowan');
  const reversed = renderOutline(books[1], {...regenerated.state, edition: 'fm', hash: books[1].sourceHash});
  assert.match(namedText(reversed.main.text, reversed.state.names), /Rowan/);
  assert.equal(characterRole('A-3', books[1]), 'female rival or enemy of A');
  // Links from before supporting cast names existed remain valid.
  const legacy = {...first.state, names: {a: 'Márta', b: 'Sam'}};
  assert.deepEqual(renderOutline(books[0], legacy).state, legacy);
});

test('conflict 813 offers the bare son/daughter symbol after all source adaptations', () => {
  for (const book of books) {
    const symbol = book.edition === 'mf' ? 'SN' : 'D';
    for (let seed = 0; seed < 12; seed++) {
      const outline = generateOutline(book, {main: '813', names: {a: 'Ada', b: '', [symbol]: 'Alex'}}, seededRandom(seed));
      assert.ok(outlineCharacters(outline, book).some((entry) => entry.symbol === symbol));
      assert.match(namedText(outline.main.text, outline.state.names), /Alex/);
      assert.equal(sharedState(outline, book).names[symbol], 'Alex');
      assert.equal(renderOutline(book, outline.state).state.names[symbol], 'Alex');
    }
  }
});

test('exports name added-character notes but preserve source instructions and editorial evidence', () => {
  const book = books[0];
  const outline = generateOutline(book, {main: '75a', names: {a: 'Ada', b: 'Ben', CH: 'Eli', 'A-3': 'Rowan'}}, seededRandom(12));
  outline.after.entries = [{...outline.main, reference: '75a ch A-3 to A',
    notes: ['Include CH in this situation.', 'Editorial repair: A-3 appears in the printed instruction.']}];
  const text = outlineText(outline, book);
  assert.match(text, /Include Eli in this situation/);
  assert.match(text, /Source instruction: 75a ch A-3 to A/);
  assert.match(text, /Editorial repair: A-3 appears in the printed instruction/);
  assert.match(text, /CH = Eli/);
});

test('malformed saved outlines fail with a recoverable error', () => {
  const book = books[0];
  const state = generateOutline(book, {main: '542'}, seededRandom(3)).state;
  for (const change of [{edition: 'fm'}, {v: 2}, {hash: 'old'}, {main: '<script>'}, {a: 0},
    {names: {a: {}, b: ''}}, {names: []}, {names: {a: '', b: '', 'A-3': {}}},
    {names: {a: '', b: '', 'A-3': 'x'.repeat(61)}}, {names: {a: '', b: '', unknown: 'Name'}},
    {names: JSON.parse('{"a":"","b":"","__proto__":"Name"}')},
    {before: {seed: -1}}, {after: {seed: 1, group: '0'}}]) {
    assert.throws(() => renderOutline(book, {...state, ...change}));
  }
});

test('all 21 repaired reference groups can actually be selected in both editions', () => {
  const refs = (expression) => expression.type === 'reference' ? [expression] : expression.items.flatMap(refs);
  for (const book of books) {
    for (const row of corrections) {
      const main = `${row.conflict}${row.variant}`;
      const option = stageOptions(book, main, row.direction).find((group) => refs(group.expression).some((ref) => ref.label === row.after));
      assert.ok(option, `${book.edition}: repaired group available for ${row.id}`);
      const state = generateOutline(book, {main}, seededRandom(45)).state;
      state[row.direction].group = option.groupIndex;
      const stage = renderOutline(book, state)[row.direction];
      assert.equal(stage.group, option.groupIndex, row.id);
      const entry = stage.entries.find((item) => item.reference === row.after);
      assert.ok(entry, row.id);
      assert.ok(entry.text.length > 0);
      if (row.kind.startsWith('editorial-')) {
        assert.equal(entry.correctionId, row.id);
        assert.match(entry.notes.join(' '), /Editorial repair:/);
      } else assert.equal(entry.correctionId, null);
    }
  }
});
