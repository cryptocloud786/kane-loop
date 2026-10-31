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
  // Fix from Kane run #1 (flow 02): rounding tax+tip per person drifted the bill by a paisa
  // (3 x 16.67 = 50.01 on a 50.00 charge). Round the bill once, then hand out the extra
  // with the largest-remainder method so the rows always sum to the bill total.
  const rate = (Number(taxPct) || 0) / 100 + (Number(tipPct) || 0) / 100;
  const itemsTotal = people.reduce((s, p) => s + sub[p], 0);
  const extraTotal = Math.round(itemsTotal * rate);
  const exact = people.map(p => itemsTotal ? sub[p] * extraTotal / itemsTotal : 0);
  const extras = exact.map(Math.floor);
  let left = extraTotal - extras.reduce((a, b) => a + b, 0);
  exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => { if (left > 0) { extras[i]++; left--; } });
  const rows = people.map((p, i) => ({ person: p, items: sub[p], extra: extras[i], owes: sub[p] + extras[i] }));
  const total = rows.reduce((s, r) => s + r.owes, 0);
  return { rows, total };
}

if (typeof module !== 'undefined') module.exports = { splitBill, toCents };
