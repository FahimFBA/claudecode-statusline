'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const cs = require('../scripts/configure-settings.js');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'configure-settings.js');

const HOOKS = 'C:\\Users\\me\\.claude\\hooks';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sl-settings-'));
const run = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('statuslineCommand: forward slashes, optional env prefix', () => {
  assert.equal(cs.statuslineCommand(HOOKS), 'node "C:/Users/me/.claude/hooks/caveman-statusline.js"');
  assert.equal(
    cs.statuslineCommand('/h', 'SL_THEME=nord SL_ORDER=model,5h'),
    'SL_THEME=nord SL_ORDER=model,5h node "/h/caveman-statusline.js"'
  );
});

test('statuslineCommand: rejects shell metacharacters in env prefix', () => {
  for (const bad of ['SL_THEME=nord; rm -rf ~', 'FOO=1', 'SL_X=$(id)', 'SL_X="a b"', 'SL_X=`id`']) {
    assert.throws(() => cs.statuslineCommand('/h', bad), /unsafe env prefix/, bad);
  }
});

test('applyInstall: fresh config gets hooks, statusLine, plugin and marketplace', () => {
  const cfg = cs.applyInstall({}, { hooksDir: '/h' });
  assert.equal(cfg.hooks.SessionStart[0].hooks[0].command, 'node "/h/caveman-activate.js"');
  assert.equal(cfg.hooks.UserPromptSubmit[0].hooks[0].command, 'node "/h/caveman-mode-tracker.js"');
  assert.deepEqual(cfg.statusLine, { type: 'command', command: 'node "/h/caveman-statusline.js"' });
  assert.equal(cfg.enabledPlugins['caveman@caveman'], true);
  assert.equal(cfg.extraKnownMarketplaces.caveman.source.repo, 'JuliusBrussee/caveman');
});

test('applyInstall: keeps unrelated keys, hooks and plugins', () => {
  const existing = {
    model: 'opus',
    permissions: { allow: ['Bash(ls)'] },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint' }] }],
    },
    enabledPlugins: { 'other@market': true },
    extraKnownMarketplaces: { custom: { source: { source: 'github', repo: 'a/b' } } },
  };
  const cfg = cs.applyInstall(structuredClone(existing), { hooksDir: '/h' });
  assert.equal(cfg.model, 'opus');
  assert.deepEqual(cfg.permissions, existing.permissions);
  assert.deepEqual(cfg.hooks.PreToolUse, existing.hooks.PreToolUse);
  assert.equal(cfg.hooks.SessionStart.length, 2);
  assert.equal(cfg.hooks.SessionStart[0].hooks[0].command, 'echo mine');
  assert.equal(cfg.enabledPlugins['other@market'], true);
  assert.ok(cfg.extraKnownMarketplaces.custom);
});

test('applyInstall is idempotent and upgrades the v1 bash statusline', () => {
  const v1 = {
    statusLine: { type: 'command', command: "SL_CTX=0 bash '/h/caveman-statusline.sh'" },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "/h/caveman-activate.js"' }] }] },
  };
  const once = cs.applyInstall(structuredClone(v1), { hooksDir: '/h', envPrefix: 'SL_THEME=mono' });
  const twice = cs.applyInstall(structuredClone(once), { hooksDir: '/h', envPrefix: 'SL_THEME=mono' });
  assert.deepEqual(once, twice);
  assert.equal(once.hooks.SessionStart.length, 1);
  assert.equal(once.statusLine.command, 'SL_THEME=mono node "/h/caveman-statusline.js"');
});

test('applyUninstall removes only our entries', () => {
  const installed = cs.applyInstall(
    {
      model: 'opus',
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
      enabledPlugins: { 'other@market': true },
    },
    { hooksDir: '/h' }
  );
  const { cfg, removed } = cs.applyUninstall(installed);
  assert.deepEqual(removed.sort(), [
    'enabledPlugins.caveman@caveman', 'extraKnownMarketplaces.caveman', 'hook SessionStart', 'hook UserPromptSubmit', 'statusLine',
  ]);
  assert.deepEqual(cfg, {
    model: 'opus',
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
    enabledPlugins: { 'other@market': true },
  });
});

test('applyUninstall: fully clean result when only ours existed; keepPlugin keeps plugin entries', () => {
  const installed = cs.applyInstall({}, { hooksDir: '/h' });
  assert.deepEqual(cs.applyUninstall(structuredClone(installed)).cfg, {});
  const kept = cs.applyUninstall(structuredClone(installed), { keepPlugin: true }).cfg;
  assert.equal(kept.enabledPlugins['caveman@caveman'], true);
  assert.ok(kept.extraKnownMarketplaces.caveman);
  assert.equal(kept.statusLine, undefined);
});

test('applyUninstall: leaves a foreign statusLine alone and reports nothing', () => {
  const cfg = { statusLine: { type: 'command', command: 'my-own-statusline' } };
  const r = cs.applyUninstall(structuredClone(cfg));
  assert.deepEqual(r.cfg, cfg);
  assert.deepEqual(r.removed, []);
});

