import {generateOutline, renderOutline, cleanText, namedText, namedNote, outlineText,
  outlineCharacters, characterRole, nameKey, sharedState, MAX_SHARED_HASH_LENGTH} from './engine.js';

const $ = (id) => document.getElementById(id);
const cache = new Map();
let book, outline, loading = 0, visibleResults = 12;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function status(message) { $('status').textContent = message; }
function clearError() { $('error').hidden = true; $('start-conflict').removeAttribute('aria-invalid'); }
function showError(error) {
  $('error').textContent = error.message || String(error);
  $('error').hidden = false;
  $('error').focus({preventScroll: true});
}

function currentOptions() {
  return {group: $('theme').value, b: $('action').value, a: $('protagonist').value,
    c: $('ending').value, main: $('start-conflict').value,
    names: {...outline?.state.names, a: $('name-a').value, b: $('name-b').value}};
}

function markChanged() {
  if (window.location.hash.startsWith('#outline=')) history.replaceState(null, '', location.pathname + location.search);
}

function sourceLink(entry, text = `Read ${entry.id}${entry.variant} in the book`) {
  const link = element('a', text, 'story-ref');
  link.href = `plotto-${book.edition}.html#${entry.id}${entry.variant}`;
  return link;
}

function renderEntry(entry) {
  const article = element('div', undefined, 'story-entry');
  article.append(element('p', namedText(entry.text, outline.state.names), 'story-text'));
  article.append(sourceLink(entry));
  if (entry.correctionId) {
    const correction = element('a', 'Why this reference changed', 'story-ref');
    correction.href = `corrections.html#${entry.correctionId}`;
    correction.style.marginLeft = '1rem';
    article.append(correction);
  }
  for (const note of entry.notes) article.append(element('p', namedNote(note, outline.state.names), 'adaptation-note'));
  if (entry.reference !== `${entry.id}${entry.variant}`) {
    article.append(element('p', `Source instruction: ${entry.reference}`, 'adaptation-note'));
  }
  return article;
}

function changeStage(direction, group) {
  try {
    const state = structuredClone(outline.state);
    state[direction] = {seed: newSeed(), group};
    outline = renderOutline(book, state);
    markChanged();
    render();
    status(`${direction === 'before' ? 'Lead-up' : 'Carry-on'} updated. The main conflict stays the same.`);
    $(`${direction}-reroll`)?.focus({preventScroll: true});
  } catch (error) { showError(error); }
}

function stage(title, direction, entries) {
  const section = element('section', undefined, `story-stage ${direction === 'main' ? 'main-stage' : ''}`);
  const heading = element('div', undefined, 'stage-heading');
  const name = element('h3', title);
  name.id = `${direction}-heading`;
  section.setAttribute('aria-labelledby', name.id);
  const reroll = element('button', direction === 'main' ? 'New main conflict' : 'Try another');
  reroll.type = 'button';
  reroll.id = `${direction}-reroll`;
  if (direction === 'main') {
    reroll.addEventListener('click', () => {
      $('start-conflict').value = '';
      generate({a: outline.state.a, c: outline.state.c});
      $('main-reroll')?.focus({preventScroll: true});
    });
  } else {
    const choices = outline[direction].options.filter((option) => option.groupIndex !== outline[direction].group);
    reroll.disabled = choices.length === 0;
    reroll.setAttribute('aria-label', `Try another ${title.toLowerCase()}`);
    if (!choices.length) reroll.title = 'No other usable linked suggestions for this conflict.';
    reroll.addEventListener('click', () => changeStage(direction, choices[Math.floor(Math.random() * choices.length)].groupIndex));
  }
  heading.append(name, reroll);
  section.append(heading);
  if (!entries.length) {
    section.append(element('p', 'The source has no usable linked suggestion for this stage. Try another main conflict, or supply your own connection.', 'help'));
  }
  entries.forEach((entry) => section.append(renderEntry(entry)));
  if (direction !== 'main' && outline[direction].options.length > 1) {
    const details = element('details', undefined, 'alternatives');
    details.append(element('summary', `Browse ${outline[direction].options.length} linked alternatives`));
    const label = element('label', 'Choose a source suggestion');
    label.htmlFor = `${direction}-choice`;
    const select = element('select');
    select.id = label.htmlFor;
    outline[direction].options.forEach((choice) => {
      const option = element('option', choice.label);
      option.value = choice.groupIndex;
      option.selected = choice.groupIndex === outline[direction].group;
      select.append(option);
    });
    select.addEventListener('change', () => {
      changeStage(direction, Number(select.value));
      const replacement = $(`${direction}-choice`);
      replacement.closest('details').open = true;
      replacement.focus({preventScroll: true});
    });
    details.append(label, select);
    section.append(details);
  }
  return section;
}

