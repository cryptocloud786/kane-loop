# SplitSure spec (what the agent builds, what Kane verifies)

1. A user adds the people at the table by name.
2. A user adds items with a price and ticks who shared each item. A shared item is split evenly between the people who shared it.
3. Tax % and Tip % are charged on each person's own items (proportional, not split evenly).
4. The table shows, per person: their items, their tax + tip, and what they owe.
5. **Money is exact.** Amounts are shown to 2 decimals and the per-person amounts always add up to exactly the bill total, which is (sum of items) x (1 + tax% + tip%), rounded once. No paisa or cent is ever lost or invented.
6. A copy-ready settle-up message lists who owes what.

Each numbered claim above is covered by a plain-English Kane CLI flow in `kane/flows/`.