test('readSettings: missing / empty / BOM files; invalid JSON throws a helpful error', () => {
  const dir = tmp();
  assert.deepEqual(cs.readSettings(path.join(dir, 'nope.json')), {});
  fs.writeFileSync(path.join(dir, 'empty.json'), '  \n');
  assert.deepEqual(cs.readSettings(path.join(dir, 'empty.json')), {});
  fs.writeFileSync(path.join(dir, 'bom.json'), '\ufeff{"a":1}');
  assert.deepEqual(cs.readSettings(path.join(dir, 'bom.json')), { a: 1 });
  fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope');
  assert.throws(() => cs.readSettings(path.join(dir, 'bad.json')), /not valid JSON/);
});

test('CLI: install writes file + .bak, show prints command, uninstall restores', () => {
  const dir = tmp();
  const file = path.join(dir, 'nested', 'settings.json');
  const original = { model: 'opus' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(original));

  run('install', '--settings', file, '--hooks-dir', path.join(dir, 'hooks'), '--env', 'SL_THEME=nord SL_GIT=0');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.model, 'opus');
  assert.match(after.statusLine.command, /^SL_THEME=nord SL_GIT=0 node ".*caveman-statusline\.js"$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), original);
  assert.equal(run('show', '--settings', file).trim(), after.statusLine.command);

  run('uninstall', '--settings', file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
  assert.match(run('uninstall', '--settings', file), /Nothing to remove/);
});

test('CLI: invalid settings.json is never overwritten', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => run('install', '--settings', file, '--hooks-dir', dir), /not valid JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});

test('CLI: usage errors exit non-zero', () => {
  assert.throws(() => run('bogus', '--settings', 'x'));
  assert.throws(() => run('install'));
  assert.throws(() => run('install', '--settings', path.join(tmp(), 's.json')));
});

// ── upgrade detection ─────────────────────────────────────────────────────────
const sc = (command) => ({ statusLine: { type: 'command', command } });

test('statuslineStatus: none / foreign / v1 / v2', () => {
  assert.equal(cs.statuslineStatus({}), 'none');
  assert.equal(cs.statuslineStatus({ statusLine: {} }), 'none');
  assert.equal(cs.statuslineStatus(sc('my-own-statusline')), 'foreign');
  assert.equal(cs.statuslineStatus(sc("bash '/h/caveman-statusline.sh'")), 'v1');
  assert.equal(cs.statuslineStatus(sc('SL_CTX=0 bash "/h/caveman-statusline.sh"')), 'v1');
  assert.equal(cs.statuslineStatus(sc('node "/h/caveman-statusline.js"')), 'v2');
  assert.equal(cs.statuslineStatus(null), 'none');
});

test('extractEnv: carries over v1 flags and v2 order/theme, drops everything else', () => {
  assert.equal(cs.extractEnv(sc("SL_SAVINGS=0 SL_7D=0 SL_EFFORT=0 bash '/h/caveman-statusline.sh'")), 'SL_SAVINGS=0 SL_7D=0 SL_EFFORT=0');
  assert.equal(cs.extractEnv(sc('SL_ORDER=project,model,5h SL_THEME=nord node "/h/caveman-statusline.js"')), 'SL_ORDER=project,model,5h SL_THEME=nord');
  assert.equal(cs.extractEnv(sc('node "/h/caveman-statusline.js"')), '');
  // unknown / unsafe variables are never carried into the new command
  assert.equal(cs.extractEnv(sc('FOO=1 SL_CTX=0 EVIL=$(id) node "/h/caveman-statusline.js"')), 'SL_CTX=0');
  assert.equal(cs.extractEnv(sc('NO_COLOR=1 CAVEMAN_STATUSLINE_SAVINGS=0 node "/h/caveman-statusline.js"')), 'NO_COLOR=1 CAVEMAN_STATUSLINE_SAVINGS=0');
  // foreign statuslines are not ours to read
  assert.equal(cs.extractEnv(sc('SL_CTX=0 node my-own.js')), '');
  assert.equal(cs.extractEnv({}), '');
});

test('extractEnv output is always accepted by statuslineCommand (round trip)', () => {
  const v1 = sc("SL_CTX=0 SL_ORDER=a,b SL_X=1.5 bash '/h/caveman-statusline.sh'");
  const env = cs.extractEnv(v1);
  assert.doesNotThrow(() => cs.statuslineCommand('/h', env));
  assert.equal(cs.statuslineStatus({ statusLine: { command: cs.statuslineCommand('/h', env) } }), 'v2');
});

test('CLI: status and env commands', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  assert.equal(run('status', '--settings', file).trim(), 'none');
  fs.writeFileSync(file, JSON.stringify(sc("SL_CTX=0 bash '/h/caveman-statusline.sh'")));
  assert.equal(run('status', '--settings', file).trim(), 'v1');
  assert.equal(run('env', '--settings', file).trim(), 'SL_CTX=0');
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => run('status', '--settings', file), /not valid JSON/);
});

test('CLI: --archive keeps a one-time original copy that later runs never overwrite', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  const original = { model: 'opus', marker: 'pre-v2' };
  fs.writeFileSync(file, JSON.stringify(original));

  run('install', '--settings', file, '--hooks-dir', dir, '--archive', 'pre-v2');
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.pre-v2.bak`, 'utf8')), original);

  run('install', '--settings', file, '--hooks-dir', dir, '--archive', 'pre-v2'); // second run
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.pre-v2.bak`, 'utf8')), original, 'archive must not be overwritten');
  assert.notDeepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), original, '.bak is the most recent run');

  assert.throws(() => run('install', '--settings', file, '--hooks-dir', dir, '--archive', '../evil'), /Bad --archive/);
});