function updateName(key, value) {
  if (!outline || book?.edition !== $('edition').value) return;
  outline.state.names[key] = value.trim();
  if (!value.trim() && key !== 'a' && key !== 'b') delete outline.state.names[key];
  markChanged();
  // Keep the input node (and its caret) in place while the story updates.
  render({updateCast: false});
}

function renderSupportingCast(characters) {
  const supporting = characters.filter(({symbol}) => symbol !== 'A' && symbol !== 'B');
  $('supporting-cast').hidden = supporting.length === 0;
  const fields = $('supporting-name-fields');
  fields.replaceChildren();
  for (const {symbol, description} of supporting) {
    const field = element('div');
    const label = element('label', `Name for ${symbol} (optional)`);
    const input = element('input');
    input.type = 'text';
    input.id = `name-${symbol}`;
    input.dataset.symbol = symbol;
    input.maxLength = 60;
    input.autocomplete = 'off';
    input.value = outline.state.names[nameKey(symbol)] || '';
    label.htmlFor = input.id;
    const role = element('p', description, 'help');
    role.id = `role-${symbol}`;
    input.setAttribute('aria-describedby', role.id);
    input.addEventListener('input', () => updateName(nameKey(symbol), input.value));
    field.append(label, input, role);
    fields.append(field);
  }
}

function render({updateCast = true} = {}) {
  const content = $('outline-content');
  content.replaceChildren();
  const master = element('div', undefined, 'masterplot');
  master.append(element('p', 'The masterplot · a direction for your story'));
  const clauses = element('ol');
  for (const [letter, clause] of [['A', outline.a], ['B', outline.b], ['C', outline.c]]) {
    const line = element('li');
    line.append(element('span', letter, 'clause-letter'), element('span', clause.text));
    clauses.append(line);
  }
  master.append(clauses);
  content.append(master, stage('Lead-up', 'before', outline.before.entries),
    stage('Main conflict', 'main', [outline.main]), stage('Carry-on', 'after', outline.after.entries));
  $('outline-kind').textContent = outline.conflict.group;
  $('outline').setAttribute('aria-busy', 'false');
  $('export-tools').hidden = false;
  $('character-key').hidden = false;
  $('copy-fallback').hidden = true;
  $('copy-label').hidden = true;
  const characters = $('characters');
  characters.replaceChildren();
  const detected = outlineCharacters(outline, book);
  const keyCharacters = ['A', 'B'].map((symbol) => ({symbol, description: characterRole(symbol, book)}))
    .concat(detected.filter(({symbol}) => symbol !== 'A' && symbol !== 'B'));
  for (const {symbol, description} of keyCharacters) {
    const custom = outline.state.names[nameKey(symbol)];
    characters.append(element('dt', custom ? `${symbol} · ${custom}` : symbol), element('dd', description));
  }
  if (updateCast) renderSupportingCast(detected);
  $('reader-link').href = `plotto-${book.edition}.html`;
}

function generate(overrides = {}) {
  if (!book || book.edition !== $('edition').value) return;
  clearError();
  try {
    outline = generateOutline(book, {...currentOptions(), ...overrides});
    markChanged();
    render();
    status(`Outline ready, starting from conflict ${outline.state.main}. Try different linked suggestions or make the story your own.`);
  } catch (error) {
    if ($('start-conflict').value) $('start-conflict').setAttribute('aria-invalid', 'true');
    showError(error);
  }
}

function newSeed() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0];
}

