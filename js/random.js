function randomConflict() {
  const conflicts = document.querySelectorAll('.conflict[id]');
  if (conflicts.length) window.location.hash = conflicts[Math.floor(Math.random() * conflicts.length)].id;
}

const randomButton = document.getElementById('book-random');
if (randomButton) {
  randomButton.hidden = false;
  randomButton.addEventListener('click', randomConflict);
}
const query = new URLSearchParams(window.location.search);
if (query.has('random')) {
  query.delete('random');
  const search = query.toString();
  history.replaceState(null, '', window.location.pathname + (search ? `?${search}` : '') + window.location.hash);
  randomConflict();
}
document.querySelectorAll('[data-edition-link]').forEach((link) => {
  link.addEventListener('click', () => { link.hash = window.location.hash; });
});
