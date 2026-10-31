// Plain node unit checks for the split logic (no deps). Kane covers the real browser flows.
const assert = require('node:assert');
const { splitBill } = require('../app/split.js');
const sum = r => r.rows.reduce((s, x) => s + x.owes, 0);
let r = splitBill(['Asha', 'Ben'], [{ price: 600, sharedBy: ['Asha', 'Ben'] }, { price: 100, sharedBy: ['Ben'] }], 0, 10);
assert.deepStrictEqual(r.rows.map(x => x.owes), [33000, 44000]); assert.strictEqual(r.total, 77000);
r = splitBill(['Asha', 'Ben', 'Chen'], [{ price: 1000, sharedBy: ['Asha', 'Ben', 'Chen'] }], 5, 0);
assert.strictEqual(r.total, 105000); assert.strictEqual(sum(r), r.total);
for (let i = 0; i < 2000; i++) {
  const n = 1 + (i % 6), people = Array.from({ length: n }, (_, k) => 'P' + k);
  const items = Array.from({ length: 1 + (i % 4) }, (_, k) => ({ price: ((i * 37 + k * 101) % 99999) / 100, sharedBy: people.filter((_, j) => (j + k) % 2 === 0 || n === 1) }));
  const x = splitBill(people, items, (i % 19) / 2, (i % 15));
  const itemsTotal = x.rows.reduce((s, y) => s + y.items, 0);
  assert.strictEqual(sum(x), x.total);
  assert.strictEqual(x.total, itemsTotal + Math.round(itemsTotal * ((i % 19) / 2 / 100 + (i % 15) / 100)));
}
console.log('split.js: all unit checks pass');
