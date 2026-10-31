// Pure split logic. Kept separate so the agent can patch it without touching the UI.
// Amounts are handled in integer paise/cents to avoid floating-point drift.
function toCents(x) { return Math.round(Number(x) * 100); }

function splitBill(people, items, taxPct, tipPct) {
  const sub = Object.fromEntries(people.map(p => [p, 0]));
  for (const it of items) {
    const who = it.sharedBy.filter(p => p in sub);
    if (!who.length) continue;
    const cents = toCents(it.price);
    const base = Math.floor(cents / who.length);
    let rem = cents - base * who.length;
    for (const p of who) { sub[p] += base + (rem > 0 ? 1 : 0); rem--; }
  }
  const rate = (Number(taxPct) || 0) / 100 + (Number(tipPct) || 0) / 100;
  const rows = people.map(p => {
    const extra = Math.round(sub[p] * rate);
    return { person: p, items: sub[p], extra, owes: sub[p] + extra };
  });
  const total = rows.reduce((s, r) => s + r.owes, 0);
  return { rows, total };
}

if (typeof module !== 'undefined') module.exports = { splitBill, toCents };
