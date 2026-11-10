#!/usr/bin/env node
// claudecode-statusline — Node renderer (cross-platform, no bash/jq needed).
// Shows: caveman mode, project/folder, git branch, model, ctx%, effort,
//        5h and 7d rate-limit bars with used%/rem% + time-to-reset.
//
// Component env vars (set to 0 to hide):
//   SL_CAVEMAN=0 SL_PROJECT=0 SL_MODEL=0 SL_CTX=0
//   SL_EFFORT=0  SL_5H=0      SL_7D=0    SL_SAVINGS=0

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const on = (name) => process.env[name] !== '0';
const c = (n, s) => `\x1b[38;5;${n}m${s}\x1b[0m`;
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function fillBar(pct, width) {
  const filled = Math.max(0, Math.min(width, Math.floor((pct * width) / 100)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmtReset(epoch) {
  let n = Number(epoch);
  if (!(n > 0)) return '';
  if (n > 1e12) n = Math.floor(n / 1000); // tolerate ms
  const rem = Math.max(0, n - Math.floor(Date.now() / 1000));
  const d = Math.floor(rem / 86400);
  const h = Math.floor((rem % 86400) / 3600);
  const m = Math.floor((rem % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const usedColor = (p) => (p >= 80 ? 196 : p >= 50 ? 220 : 114);
const remColor = (p) => (p <= 20 ? 196 : p <= 50 ? 220 : 114);

function readSmall(file, max = 64) {
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) return '';
    return fs.readFileSync(file, 'utf8').slice(0, max);
  } catch (_) {
    return '';
  }
}

function rateBadge(label, node) {
  if (!node || node.used_percentage == null) return '';
  const used = Math.round(Number(node.used_percentage));
  if (Number.isNaN(used)) return '';
  const rem = 100 - used;
  const reset = fmtReset(node.resets_at);
  return (
    c(usedColor(used), `${label} ${fillBar(used, 8)} ${used}% used`) +
    ' ' +
    c(remColor(rem), `${rem}% rem`) +
    (reset ? ` ↺ ${reset}` : '')
  );
}

function render(input) {
  const parts = [];

  if (on('SL_CAVEMAN')) {
    const mode = readSmall(path.join(configDir, '.caveman-active'))
      .replace(/[\r\n]/g, '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const valid = ['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra', 'commit', 'review', 'compress'];
    if (valid.includes(mode)) {
      parts.push(c(172, mode === 'full' ? '[🪨 CAVEMAN]' : `[🪨 CAVEMAN:${mode.toUpperCase()}]`));
    }
  }

  if (on('SL_PROJECT')) {
    const dir = (input.workspace && (input.workspace.project_dir || input.workspace.current_dir)) || input.cwd || process.cwd();
    let seg = c(75, `📁 ${path.basename(dir)}`);
    try {
      const branch = execFileSync('git', ['-C', dir, 'branch', '--show-current'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, windowsHide: true,
      }).trim();
      if (branch) seg += c(114, ` 🌿 ${branch}`);
    } catch (_) { /* not a repo / no git */ }
    parts.push(seg);
  }

  if (on('SL_MODEL') && input.model && input.model.display_name) {
    parts.push(c(183, `🤖 ${input.model.display_name}`));
  }

  if (on('SL_CTX') && input.context_window && input.context_window.used_percentage != null) {
    const used = Math.round(Number(input.context_window.used_percentage));
    if (!Number.isNaN(used)) parts.push(c(usedColor(used), `CTX ${fillBar(used, 8)} ${used}%`));
  }

  if (on('SL_EFFORT') && input.effort && input.effort.level) {
    const lvl = String(input.effort.level);
    const map = { low: [244, '▁'], medium: [75, '▄'], high: [220, '▇'], xhigh: [208, '█'], max: [196, '█'] };
    const [col, icon] = map[lvl] || [244, '?'];
    parts.push(c(col, `⚡ ${icon} ${lvl.toUpperCase()}`));
  }

  const rl = input.rate_limits || {};
  if (on('SL_5H')) parts.push(rateBadge('5h', rl.five_hour));
  if (on('SL_7D')) parts.push(rateBadge('7d', rl.seven_day));

  if (on('SL_SAVINGS') && process.env.CAVEMAN_STATUSLINE_SAVINGS !== '0') {
    const s = readSmall(path.join(configDir, '.caveman-statusline-suffix')).replace(/[\x00-\x1f]/g, '');
    if (s) parts.push(c(172, s));
  }

  return parts.filter(Boolean).join(c(240, ' │ '));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw.replace(/^﻿/, '')); } catch (_) { /* render with defaults */ }
  process.stdout.write(render(input));
});
