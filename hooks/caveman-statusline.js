#!/usr/bin/env node
// claudecode-statusline — statusline renderer (Node, cross-platform, zero deps).
//
// Default (no env vars) = the classic compact line:
//   caveman, project (branch only), model, ctx, effort, 5h, 7d, savings
// Opt-in extras (off by default):
//   burn, cost, time, lines, and git status markers (✎ ? ↑ ↓ ✖)
//
// Configuration (env vars set in the statusLine command):
//   SL_ORDER=all            everything: all 12 segments + git status markers
//   SL_ORDER=model,ctx,5h   show ONLY these segments, in this order
//                           (add `git` to the list for git status markers)
//   SL_BURN=1 SL_COST=1 SL_TIME=1 SL_LINES=1 SL_GIT=1
//                           switch one opt-in extra on (without SL_ORDER)
//   SL_THEME=nord           default | nord | gruvbox | light | mono
//   SL_<SEGMENT>=0          hide one segment:
//     SL_CAVEMAN SL_PROJECT SL_MODEL SL_CTX SL_EFFORT SL_5H SL_7D
//     SL_BURN SL_COST SL_TIME SL_LINES SL_SAVINGS
//   SL_GIT=0                hide git status markers (branch stays)
//   NO_COLOR=1              disable all colors
//
// Preview without Claude Code:  node caveman-statusline.js --demo
// Installed version:            node caveman-statusline.js --version

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = '2.0.0';

// ── themes (xterm-256 color numbers) ──────────────────────────────────────────
const THEMES = {
  default: {
    caveman: 172, project: 75, branch: 114, model: 183, sep: 240, savings: 172,
    ok: 114, warn: 220, crit: 196,
    dirty: 215, untracked: 245, ahead: 114, behind: 203,
    cost: 180, time: 109, add: 114, del: 203,
    effort: { low: 244, medium: 75, high: 220, xhigh: 208, max: 196 },
  },
  nord: {
    caveman: 173, project: 110, branch: 108, model: 139, sep: 240, savings: 173,
    ok: 108, warn: 222, crit: 167,
    dirty: 222, untracked: 245, ahead: 108, behind: 167,
    cost: 180, time: 109, add: 108, del: 167,
    effort: { low: 244, medium: 110, high: 222, xhigh: 173, max: 167 },
  },
  gruvbox: {
    caveman: 208, project: 109, branch: 142, model: 175, sep: 241, savings: 208,
    ok: 142, warn: 214, crit: 167,
    dirty: 214, untracked: 245, ahead: 142, behind: 167,
    cost: 214, time: 108, add: 142, del: 167,
    effort: { low: 245, medium: 109, high: 214, xhigh: 208, max: 167 },
  },
  light: {
    caveman: 130, project: 25, branch: 28, model: 90, sep: 250, savings: 130,
    ok: 28, warn: 172, crit: 160,
    dirty: 166, untracked: 245, ahead: 28, behind: 160,
    cost: 94, time: 24, add: 28, del: 160,
    effort: { low: 245, medium: 25, high: 172, xhigh: 166, max: 160 },
  },
  mono: {
    caveman: 250, project: 250, branch: 250, model: 250, sep: 240, savings: 250,
    ok: 245, warn: 250, crit: 231,
    dirty: 250, untracked: 245, ahead: 250, behind: 250,
    cost: 250, time: 250, add: 250, del: 250,
    effort: { low: 245, medium: 248, high: 250, xhigh: 252, max: 231 },
  },
};

// ── segment registry ──────────────────────────────────────────────────────────
const ALL_ORDER = [
  'caveman', 'project', 'model', 'ctx', 'effort', '5h', '7d', 'burn',
  'cost', 'time', 'lines', 'savings',
];
// New in v2 and therefore off unless asked for (SL_ORDER, SL_<SEGMENT>=1 or `all`).
const OPT_IN = ['burn', 'cost', 'time', 'lines'];
// What a plain install shows: exactly what v1 showed.
const DEFAULT_ORDER = ALL_ORDER.filter((k) => !OPT_IN.includes(k));
const FLAGS = {
  caveman: 'SL_CAVEMAN', project: 'SL_PROJECT', model: 'SL_MODEL', ctx: 'SL_CTX',
  effort: 'SL_EFFORT', '5h': 'SL_5H', '7d': 'SL_7D', burn: 'SL_BURN',
  cost: 'SL_COST', time: 'SL_TIME', lines: 'SL_LINES', savings: 'SL_SAVINGS',
};
const WINDOW_SECS = { five_hour: 5 * 3600, seven_day: 7 * 86400 };
const CAVEMAN_MODES = [
  'off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-full',
  'wenyan-ultra', 'commit', 'review', 'compress',
];

