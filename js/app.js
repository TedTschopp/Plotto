import {generateOutline, renderOutline, cleanText, namedText, namedNote, outlineText,
  outlineCharacters, characterRole, nameKey, sharedState, MAX_SHARED_HASH_LENGTH,
  automaticOutcome, masterplotText, masterplotConnection} from './engine.js';
import {loadCharacterNames, saveCharacterNames} from './name-storage.js';
import {loadStoryLibrary, saveLibraryStory, activateLibraryStory, MAX_STORY_TITLE} from './story-library.js';

const $ = (id) => document.getElementById(id);
const cache = new Map();
let book, outline, loading = 0, visibleResults = 12;
let rememberedNames = {a: '', b: ''}, namesLoaded = false, nameStorageAvailable = true;
let pendingRestore = null, storySaveMessage = '';
let activeStoryId = null, storyRevision = 0, storyTitle = '';

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
    names: {...(outline?.state.names ?? rememberedNames), a: $('name-a').value, b: $('name-b').value}};
}

function renderLibrary() {
  const loaded = loadStoryLibrary();
  const picker = $('story-picker');
  picker.replaceChildren(new Option('Choose a saved story', ''));
  [...loaded.library.stories].sort((a, b) => b.updatedAt - a.updatedAt).forEach((story) => {
    picker.append(new Option(`${story.title} · conflict ${story.state.main}`, story.id));
  });
  picker.value = activeStoryId || '';
  picker.disabled = !outline || loaded.invalid || loaded.library.stories.length === 0;
  if (document.activeElement !== $('story-title')) $('story-title').value = storyTitle;
  $('outline-title').textContent = storyTitle.trim() || 'Your story outline';
  $('story-memory-note').hidden = false;
  if ($('story-memory-note').textContent !== storySaveMessage) $('story-memory-note').textContent = storySaveMessage;
}

function persistStory(copy = false) {
  if (!outline || book?.edition !== $('edition').value) return false;
  const title = copy ? `${(storyTitle.trim() || 'Untitled story').slice(0, 113)} (copy)` : storyTitle;
  const result = saveLibraryStory(book, {id: copy ? null : activeStoryId, revision: copy ? 0 : storyRevision,
    title, state: outline.state, controls: currentOptions()});
  if (result.ok) {
    activeStoryId = result.story.id;
    storyRevision = result.story.revision;
    storyTitle = result.story.title;
    storySaveMessage = 'Your changes are saved automatically to this story in this browser.';
    pendingRestore = null;
    $('retry').hidden = true;
  } else storySaveMessage = `${result.error} Your current work is still open.`;
  renderLibrary();
  return result.ok;
}

function saveBeforeLeaving() {
  if (persistStory()) return true;
  showError(new Error(storySaveMessage));
  return false;
}

async function openStory(id) {
  if (!id || id === activeStoryId) return;
  if (!saveBeforeLeaving()) return;
  const story = loadStoryLibrary().library.stories.find((entry) => entry.id === id);
  if (!story) { showError(new Error('This saved story is no longer available. Your current work is still open.')); return; }
  markChanged();
  await loadEdition(story.state.edition, {...story, kind: 'library', activate: true});
}

function newStory() {
  if (!saveBeforeLeaving()) return;
  clearError();
  try {
    const next = generateOutline(book, {...currentOptions(), main: '', names: rememberedNames});
    activeStoryId = null;
    storyRevision = 0;
    storyTitle = '';
    $('story-title').value = '';
    $('start-conflict').value = '';
    outline = next;
    $('name-a').value = next.state.names.a;
    $('name-b').value = next.state.names.b;
    markChanged();
    render();
    $('story-title').focus();
    $('story-title').select();
    status('A new story is ready. Your other stories are saved in the story picker.');
  } catch (error) { showError(error); }
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
    if (!$('ending').value) {
      outline.state.c = automaticOutcome(outline, book);
      outline = renderOutline(book, outline.state);
    }
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
      generate();
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
  for (const names of [outline.state.names, rememberedNames]) {
    names[key] = value.trim();
    if (!value.trim() && key !== 'a' && key !== 'b') delete names[key];
  }
  nameStorageAvailable = saveCharacterNames(book, rememberedNames);
  markChanged();
  // Keep the input node (and its caret) in place while the story updates.
  render({updateCast: false});
}

function renderNameMemory() {
  $('name-memory-note').textContent = nameStorageAvailable
    ? 'Character names are saved automatically in this browser for your next visit.'
    : 'This browser could not save your name defaults. You can still use names in this outline.';
  $('clear-names').disabled = ![...Object.values(rememberedNames), ...Object.values(outline?.state.names ?? {})].some(Boolean);
}

