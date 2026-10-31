#!/usr/bin/env node
// kane-loop: close the loop between an AI coding agent and Kane CLI.
//
//   node kane-loop.mjs verify            run every flow in kane/flows once (exit 1 on any red)
//   node kane-loop.mjs watch             verify, then re-verify on every save in app/ until all green
//   node kane-loop.mjs watch --agent-cmd "claude -p"
//                                        on red, pipe Kane's failure report into your agent CLI,
//                                        let it patch the code, then re-run Kane. Repeat until green.
//
// Every Kane run is streamed as NDJSON (kane-cli run --agent), parsed, and turned into
// .kane/AGENT_FEEDBACK.md: a prompt an agent can act on (which flow failed, what Kane
// expected vs. what it read off the page, the steps it took, the diff since last green).
// A timeline of every iteration is appended to evidence/loop-log.ndjson.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const cfg = Object.assign({
  app: 'app', port: 8080, flows: 'kane/flows', cdp: process.env.KANE_CDP || '',
  maxIterations: 5, timeout: 600,
}, readJSON(path.join(ROOT, 'kane.config.json')) || {});

const args = process.argv.slice(2);
const cmd = args[0] || 'verify';
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = name => args.includes(name);
const KANE = process.env.KANE_CLI || 'kane-cli';
const AGENT_CMD = opt('--agent-cmd', process.env.KANE_LOOP_AGENT_CMD || '');
const ONLY = opt('--flow', '');

const C = { red: s => `\x1b[31m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m` };
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function log(...a) { console.log(C.dim(`[kane-loop ${new Date().toLocaleTimeString()}]`), ...a); }
fs.mkdirSync(path.join(ROOT, '.kane'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'evidence/runs'), { recursive: true });

// ---------- flows ----------
function loadFlows() {
  const dir = path.join(ROOT, cfg.flows);
  return fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort().map(f => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const title = (text.match(/^#\s*(.+)$/m) || [, f])[1].trim();
    const objective = text.split('\n').filter(l => !l.startsWith('#')).join(' ').replace(/\s+/g, ' ').trim();
    return { id: f.replace(/\.txt$/, ''), title, objective };
  }).filter(f => !ONLY || f.id === ONLY);
}

// ---------- tiny static server for app/ ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serve() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, cfg.app, path.normalize(p));
      if (!file.startsWith(path.join(ROOT, cfg.app))) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(buf);
      });
    });
    srv.on('error', e => e.code === 'EADDRINUSE' ? resolve(null) : reject(e)); // reuse an existing server
    srv.listen(cfg.port, '127.0.0.1', () => resolve(srv));
  });
}

// ---------- one Kane run ----------
function runKane(flow) {
  return new Promise(resolve => {
    const url = process.env.KANE_LOOP_URL || `http://localhost:${cfg.port}/`;
    const kargs = ['run', flow.objective, '--url', url, '--agent', '--max-steps', '40', '--timeout', String(cfg.timeout)];
    if (cfg.cdp) kargs.push('--cdp-endpoint', cfg.cdp); else kargs.push('--headless');
    const raw = path.join(ROOT, 'evidence/runs', `${stamp()}-${flow.id}.ndjson`);
    const out = fs.createWriteStream(raw);
    const steps = []; let end = null;
    const child = spawn(KANE, kargs, { env: { ...process.env, NO_PROXY: [process.env.NO_PROXY, 'localhost', '127.0.0.1'].filter(Boolean).join(',') } });
    let buf = '';
    child.stdout.on('data', d => {
      out.write(d); buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.step && ev.status === 'done' && ev.remark) { steps.push(ev.remark); process.stdout.write(C.dim(`    · ${ev.remark}\n`)); }
        if (ev.type === 'run_end') end = ev;
      }
    });
    child.stderr.on('data', () => {});
    child.on('close', code => { out.end(); resolve({ flow, code, end, steps, raw: path.relative(ROOT, raw) }); });
  });
}

function summarize(r) {
  const e = r.end || {};
  const meta = (e.per_flow_metadata || [])[0] || {};
  const checks = Object.entries((e.context && e.context.memory) || {}).map(([k, m]) => ({
    name: k, condition: m.condition, expected: m.expected_value, actual: m.extracted_value,
    pass: /-> PASS/.test(m.reasoning || ''),
  }));
  return {
    flow: r.flow.id, title: r.flow.title,
    status: e.status || (r.code === 0 ? 'passed' : 'error'),
    reason: e.reason || meta.error_message || `kane-cli exited ${r.code}`,
    reason_code: e.reason_code, summary: e.summary, final_state: e.final_state,
    checks, steps: r.steps, test_url: e.test_url, credits: e.credits_consumed,
    duration_s: e.duration, raw: r.raw,
  };
}