function updateActions() {
  const selected = $('action').value;
  const group = $('theme').value;
  const available = new Set(book.conflicts.filter((c) => !group || c.group === group).map((c) => c.bClause));
  $('action').replaceChildren(new Option('Any action', ''));
  book.clauses.b.filter((clause) => available.has(clause.id)).forEach((clause) => {
    $('action').append(new Option(`${clause.id}. ${clause.text}`, clause.id));
  });
  $('action').value = available.has(Number(selected)) ? selected : '';
}

function populateControls() {
  for (const [id, key] of [['protagonist', 'a'], ['ending', 'c']]) {
    const selected = $(id).value;
    $(id).replaceChildren(new Option('Surprise me', ''));
    book.clauses[key].forEach((clause) => $(id).append(new Option(clause.text, clause.id)));
    $(id).value = selected;
  }
  updateActions();
}

function renderSearch(reset = true) {
  if (!book) return;
  if (reset) visibleResults = 12;
  const query = $('search').value.trim().toLocaleLowerCase();
  const group = $('browse-theme').value;
  const exact = /^(\d{1,4})([a-m]?)$/.exec(query);
  const words = query.split(/\s+/).filter(Boolean);
  const results = book.conflicts.filter((conflict) => !group || conflict.group === group).flatMap((conflict) =>
    conflict.variants.filter((variant) => exact ? conflict.id === Number(exact[1]) && (!exact[2] || variant.id === exact[2])
      : words.every((word) => `${variant.text} ${conflict.subgroup}`.toLocaleLowerCase().includes(word)))
      .map((variant) => ({conflict, variant})));
  $('result-count').textContent = results.length ? `${results.length.toLocaleString()} ${results.length === 1 ? 'suggestion' : 'suggestions'} · showing ${Math.min(visibleResults, results.length)}`
    : 'No conflicts found. Try fewer words, another theme, or a number from 1 to 1462.';
  const container = $('search-results');
  container.replaceChildren();
  for (const {conflict, variant} of results.slice(0, visibleResults)) {
    const article = element('article', undefined, 'conflict-result');
    const key = `${conflict.id}${variant.id}`;
    const meta = element('div', undefined, 'result-meta');
    meta.append(element('strong', `Conflict ${key}`), element('span', conflict.group));
    const fullText = cleanText(variant.text);
    const excerpt = fullText.length > 220 ? `${fullText.slice(0, 220).replace(/\s+\S*$/, '')}…` : fullText;
    const actions = element('div', undefined, 'result-actions');
    const use = element('button', 'Start here');
    use.type = 'button';
    use.setAttribute('aria-label', `Start an outline from conflict ${key}`);
    use.addEventListener('click', () => {
      $('start-conflict').value = key;
      generate({main: key});
      $('outline-title').setAttribute('tabindex', '-1');
      $('outline-title').focus({preventScroll: true});
      $('outline').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    });
    actions.append(use, sourceLink({id: conflict.id, variant: variant.id}, 'Read in book'));
    article.append(meta, element('p', excerpt), actions);
    container.append(article);
  }
  $('more-results').hidden = visibleResults >= results.length;
}

async function copy(text, message) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    status(message);
  } catch {
    $('copy-fallback').value = text;
    $('copy-fallback').hidden = false;
    $('copy-label').hidden = false;
    $('copy-fallback').focus();
    $('copy-fallback').select();
    status('Automatic copying is unavailable. The text is selected below; copy it with your keyboard.');
  }
}

