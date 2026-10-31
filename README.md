# kane-loop + SplitSure

**An AI coding agent that can't call a feature done until Kane CLI says green.**

SplitSure is a small, real bill splitter (people, items, who shared what, tax and tip, who owes what).
`kane-loop` is the harness around it: it runs plain-English Kane CLI flows against the app in a real
Chrome browser, parses Kane's NDJSON stream, and turns every red run into a prompt the coding agent acts on.
When the agent saves a fix, kane-loop re-runs Kane automatically. The loop ends only when every flow is green.

- **Live app:** https://cryptocloud786.github.io/kane-loop/
- **Demo video (3 min):** see the submission (link also below once uploaded)
- **Kane run evidence:** [`evidence/`](evidence/) (raw Kane NDJSON for every run + the loop timeline), and the public Kane Test Manager links in [`EVIDENCE.md`](EVIDENCE.md)

Built for the TestMu AI **Kane CLI Online Hackathon** (Lane 1 "apps that verify themselves" + Lane 2 "kane-watch").

## The moment the loop closed (real run, 31 Oct 2026)

| # | What happened | Kane verdict |
|---|---|---|
| 1 | The agent wrote SplitSure v1 from [`SPEC.md`](SPEC.md) and the two flows in [`kane/flows/`](kane/flows/) | |
| 2 | `kane-loop watch` ran flow 01 "two friends, 10% tip" | 🟢 330.00 / 440.00 / 770.00 |
| 3 | It ran flow 02 "three-way split with 5% tax never loses a paisa" | 🔴 **FAIL** (`stuck.ap_stuck`): Kane could not make the "total is exactly 1050.00" check pass, because the page showed **1050.01** for a 1000.00 bill + 5% tax (each person's 16.67 tax was rounded separately: 3 x 16.67 = 50.01) |
| 4 | kane-loop wrote `.kane/AGENT_FEEDBACK.md` (failing flow, Kane's verdict and summary, its run link) and waited ([copy](evidence/feedback/iteration-1-AGENT_FEEDBACK.md)) | |
| 5 | The agent read the feedback, opened Kane's run, saw 1050.01 on the page, patched `app/split.js` (round the bill once, then share out tax+tip by largest remainder) and saved | |
| 6 | The save fired Kane again on both flows | 🟢 both green, total 1050.00 = 350.01 + 350.00 + 349.99 |

Honest note: Kane's verdict on the red run was "stuck" rather than a named value mismatch, so the agent had to open
Kane's run to see the 1050.01. So the agent then taught kane-loop to do that itself: when Kane fails without a
value-level check, kane-loop now reads the page text from the browser Kane just used and puts it in the feedback. The bug itself was not planted.

## Round 2: spec first, then the feature (real run, 31 Oct 2026)

| # | What happened | Kane verdict |
|---|---|---|
| 1 | SPEC v1.1 claim 7 ("remove an item and every total updates") and flow 03 committed **before** any code (commit 8786ec5) | |
| 2 | `kane-loop watch`: flows 01 and 02 still green, flow 03... | 🔴 `confirmed_product_bug`: "there was no visible action to delete it" (feedback now carries the page text) |
| 3 | Agent adds a Remove button per item and saves | |
| 4 | Kane re-runs | 🔴 `stuck.dag_cycle`: the "Shared by" boxes started **pre-ticked**, so Kane's "tick both" clicks un-ticked people and Cake got added twice. A real UX trap a human tester could hit too |
| 5 | Agent makes the boxes start unticked, adds an inline "tick at least one person" error, saves | |
| 6 | Kane re-runs all three flows | 🟢 300.00 / 300.00 / 600.00, "Cake is no longer listed" |

Full table with every Kane run link: [`EVIDENCE.md`](EVIDENCE.md). It was a genuine rounding bug in the agent's first version, and the spec claim
"per-person amounts always add up to the bill total" is exactly the kind of thing a human eyeballing the UI misses.

## How it works

```
 agent edits app/  ──save──▶  kane-loop watch  ──▶  kane-cli run "<flow>" --agent  (real Chrome)
        ▲                                                   │ NDJSON: steps, checks, run_end
        │                                                   ▼
        └──── .kane/AGENT_FEEDBACK.md  ◀── red? ── parse verdict, expected vs. page values, Kane run URL
                                           green? ── done; timeline appended to evidence/loop-log.ndjson
```

- **Flows are the spec.** Each file in `kane/flows/*.txt` is one plain-English Kane objective that covers a claim in `SPEC.md`. No selectors, no framework.
- **`kane-loop verify`** runs every flow once (`kane-cli run ... --agent`), prints each Kane check (expected vs. what Kane read on the page), exits 1 on red. Use it in CI or the bundled git hook.
- **`kane-loop watch`** verifies, and on red writes `.kane/AGENT_FEEDBACK.md` and watches `app/`. Any agent (Claude Code, Cursor, Codex, a human) that edits and saves triggers the next Kane run.
- **`kane-loop watch --agent-cmd "<agent cli>"`** closes the loop with no human: on red it pipes Kane's feedback into your agent CLI (for example `claude -p --permission-mode acceptEdits`, `codex exec`, `gemini -p`), waits for it to finish, and re-runs Kane, up to `maxIterations`.
- **`hooks/pre-commit`** blocks a commit that touches `app/` while Kane is red (`git config core.hooksPath hooks`).
- Every iteration is appended to `evidence/loop-log.ndjson`; raw Kane NDJSON for every run is kept in `evidence/runs/`.

## Run it

App only (no account needed), one command:

```bash
git clone https://github.com/cryptocloud786/kane-loop && cd kane-loop && node kane-loop.mjs serve
# open http://localhost:8080/
```

Or just open the live app: https://cryptocloud786.github.io/kane-loop/

With Kane CLI (needs a free TestMu AI account):

```bash
npm install -g @testmuai/kane-cli
kane-cli login --username <testmu-username> --access-key <access-key>
node kane-loop.mjs verify            # one pass over every flow
node kane-loop.mjs watch             # red -> feedback -> save -> Kane re-runs -> green
node kane-loop.mjs watch --agent-cmd "claude -p --permission-mode acceptEdits"
```

Optional settings: `kane.config.json` (port, flow folder, max iterations), `KANE_CDP=http://127.0.0.1:9222`
to drive an already-running Chrome, `KANE_LOOP_URL` to point the flows at a deployed URL instead of localhost
(for example the GitHub Pages build).

Unit checks for the split math (2,000 random bills, total always equals the sum of the rows): `node test/split.test.cjs`.

## Who it's for

Anyone shipping a web app with an AI agent who wants the agent to prove a feature works in a real browser
before it says "done", without writing Playwright selectors. SplitSure is the example app; kane-loop works with
any static or local web app: point `app` at your folder, write flows in plain English.

## Agent and tools

- Coding agent: **Hark** (an AI agent, Claude-based), which wrote the app, the flows, kane-loop, and the fix in response to Kane's failure.
- Verification: **Kane CLI 0.10.0** (`kane-cli run --agent`, NDJSON), Chrome (Chromium 156) via CDP.
- No runtime dependencies: Node 20+ standard library only.

## Repo map

```
app/                 SplitSure (index.html, app.js, split.js, style.css) - also the GitHub Pages site
kane/flows/          plain-English Kane CLI flows (the spec, one per claim)
kane-loop.mjs        the loop: serve / verify / watch / --agent-cmd
hooks/pre-commit     block commits while Kane is red
evidence/            loop-log.ndjson + raw Kane NDJSON of every run
EVIDENCE.md          the run table with public Kane Test Manager links
SPEC.md              what the app must do
test/                plain node unit checks for split.js
```

MIT licensed.
