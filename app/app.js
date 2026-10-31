const state = { people: [], items: [] };
const $ = id => document.getElementById(id);
const money = c => (c / 100).toFixed(2);

function renderPeople() {
  $('people').innerHTML = state.people.map(p => `<li>${esc(p)}</li>`).join('');
  const fs = $('sharers');
  fs.innerHTML = '<legend>Shared by (tick everyone who shared it)</legend>' + (state.people.length
    // Kane iteration 2 (flow 03): pre-ticked boxes made "shared by both" ambiguous (clicking a name UN-ticked it).
    // Boxes now start unticked: tick exactly the people who shared the item.
    ? state.people.map(p => `<label class="chk"><input type="checkbox" name="sharer" value="${esc(p)}"> ${esc(p)}</label>`).join('') + '<p id="share-error" class="error" role="alert"></p>'
    : '<p class="hint">Add people first.</p>');
}
function renderItems() {
  // v1.1 (Kane flow 03): every item gets a Remove button; totals recalculate immediately.
  $('items').innerHTML = state.items.map((it, i) =>
    `<li><strong>${esc(it.name)}</strong> ${Number(it.price).toFixed(2)} <span class="who">shared by ${it.sharedBy.map(esc).join(', ')}</span>` +
    ` <button type="button" class="remove" data-index="${i}" aria-label="Remove ${esc(it.name)}">Remove</button></li>`).join('');
}
$('items').addEventListener('click', e => {
  const btn = e.target.closest('button.remove');
  if (!btn) return;
  state.items.splice(Number(btn.dataset.index), 1);
  renderItems(); renderTotals();
});
function renderTotals() {
  const { rows, total } = splitBill(state.people, state.items, $('tax').value, $('tip').value);
  $('totals').querySelector('tbody').innerHTML = rows.map(r =>
    `<tr data-person="${esc(r.person)}"><td>${esc(r.person)}</td><td>${money(r.items)}</td><td>${money(r.extra)}</td><td class="owes">${money(r.owes)}</td></tr>`).join('');
  $('grand-total').textContent = money(total);
  $('settle').textContent = rows.length
    ? rows.map(r => `${r.person} owes ${money(r.owes)}`).join('\n') + `\nTotal ${money(total)}`
    : '';
  $('check').textContent = rows.length ? `${rows.length} people, ${state.items.length} items` : 'Add people and items to see the split.';
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

$('person-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('person-name').value.trim();
  if (name && !state.people.includes(name)) state.people.push(name);
  $('person-name').value = '';
  renderPeople(); renderTotals();
});
$('item-form').addEventListener('submit', e => {
  e.preventDefault();
  const sharedBy = [...document.querySelectorAll('input[name=sharer]:checked')].map(i => i.value);
  const name = $('item-name').value.trim();
  const price = $('item-price').value;
  if (!sharedBy.length) { const er = $('share-error'); if (er) er.textContent = 'Tick at least one person who shared this item.'; return; }
  if (!name || price === '') return;
  state.items.push({ name, price: Number(price), sharedBy });
  $('item-name').value = ''; $('item-price').value = '';
  renderPeople(); renderItems(); renderTotals();
});
$('tax').addEventListener('input', renderTotals);
$('tip').addEventListener('input', renderTotals);
$('copy').addEventListener('click', () => navigator.clipboard?.writeText($('settle').textContent));
renderPeople(); renderTotals();
