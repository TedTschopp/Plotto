import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyOperations, replaceTogether, selectText, cleanText, generateOutline, renderOutline,
  stageOptions, seededRandom, namedText, outlineText} from '../js/engine.js';

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

test('names and text export preserve Unicode and do not rewrite relationship symbols', () => {
  assert.equal(namedText('A meets B and A-2 with F-A.', {a: 'Márta', b: 'Sam'}), 'Márta meets Sam and A-2 with F-A.');
  const outline = generateOutline(books[0], {main: '542', names: {a: 'Márta', b: 'Sam'}}, seededRandom(3));
  const text = outlineText(outline);
  assert.match(text, /\[542\] Márta/);
  assert.match(text, /LEAD-UP/);
  assert.match(text, /CARRY-ON/);
  assert.match(text, /A = Márta/);
});

test('malformed saved outlines fail with a recoverable error', () => {
  const book = books[0];
  const state = generateOutline(book, {main: '542'}, seededRandom(3)).state;
  for (const change of [{edition: 'fm'}, {v: 2}, {hash: 'old'}, {main: '<script>'}, {a: 0},
    {names: {a: {}, b: ''}}, {before: {seed: -1}}, {after: {seed: 1, group: '0'}}]) {
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