// ── formatting helpers ────────────────────────────────────────────────────────
function fillBar(pct, width) {
  const filled = Math.max(0, Math.min(width, Math.floor((pct * width) / 100)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// seconds -> "3d 7h" | "1h 22m" | "5m"
function fmtSpan(secs) {
  const rem = Math.max(0, Math.floor(secs));
  const d = Math.floor(rem / 86400);
  const h = Math.floor((rem % 86400) / 3600);
  const m = Math.floor((rem % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function toEpochSecs(epoch) {
  let n = Number(epoch);
  if (!(n > 0)) return 0;
  if (n > 1e12) n = Math.floor(n / 1000); // tolerate ms
  return n;
}

// epoch (s or ms) -> time until that moment, '' when unknown
function fmtReset(epoch, nowSec = Math.floor(Date.now() / 1000)) {
  const n = toEpochSecs(epoch);
  if (!n) return '';
  return fmtSpan(n - nowSec);
}

// elapsed milliseconds -> "45s" | "18m" | "1h 5m"
function fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  const s = Math.floor(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtCost(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) return '';
  return `$${n.toFixed(2)}`;
}

const usedKey = (p) => (p >= 80 ? 'crit' : p >= 50 ? 'warn' : 'ok');
const remKey = (p) => (p <= 20 ? 'crit' : p <= 50 ? 'warn' : 'ok');

// Seconds until a rate-limit window is exhausted at the current burn rate, or
// null when it will not run out before it resets (or there is too little data).
function burnEta(usedPct, resetsAt, windowSecs, nowSec) {
  const used = Number(usedPct);
  const reset = toEpochSecs(resetsAt);
  if (!(used > 0) || used >= 100 || !reset) return null;
  const remaining = reset - nowSec;
  if (remaining <= 0 || remaining > windowSecs + 60) return null;
  const elapsed = windowSecs - remaining;
  if (elapsed < windowSecs * 0.05) return null; // too early to extrapolate
  const eta = ((100 - used) * elapsed) / used;
  return eta < remaining ? Math.round(eta) : null;
}

// ── git ───────────────────────────────────────────────────────────────────────
function parseGitStatus(text) {
  const r = { branch: '', dirty: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 };
  let oid = '';
  for (const line of String(text).split('\n')) {
    if (line.startsWith('# branch.head ')) r.branch = line.slice(14).trim();
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) { r.ahead = Number(m[1]); r.behind = Number(m[2]); }
    }
    else if (line.startsWith('1 ') || line.startsWith('2 ')) r.dirty++;
    else if (line.startsWith('u ')) r.conflicts++;
    else if (line.startsWith('? ')) r.untracked++;
  }
  if (r.branch === '(detached)') {
    r.branch = oid && oid !== '(initial)' ? `@${oid.slice(0, 7)}` : 'detached';
  }
  return r;
}

// One git subprocess. withStatus=false -> branch name only (cheaper on big repos).
function readGit(dir, withStatus) {
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, windowsHide: true };
  try {
    if (!withStatus) {
      const branch = execFileSync('git', ['--no-optional-locks', '-C', dir, 'branch', '--show-current'], opts).trim();
      return branch ? { branch } : null;
    }
    const out = execFileSync('git', ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v2', '--branch'], opts);
    const info = parseGitStatus(out);
    return info.branch ? info : null;
  } catch (_) {
    return null; // not a repo / no git
  }
}

// ── small io helpers ──────────────────────────────────────────────────────────
function readSmall(file, max = 64) {
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) return '';
    return fs.readFileSync(file, 'utf8').slice(0, max);
  } catch (_) {
    return '';
  }
}

// ── segments ──────────────────────────────────────────────────────────────────
function rateBadge(x, label, node) {
  if (!node || node.used_percentage == null) return '';
  const used = Math.round(Number(node.used_percentage));
  if (Number.isNaN(used)) return '';
  const rem = 100 - used;
  const reset = fmtReset(node.resets_at, x.now);
  return (
    x.c(usedKey(used), `${label} ${fillBar(used, 8)} ${used}% used`) +
    ' ' +
    x.c(remKey(rem), `${rem}% rem`) +
    (reset ? ` ↺ ${reset}` : '')
  );
}

const SEGMENTS = {
  caveman(x) {
    let mode = x.opts.caveman;
    if (mode === undefined) {
      mode = readSmall(path.join(x.configDir, '.caveman-active'))
        .replace(/[\r\n]/g, '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    }
    if (!CAVEMAN_MODES.includes(mode)) return '';
    return x.c('caveman', mode === 'full' ? '[🪨 CAVEMAN]' : `[🪨 CAVEMAN:${mode.toUpperCase()}]`);
  },

  project(x) {
    const i = x.input;
    const dir = (i.workspace && (i.workspace.project_dir || i.workspace.current_dir)) || i.cwd || process.cwd();
    let seg = x.c('project', `📁 ${path.basename(dir)}`);
    const withStatus = x.gitMarkers;
    const g = x.git(dir, withStatus);
    if (!g || !g.branch) return seg;
    seg += x.c('branch', ` 🌿 ${g.branch}`);
    if (withStatus) {
      const marks = [];
      if (g.conflicts) marks.push(x.c('crit', `✖${g.conflicts}`));
      if (g.dirty) marks.push(x.c('dirty', `✎${g.dirty}`));
      if (g.untracked) marks.push(x.c('untracked', `?${g.untracked}`));
      if (g.ahead) marks.push(x.c('ahead', `↑${g.ahead}`));
      if (g.behind) marks.push(x.c('behind', `↓${g.behind}`));
      if (marks.length) seg += ' ' + marks.join(' ');
    }
    return seg;
  },

  model(x) {
    const m = x.input.model;
    return m && m.display_name ? x.c('model', `🤖 ${m.display_name}`) : '';
  },

  ctx(x) {
    const cw = x.input.context_window;
    if (!cw || cw.used_percentage == null) return '';
    const used = Math.round(Number(cw.used_percentage));
    return Number.isNaN(used) ? '' : x.c(usedKey(used), `CTX ${fillBar(used, 8)} ${used}%`);
  },

  effort(x) {
    const e = x.input.effort;
    if (!e || !e.level) return '';
    const lvl = String(e.level);
    const icons = { low: '▁', medium: '▄', high: '▇', xhigh: '█', max: '█' };
    const col = x.theme.effort[lvl];
    return x.c(col === undefined ? 244 : col, `⚡ ${icons[lvl] || '?'} ${lvl.toUpperCase()}`);
  },

  '5h'(x) { return rateBadge(x, '5h', (x.input.rate_limits || {}).five_hour); },
  '7d'(x) { return rateBadge(x, '7d', (x.input.rate_limits || {}).seven_day); },

  burn(x) {
    const rl = x.input.rate_limits || {};
    const out = [];
    for (const [key, label] of [['five_hour', '5h'], ['seven_day', '7d']]) {
      const node = rl[key];
      if (!node) continue;
      const eta = burnEta(node.used_percentage, node.resets_at, WINDOW_SECS[key], x.now);
      if (eta == null) continue;
      const remaining = toEpochSecs(node.resets_at) - x.now;
      out.push(x.c(eta / remaining < 0.5 ? 'crit' : 'warn', `🔥 ${label} full in ~${fmtSpan(eta)}`));
    }
    return out.join(' ');
  },

  cost(x) {
    const cost = x.input.cost;
    if (!cost || cost.total_cost_usd == null) return '';
    const s = fmtCost(cost.total_cost_usd);
    return s ? x.c('cost', `💰 ${s}`) : '';
  },

  time(x) {
    const cost = x.input.cost;
    if (!cost || cost.total_duration_ms == null) return '';
    const s = fmtDuration(cost.total_duration_ms);
    return s ? x.c('time', `⏱ ${s}`) : '';
  },

  lines(x) {
    const cost = x.input.cost;
    if (!cost) return '';
    const add = Math.max(0, Math.round(Number(cost.total_lines_added) || 0));
    const del = Math.max(0, Math.round(Number(cost.total_lines_removed) || 0));
    if (!add && !del) return '';
    return x.c('add', `+${add}`) + ' ' + x.c('del', `-${del}`);
  },

  savings(x) {
    if (x.env.CAVEMAN_STATUSLINE_SAVINGS === '0') return '';
    let s = x.opts.savings;
    if (s === undefined) s = readSmall(path.join(x.configDir, '.caveman-statusline-suffix'));
    s = String(s).replace(/[\x00-\x1f]/g, '');
    return s ? x.c('savings', s) : '';
  },
};

// ── config resolution ─────────────────────────────────────────────────────────
const tokens = (str) => String(str || '').toLowerCase().split(/[\s,]+/).filter(Boolean);

// Segment keys named in an SL_ORDER string (unknown names and duplicates dropped).
function parseOrder(str) {
  return [...new Set(tokens(str).filter((t) => SEGMENTS[t]))];
}

// -> { order: [segment keys], git: show git status markers }
//   SL_ORDER=all            every segment + git markers
//   SL_ORDER=a,b[,git]      exactly these (git markers only if `git` is listed)
//   (unset / nothing valid) classic set; opt-ins join via SL_<SEGMENT>=1 / SL_GIT=1
// SL_<SEGMENT>=0 and SL_GIT=0 are applied afterwards by render().
function resolveConfig(env) {
  const toks = tokens(env.SL_ORDER);
  if (toks.includes('all')) return { order: ALL_ORDER, git: true };
  const listed = parseOrder(env.SL_ORDER);
  if (listed.length) return { order: listed, git: toks.includes('git') };
  return {
    order: ALL_ORDER.filter((k) => !OPT_IN.includes(k) || env[FLAGS[k]] === '1'),
    git: toks.includes('git') || env.SL_GIT === '1',
  };
}

function resolveOrder(env) {
  return resolveConfig(env).order;
}

function resolveTheme(env) {
  return THEMES[String(env.SL_THEME || '').toLowerCase()] || THEMES.default;
}

function colorEnabled(env) {
  return !(env.NO_COLOR != null && env.NO_COLOR !== '');
}

// ── render ────────────────────────────────────────────────────────────────────
// opts (all optional, mainly for tests / --demo):
//   env, now (epoch s), git(dir, withStatus), configDir, caveman, savings
function render(input, opts = {}) {
  const env = opts.env || process.env;
  const theme = resolveTheme(env);
  const color = colorEnabled(env);
  const c = (key, s) => {
    if (!color) return s;
    const n = typeof key === 'number' ? key : theme[key];
    return `\x1b[38;5;${n}m${s}\x1b[0m`;
  };
  const cfg = resolveConfig(env);
  const x = {
    input: input || {},
    env,
    opts,
    theme,
    c,
    gitMarkers: cfg.git && env.SL_GIT !== '0',
    now: opts.now != null ? opts.now : Math.floor(Date.now() / 1000),
    git: opts.git || readGit,
    configDir: opts.configDir || env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  };
  const parts = [];
  for (const key of cfg.order) {
    if (env[FLAGS[key]] === '0') continue;
    let seg = '';
    try { seg = SEGMENTS[key](x); } catch (_) { /* a broken segment never kills the line */ }
    if (seg) parts.push(seg);
  }
  return parts.join(c('sep', ' │ '));
}

// ── demo (preview themes / order without Claude Code) ─────────────────────────
function demo(env) {
  const now = Math.floor(Date.now() / 1000);
  const input = {
    workspace: { project_dir: '/home/you/my-project' },
    model: { display_name: 'Claude Opus 5.5' },
    context_window: { used_percentage: 42 },
    effort: { level: 'medium' },
    rate_limits: {
      five_hour: { used_percentage: 62, resets_at: now + 2 * 3600 + 40 * 60 },
      seven_day: { used_percentage: 41, resets_at: now + 3 * 86400 + 7 * 3600 },
    },
    cost: { total_cost_usd: 0.42, total_duration_ms: 18 * 60000, total_lines_added: 124, total_lines_removed: 37 },
  };
  return render(input, {
    env, now,
    caveman: 'full',
    savings: '🪨 ~42% tokens saved',
    git: () => ({ branch: 'main', dirty: 3, untracked: 2, conflicts: 0, ahead: 1, behind: 0 }),
  });
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  if (process.argv.includes('--version')) {
    process.stdout.write(VERSION + '\n');
    return;
  }
  if (process.argv.includes('--demo')) {
    process.stdout.write(demo(process.env) + '\n');
    return;
  }
  if (process.stdin.isTTY) { // run by hand with nothing piped in
    process.stdout.write(render({}) + '\n');
    return;
  }
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    let input = {};
    try { input = JSON.parse(raw.replace(/^﻿/, '')); } catch (_) { /* render with defaults */ }
    process.stdout.write(render(input));
  });
}

if (require.main === module) main();

module.exports = {
  VERSION, THEMES, DEFAULT_ORDER, ALL_ORDER, OPT_IN, FLAGS,
  fillBar, fmtSpan, fmtReset, fmtDuration, fmtCost,
  burnEta, parseGitStatus, parseOrder, resolveOrder, resolveConfig,
  render, demo,
};