async function loadEdition(edition, savedState) {
  const request = ++loading;
  clearError();
  $('edition').value = edition;
  $('generator-fields').disabled = true;
  $('search').disabled = true;
  $('browse-theme').disabled = true;
  $('retry').hidden = true;
  $('outline').setAttribute('aria-busy', 'true');
  $('outline-content').inert = true;
  $('supporting-cast').inert = true;
  $('search-results').inert = true;
  // Disable old edition controls until the new dataset is ready.
  $('export-tools').hidden = true;
  $('outline-content').querySelectorAll('button, select').forEach((control) => { control.disabled = true; });
  status('Loading the Plotto collection…');
  try {
    if (!cache.has(edition)) {
      const response = await fetch(`data/plotto-${edition}.json`);
      if (!response.ok) throw new Error(`The collection could not be loaded (${response.status}). Try again or read the linked book.`);
      const data = await response.json();
      if (data.version !== 1 || data.edition !== edition || data.conflicts?.length !== 1462 ||
          data.clauses?.a?.length !== 15 || data.clauses?.b?.length !== 62 || data.clauses?.c?.length !== 15 ||
          typeof data.sourceHash !== 'string' || !data.characters) {
        throw new Error('The Plotto collection is incomplete. Try loading it again.');
      }
      cache.set(edition, data);
    }
    if (request !== loading) return;
    book = cache.get(edition);
    populateControls();
    $('edition').value = edition;
    $('generator-fields').disabled = false;
    $('generator-fields').querySelectorAll('input, select, button').forEach((control) => { control.disabled = false; });
    $('search').disabled = false;
    $('browse-theme').disabled = false;
    $('outline-content').inert = false;
    $('supporting-cast').inert = false;
    $('search-results').inert = false;
    if (savedState) {
      outline = renderOutline(book, savedState);
      $('name-a').value = savedState.names.a;
      $('name-b').value = savedState.names.b;
      render();
      status(`Shared outline restored from conflict ${savedState.main}.`);
    } else if (outline) {
      const state = {...outline.state, edition, hash: book.sourceHash};
      outline = renderOutline(book, state);
      markChanged();
      render();
      status('Character roles updated. The same conflicts are shown in the selected edition.');
    } else generate();
    renderSearch();
  } catch (error) {
    if (request !== loading) return;
    $('outline').setAttribute('aria-busy', 'false');
    $('retry').hidden = false;
    // Keep edition selection available even if one of the datasets cannot load.
    $('generator-fields').disabled = false;
    $('generator-fields').querySelectorAll('input, select, button').forEach((control) => {
      control.disabled = control.id !== 'edition' && book?.edition !== edition;
    });
    showError(error);
    status('You can still explore both linked editions using “Read the book.”');
  }
}

$('generator-form').addEventListener('submit', (event) => { event.preventDefault(); generate(); });
$('theme').addEventListener('change', updateActions);
$('edition').addEventListener('change', () => loadEdition($('edition').value));
$('retry').addEventListener('click', () => loadEdition($('edition').value));
for (const key of ['a', 'b']) $('name-' + key).addEventListener('input', () => {
  updateName(key, $('name-' + key).value);
});
$('search-form').addEventListener('submit', (event) => { event.preventDefault(); renderSearch(); });
$('search').addEventListener('input', () => renderSearch());
$('browse-theme').addEventListener('change', () => renderSearch());
$('more-results').addEventListener('click', () => {
  const firstNew = $('search-results').children.length;
  visibleResults += 12;
  renderSearch(false);
  $('search-results').children[firstNew]?.querySelector('button')?.focus({preventScroll: true});
});
$('copy-outline').addEventListener('click', () => copy(outlineText(outline, book), 'Outline copied.'));
$('copy-link').addEventListener('click', () => {
  const url = new URL(location.href);
  url.hash = `outline=${encodeURIComponent(JSON.stringify(sharedState(outline, book)))}`;
  copy(url.href, 'Link copied. It restores this outline, its edition, and your character names.');
});
$('download-outline').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([outlineText(outline, book)], {type: 'text/plain;charset=utf-8'}));
  const link = element('a');
  link.href = url;
  link.download = `plotto-${outline.state.main}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Outline downloaded as a text file.');
});

let shared;
try {
  if (location.hash.startsWith('#outline=')) {
    if (location.hash.length > MAX_SHARED_HASH_LENGTH) throw new Error('This shared outline is too large. Generate a new outline.');
    shared = JSON.parse(decodeURIComponent(location.hash.slice(9)));
    if (!['mf', 'fm'].includes(shared?.edition)) throw new Error('This shared outline has an invalid edition.');
  }
} catch (error) {
  shared = undefined;
  await loadEdition('mf');
  showError(new Error(`The shared outline could not be opened. ${error.message}`));
}
if (!book) await loadEdition(shared?.edition || 'mf', shared);