function clearNames() {
  if (!outline || book?.edition !== $('edition').value) return;
  rememberedNames = {a: '', b: ''};
  outline.state.names = {a: '', b: ''};
  $('name-a').value = '';
  $('name-b').value = '';
  nameStorageAvailable = saveCharacterNames(book, rememberedNames);
  markChanged();
  render();
  status(nameStorageAvailable ? 'Character names cleared from this outline and this browser.'
    : 'Character names cleared for this visit. This browser could not update its saved names.');
}

function renderSupportingCast(characters) {
  const supporting = characters.filter(({symbol}) => symbol !== 'A' && symbol !== 'B');
  $('supporting-cast').hidden = supporting.length === 0;
  $('cast-link').hidden = supporting.length === 0;
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

function render({updateCast = true, persist = true} = {}) {
  const content = $('outline-content');
  content.replaceChildren();
  const master = element('div', undefined, 'masterplot');
  master.append(element('p', 'The masterplot · a direction for your story'));
  master.append(element('p', masterplotText(outline), 'masterplot-sentence'));
  const parts = element('details', undefined, 'masterplot-parts');
  parts.append(element('summary', 'Protagonist, action and outcome'));
  const clauses = element('ol');
  for (const [letter, clause] of [['A', outline.a], ['B', outline.b], ['C', outline.c]]) {
    const line = element('li');
    line.append(element('span', `${letter}${clause.id}`, 'clause-letter'), element('span', clause.text));
    clauses.append(line);
  }
  parts.append(clauses);
  master.append(parts, element('p', masterplotConnection(outline, book), 'masterplot-connection'));
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
  renderNameMemory();
  $('reader-link').href = `plotto-${book.edition}.html`;
  if (persist) {
    persistStory();
    pendingRestore = null;
    $('retry').hidden = true;
  }
  if (!persist) renderLibrary();
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
  const available = new Set([62, ...book.conflicts.filter((c) => !group || c.group === group).map((c) => c.bClause)]);
  $('action').replaceChildren(new Option('Any action', ''));
  book.clauses.b.filter((clause) => available.has(clause.id)).forEach((clause) => {
    $('action').append(new Option(`${clause.id}. ${clause.text}`, clause.id));
  });
  $('action').value = available.has(Number(selected)) ? selected : '';
}

function populateControls() {
  for (const [id, key] of [['protagonist', 'a'], ['ending', 'c']]) {
    const selected = $(id).value;
    $(id).replaceChildren(new Option(id === 'protagonist' ? 'Any person (neutral)' : 'Follow the linked ending', ''));
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

function restoreControls(restore) {
  const controls = restore.controls ?? {group: '', b: '', a: String(restore.state.a),
    c: String(restore.state.c), main: restore.state.main};
  $('theme').value = controls.group;
  updateActions();
  for (const [id, key] of [['action', 'b'], ['protagonist', 'a'], ['ending', 'c'], ['start-conflict', 'main']]) {
    $(id).value = controls[key];
  }
  $('name-a').value = restore.state.names.a;
  $('name-b').value = restore.state.names.b;
}

async function loadEdition(edition, restore = null) {
  const previous = outline && restore?.activate ? {book, outline, controls: currentOptions(),
    id: activeStoryId, revision: storyRevision, title: storyTitle, message: storySaveMessage} : null;
  const request = ++loading;
  pendingRestore = restore;
  clearError();
  $('edition').value = edition;
  $('generator-fields').disabled = true;
  $('story-library-fields').disabled = true;
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
    if (!namesLoaded) {
      const savedNames = loadCharacterNames(book);
      rememberedNames = savedNames.names;
      nameStorageAvailable = savedNames.available;
      namesLoaded = true;
      $('name-a').value = rememberedNames.a;
      $('name-b').value = rememberedNames.b;
    }
    populateControls();
    $('edition').value = edition;
    $('generator-fields').disabled = false;
    $('story-library-fields').disabled = false;
    $('generator-fields').querySelectorAll('input, select, button').forEach((control) => { control.disabled = false; });
    $('search').disabled = false;
    $('browse-theme').disabled = false;
    $('outline-content').inert = false;
    $('supporting-cast').inert = false;
    $('search-results').inert = false;
    if (restore) {
      let restored;
      try { restored = renderOutline(book, restore.state); }
      catch (error) {
        if (restore.kind === 'shared' || previous) throw error;
        activeStoryId = null;
        storyRevision = 0;
        storyTitle = '';
        generate();
        status('This saved story could not be restored with this collection. It is still in your library, and a new working story is shown.');
      }
      if (restored) {
        if (restore.activate) {
          const activated = activateLibraryStory(restore.id, restore.revision);
          if (!activated.ok) throw new Error(activated.error);
        }
        outline = restored;
        activeStoryId = restore.kind === 'library' ? restore.id : null;
        storyRevision = restore.kind === 'library' ? restore.revision : 0;
        storyTitle = restore.kind === 'library' ? restore.title :
          (typeof restore.state.title === 'string' ? restore.state.title.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_STORY_TITLE) : '') || 'Shared story';
        restoreControls(restore);
        storySaveMessage = restore.kind === 'shared'
          ? 'This shared story is a separate draft. Save it or make a change to add it to your stories.'
          : 'Your changes are saved automatically to this story in this browser.';
        render({persist: false});
        status(`${restore.kind === 'shared' ? 'Shared outline' : 'Your last story'} restored from conflict ${restore.state.main}.`);
        pendingRestore = null;
      }
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
    if (previous) {
      book = previous.book;
      outline = previous.outline;
      activeStoryId = previous.id;
      storyRevision = previous.revision;
      storyTitle = previous.title;
      storySaveMessage = previous.message;
      $('edition').value = book.edition;
      populateControls();
      restoreControls({state: outline.state, controls: previous.controls});
      $('generator-fields').disabled = false;
      $('generator-fields').querySelectorAll('input, select, button').forEach((control) => { control.disabled = false; });
      $('search').disabled = false;
      $('browse-theme').disabled = false;
      $('outline-content').inert = false;
      $('supporting-cast').inert = false;
      $('search-results').inert = false;
      render({persist: false});
    }
    $('story-library-fields').disabled = !outline;
    $('outline').setAttribute('aria-busy', 'false');
    $('retry').hidden = false;
    // Keep edition selection available even if one of the datasets cannot load.
    $('generator-fields').disabled = false;
    $('generator-fields').querySelectorAll('input, select, button').forEach((control) => {
      control.disabled = control.id !== 'edition' && book?.edition !== edition;
    });
    showError(error);
    status(previous ? 'The selected story could not be opened. Your current story is still open.'
      : 'You can still explore both linked editions using “Read the book.”');
  }
}

$('generator-form').addEventListener('submit', (event) => { event.preventDefault(); generate(); });
$('theme').addEventListener('change', updateActions);
$('edition').addEventListener('change', () => loadEdition($('edition').value));
$('retry').addEventListener('click', () => loadEdition(pendingRestore?.state.edition || $('edition').value, pendingRestore));
$('story-picker').addEventListener('change', () => openStory($('story-picker').value));
$('new-story').addEventListener('click', newStory);
$('save-story').addEventListener('click', () => {
  clearError();
  if (persistStory()) { markChanged(); status(`“${storyTitle}” saved.`); }
  else showError(new Error(storySaveMessage));
});
$('copy-story').addEventListener('click', () => {
  clearError();
  if (persistStory(true)) { markChanged(); status(`“${storyTitle}” saved as a separate story.`); }
  else showError(new Error(storySaveMessage));
});
$('story-title').addEventListener('input', () => {
  storyTitle = $('story-title').value;
  markChanged();
  persistStory();
});
$('story-title').addEventListener('blur', renderLibrary);
$('clear-names').addEventListener('click', clearNames);
$('cast-link').addEventListener('click', (event) => {
  event.preventDefault();
  $('character-names').open = true;
  $('character-names').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  $('name-a').focus({preventScroll: true});
});
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
$('copy-outline').addEventListener('click', () => copy(outlineText(outline, book, storyTitle), 'Outline copied.'));
$('copy-link').addEventListener('click', () => {
  const url = new URL(location.href);
  url.hash = `outline=${encodeURIComponent(JSON.stringify({...sharedState(outline, book), title: storyTitle}))}`;
  copy(url.href, 'Link copied. It restores this outline, its edition, and your character names.');
});
$('download-outline').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([outlineText(outline, book, storyTitle)], {type: 'text/plain;charset=utf-8'}));
  const link = element('a');
  link.href = url;
  link.download = `plotto-${outline.state.main}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Outline downloaded as a text file.');
});

let restore, sharedError;
try {
  if (location.hash.startsWith('#outline=')) {
    if (location.hash.length > MAX_SHARED_HASH_LENGTH) throw new Error('This shared outline is too large. Generate a new outline.');
    const shared = JSON.parse(decodeURIComponent(location.hash.slice(9)));
    if (!['mf', 'fm'].includes(shared?.edition)) throw new Error('This shared outline has an invalid edition.');
    restore = {state: shared, kind: 'shared'};
  }
} catch (error) {
  sharedError = new Error(`The shared outline could not be opened. ${error.message}`);
}
const savedStories = loadStoryLibrary();
const lastStory = savedStories.library.stories.find((story) => story.id === savedStories.library.activeId);
if (!restore && lastStory) restore = {...lastStory, kind: 'library'};
await loadEdition(restore?.state.edition || 'mf', restore);
if (savedStories.invalid && outline) status('Saved stories could not be read. Your draft is open; copy a link to keep this work. The stored library has not been replaced.');
if (sharedError) showError(sharedError);