function gitDiff() {
  try { return execSync(`git -C "${ROOT}" diff HEAD -- ${cfg.app}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).slice(0, 6000); } catch { return ''; }
}

function writeFeedback(results, iter) {
  const red = results.filter(r => r.status !== 'passed');
  const lines = [
    `# Kane CLI found ${red.length} failing flow(s) (iteration ${iter})`, '',
    'You are the coding agent for this repo. Kane CLI just drove the app in a real Chrome browser.',
    `Fix the code under \`${cfg.app}/\` so every flow below passes. Do not edit the flows in \`${cfg.flows}/\`;`,
    'they are the spec. Save your changes; kane-loop re-runs Kane on save.', '',
  ];
  for (const r of red) {
    lines.push(`## FAILED: ${r.title} (\`${r.flow}\`)`, '', `Kane's verdict: **${r.status}** (${r.reason_code || ''}) ${r.reason}`, '');
    if (r.checks.length) {
      lines.push('| check | expected | Kane read on the page | result |', '|---|---|---|---|');
      for (const c of r.checks) lines.push(`| ${c.condition || c.name} | ${c.expected ?? ''} | ${c.actual ?? ''} | ${c.pass ? 'pass' : 'FAIL'} |`);
      lines.push('');
    }
    if (r.summary) lines.push('What Kane did:', '', '```', r.summary, '```', '');
    if (r.final_state) lines.push('Final page state Kane extracted:', '', '```json', JSON.stringify(r.final_state, null, 2), '```', '');
    if (r.test_url) lines.push(`Kane run (video + steps): ${r.test_url}`, '');
  }
  const diff = gitDiff();
  if (diff) lines.push('## Your uncommitted changes since the last green commit', '', '```diff', diff, '```', '');
  const md = lines.join('\n');
  fs.writeFileSync(path.join(ROOT, '.kane/AGENT_FEEDBACK.md'), md);
  return md;
}

async function verify(iter = 1) {
  const flows = loadFlows();
  log(C.bold(`Kane verification #${iter}: ${flows.length} flow(s)`));
  const results = [];
  for (const f of flows) {
    log(`▶ ${f.title}`);
    const s = summarize(await runKane(f));
    results.push(s);
    const tag = s.status === 'passed' ? C.green('● PASS') : C.red('● FAIL');
    log(`${tag} ${f.title} ${C.dim(`(${s.duration_s ?? '?'}s, ${s.credits ? s.credits.toFixed(1) : '?'} credits)`)}`);
    for (const c of s.checks) log(`   ${c.pass ? C.green('✓') : C.red('✗')} ${c.condition}  expected ${c.expected}, page shows ${c.actual}`);
    if (s.status !== 'passed') log(C.red(`   ${s.reason}`));
  }
  const green = results.every(r => r.status === 'passed');
  const entry = { ts: new Date().toISOString(), iteration: iter, green, results: results.map(({ steps, ...r }) => r) };
  fs.writeFileSync(path.join(ROOT, '.kane/last.json'), JSON.stringify(entry, null, 2));
  fs.appendFileSync(path.join(ROOT, 'evidence/loop-log.ndjson'), JSON.stringify(entry) + '\n');
  if (!green) { writeFeedback(results, iter); log(C.yellow('Feedback for the agent written to .kane/AGENT_FEEDBACK.md')); }
  else { try { fs.unlinkSync(path.join(ROOT, '.kane/AGENT_FEEDBACK.md')); } catch {} }
  return green;
}

function waitForSave() {
  return new Promise(resolve => {
    let t = null;
    const w = fs.watch(path.join(ROOT, cfg.app), { recursive: true }, (_, file) => {
      clearTimeout(t);
      t = setTimeout(() => { w.close(); resolve(file); }, 1500);
    });
  });
}

function runAgent(prompt) {
  return new Promise(resolve => {
    log(C.yellow(`↻ handing Kane's failure to the agent: ${AGENT_CMD}`));
    const child = spawn(AGENT_CMD, { shell: true, cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.end(prompt);
    child.on('close', resolve);
  });
}

async function main() {
  const srv = await serve();
  log(`serving ./${cfg.app} on http://localhost:${cfg.port}/ ${srv ? '' : '(already running)'}`);
  let code = 0;
  if (cmd === 'verify') {
    code = (await verify()) ? 0 : 1;
  } else if (cmd === 'watch') {
    for (let iter = 1; iter <= cfg.maxIterations; iter++) {
      if (await verify(iter)) { log(C.green(C.bold('All Kane flows green. Loop closed.'))); break; }
      if (iter === cfg.maxIterations) { log(C.red('Still red after max iterations; a human should look.')); code = 1; break; }
      const fb = fs.readFileSync(path.join(ROOT, '.kane/AGENT_FEEDBACK.md'), 'utf8');
      if (AGENT_CMD) await runAgent(fb);
      else { log(C.yellow(`🔴 waiting for the agent to patch ./${cfg.app} (watching for saves)…`)); const f = await waitForSave(); log(`saved: ${f}; re-running Kane`); }
    }
  } else {
    console.log('usage: node kane-loop.mjs verify | watch [--agent-cmd "<agent cli>"] [--flow <id>]');
  }
  if (srv) srv.close();
  process.exit(code);
}
main();
