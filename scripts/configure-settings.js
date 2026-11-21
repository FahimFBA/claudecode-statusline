#!/usr/bin/env node
// claudecode-statusline — settings.json editor shared by every installer.
//
//   node configure-settings.js install   --settings FILE --hooks-dir DIR [--env "SL_THEME=nord SL_ORDER=model,ctx"] [--archive pre-v2]
//   node configure-settings.js uninstall --settings FILE [--keep-plugin]
//   node configure-settings.js show      --settings FILE   (current statusLine command)
//   node configure-settings.js status    --settings FILE   (none | foreign | v1 | v2)
//   node configure-settings.js env       --settings FILE   (our statusLine env vars, validated)
//
// Only entries that belong to this project are added or removed. Every other
// key, hook and plugin in the file is preserved. The previous file is saved as
// <settings>.bak before any write.

'use strict';
const fs = require('fs');
const path = require('path');

const HOOKS = [
  ['SessionStart', 'caveman-activate.js', 'Loading caveman mode...'],
  ['UserPromptSubmit', 'caveman-mode-tracker.js', 'Tracking caveman mode...'],
];
const OUR_HOOK = /caveman-(?:activate|mode-tracker)\.js/;
const OUR_STATUSLINE = /caveman-statusline\.(?:js|sh)/;
const ENV_NAME = '(?:SL_[A-Z0-9_]+|NO_COLOR|CAVEMAN_STATUSLINE_SAVINGS)';
const ENV_PREFIX = new RegExp('^(?:' + ENV_NAME + '=[A-Za-z0-9_,.-]*(?: +|$))*$');
const PLUGIN_ID = 'caveman@caveman';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const toPosix = (p) => String(p).replace(/\\/g, '/');

// 'none' | 'foreign' (someone else's statusLine) | 'v1' (bash renderer) | 'v2' (Node renderer)
function statuslineStatus(cfg) {
  const cmd = isObj(cfg) && isObj(cfg.statusLine) ? String(cfg.statusLine.command || '') : '';
  if (!cmd) return 'none';
  if (!OUR_STATUSLINE.test(cmd)) return 'foreign';
  return /caveman-statusline\.js/.test(cmd) ? 'v2' : 'v1';
}

// Leading KEY=value assignments of one of our statusLine commands, validated.
// Anything that is not a known, shell-safe variable is dropped.
function extractEnv(cfg) {
  const status = statuslineStatus(cfg);
  if (status === 'none' || status === 'foreign') return '';
  const m = /^((?:[A-Z][A-Z0-9_]*=\S*\s+)*)(?:bash|node|sh)\b/.exec(String(cfg.statusLine.command).trim());
  if (!m) return '';
  return m[1].trim().split(/\s+/).filter((t) => t && ENV_PREFIX.test(t)).join(' ');
}

function statuslineCommand(hooksDir, envPrefix = '') {
  const prefix = String(envPrefix).trim();
  if (!ENV_PREFIX.test(prefix)) throw new Error(`Refusing unsafe env prefix: ${prefix}`);
  return `${prefix ? prefix + ' ' : ''}node "${toPosix(hooksDir)}/caveman-statusline.js"`;
}

// Drop our hook commands from an event's group list; drop groups left empty.
function stripOurs(groups) {
  if (!Array.isArray(groups)) return [];
  const out = [];
  for (const g of groups) {
    if (!isObj(g) || !Array.isArray(g.hooks)) { out.push(g); continue; }
    const kept = g.hooks.filter((h) => !(isObj(h) && OUR_HOOK.test(String(h.command || ''))));
    if (kept.length === g.hooks.length) out.push(g);
    else if (kept.length) out.push({ ...g, hooks: kept });
  }
  return out;
}

function applyInstall(cfg, { hooksDir, envPrefix = '' }) {
  const out = isObj(cfg) ? cfg : {};
  const dir = toPosix(hooksDir);

  const hooks = isObj(out.hooks) ? out.hooks : {};
  for (const [event, file, msg] of HOOKS) {
    const groups = stripOurs(hooks[event]);
    groups.push({ hooks: [{ type: 'command', command: `node "${dir}/${file}"`, timeout: 5, statusMessage: msg }] });
    hooks[event] = groups;
  }
  out.hooks = hooks;

  out.statusLine = { type: 'command', command: statuslineCommand(dir, envPrefix) };

  out.enabledPlugins = isObj(out.enabledPlugins) ? out.enabledPlugins : {};
  out.enabledPlugins[PLUGIN_ID] = true;

  out.extraKnownMarketplaces = isObj(out.extraKnownMarketplaces) ? out.extraKnownMarketplaces : {};
  if (!out.extraKnownMarketplaces.caveman) {
    out.extraKnownMarketplaces.caveman = { source: { source: 'github', repo: 'JuliusBrussee/caveman' } };
  }
  return out;
}

// Returns { cfg, removed: [human readable list] }.
function applyUninstall(cfg, { keepPlugin = false } = {}) {
  const out = isObj(cfg) ? cfg : {};
  const removed = [];

  if (isObj(out.hooks)) {
    for (const [event] of HOOKS) {
      if (!Array.isArray(out.hooks[event])) continue;
      const before = JSON.stringify(out.hooks[event]);
      const groups = stripOurs(out.hooks[event]);
      if (JSON.stringify(groups) === before) continue;
      removed.push(`hook ${event}`);
      if (groups.length) out.hooks[event] = groups;
      else delete out.hooks[event];
    }
    if (!Object.keys(out.hooks).length) delete out.hooks;
  }

  if (isObj(out.statusLine) && OUR_STATUSLINE.test(String(out.statusLine.command || ''))) {
    delete out.statusLine;
    removed.push('statusLine');
  }

  if (!keepPlugin) {
    if (isObj(out.enabledPlugins) && PLUGIN_ID in out.enabledPlugins) {
      delete out.enabledPlugins[PLUGIN_ID];
      removed.push(`enabledPlugins.${PLUGIN_ID}`);
      if (!Object.keys(out.enabledPlugins).length) delete out.enabledPlugins;
    }
    if (isObj(out.extraKnownMarketplaces) && 'caveman' in out.extraKnownMarketplaces) {
      delete out.extraKnownMarketplaces.caveman;
      removed.push('extraKnownMarketplaces.caveman');
      if (!Object.keys(out.extraKnownMarketplaces).length) delete out.extraKnownMarketplaces;
    }
  }
  return { cfg: out, removed };
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!isObj(v)) throw new Error('top level is not an object');
    return v;
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}). Fix or remove it, then re-run.`);
  }
}

// Always writes <file>.bak. With `archive`, also keeps a one-time <file>.<archive>.bak
// that later runs never overwrite (used for the pre-v2 settings).
function writeSettings(file, cfg, archive = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = '';
  if (fs.existsSync(file)) {
    backup = `${file}.bak`;
    fs.copyFileSync(file, backup);
    if (archive) {
      if (!/^[a-z0-9.-]+$/.test(archive)) throw new Error(`Bad --archive name: ${archive}`);
      const keep = `${file}.${archive}.bak`;
      if (!fs.existsSync(keep)) { fs.copyFileSync(file, keep); console.log(`Original settings kept in ${keep}`); }
    }
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return backup;
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const args = { cmd, flags: {} };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    if (key === 'keep-plugin') args.flags[key] = true;
    else {
      if (i + 1 >= rest.length) throw new Error(`Missing value for ${a}`);
      args.flags[key] = rest[++i];
    }
  }
  return args;
}

function main(argv) {
  const { cmd, flags } = parseArgs(argv);
  const file = flags.settings;
  if (!file) throw new Error('--settings FILE is required');

  if (cmd === 'show') {
    const cfg = readSettings(file);
    if (isObj(cfg.statusLine) && cfg.statusLine.command) console.log(cfg.statusLine.command);
    return;
  }
  if (cmd === 'status') { console.log(statuslineStatus(readSettings(file))); return; }
  if (cmd === 'env') { console.log(extractEnv(readSettings(file))); return; }
  if (cmd === 'install') {
    if (!flags['hooks-dir']) throw new Error('--hooks-dir DIR is required');
    const cfg = applyInstall(readSettings(file), { hooksDir: flags['hooks-dir'], envPrefix: flags.env || '' });
    const backup = writeSettings(file, cfg, flags.archive || '');
    if (backup) console.log(`Backup saved to ${backup}`);
    console.log(`statusLine: ${cfg.statusLine.command}`);
    return;
  }
  if (cmd === 'uninstall') {
    const { cfg, removed } = applyUninstall(readSettings(file), { keepPlugin: !!flags['keep-plugin'] });
    if (!removed.length) { console.log('Nothing to remove from settings.json'); return; }
    const backup = writeSettings(file, cfg);
    if (backup) console.log(`Backup saved to ${backup}`);
    console.log(`Removed: ${removed.join(', ')}`);
    return;
  }
  throw new Error('Usage: configure-settings.js <install|uninstall|show|status|env> --settings FILE [...]');
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = {
  statuslineStatus, extractEnv, statuslineCommand,
  applyInstall, applyUninstall, readSettings, parseArgs, stripOurs,
};
