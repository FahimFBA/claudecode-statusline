'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sl = require('../hooks/caveman-statusline.js');

const RENDERER = path.join(__dirname, '..', 'hooks', 'caveman-statusline.js');
const NOW = 1_800_000_000;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const noGit = () => null;

// A config dir with no flag files so the caveman / savings segments stay quiet.
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-test-'));
const base = { now: NOW, git: noGit, configDir: emptyDir };

const FULL_INPUT = {
  workspace: { project_dir: '/work/my-project' },
  model: { display_name: 'Claude Opus 5.5' },
  context_window: { used_percentage: 42.4 },
  effort: { level: 'medium' },
  rate_limits: {
    five_hour: { used_percentage: 62, resets_at: NOW + 2 * 3600 + 40 * 60 },
    seven_day: { used_percentage: 41, resets_at: NOW + 3 * 86400 + 7 * 3600 },
  },
  cost: { total_cost_usd: 0.4249, total_duration_ms: 18 * 60000, total_lines_added: 124, total_lines_removed: 37 },
};

// ── formatting ────────────────────────────────────────────────────────────────
test('fillBar clamps and fills proportionally', () => {
  assert.equal(sl.fillBar(0, 8), '░░░░░░░░');
  assert.equal(sl.fillBar(42, 8), '███░░░░░');
  assert.equal(sl.fillBar(100, 8), '████████');
  assert.equal(sl.fillBar(250, 8), '████████');
  assert.equal(sl.fillBar(-5, 8), '░░░░░░░░');
});

test('fmtSpan picks the two most significant units', () => {
  assert.equal(sl.fmtSpan(0), '0m');
  assert.equal(sl.fmtSpan(59), '0m');
  assert.equal(sl.fmtSpan(5 * 60), '5m');
  assert.equal(sl.fmtSpan(3600 + 22 * 60), '1h 22m');
  assert.equal(sl.fmtSpan(3 * 86400 + 7 * 3600), '3d 7h');
  assert.equal(sl.fmtSpan(-100), '0m');
});

test('fmtReset accepts seconds and milliseconds, empty when unknown', () => {
  assert.equal(sl.fmtReset(NOW + 3600, NOW), '1h 0m');
  assert.equal(sl.fmtReset((NOW + 3600) * 1000, NOW), '1h 0m');
  assert.equal(sl.fmtReset(NOW - 10, NOW), '0m');
  assert.equal(sl.fmtReset(undefined, NOW), '');
  assert.equal(sl.fmtReset(0, NOW), '');
});

test('fmtDuration', () => {
  assert.equal(sl.fmtDuration(0), '0s');
  assert.equal(sl.fmtDuration(45_000), '45s');
  assert.equal(sl.fmtDuration(18 * 60_000), '18m');
  assert.equal(sl.fmtDuration(65 * 60_000), '1h 5m');
  assert.equal(sl.fmtDuration(-1), '');
  assert.equal(sl.fmtDuration('abc'), '');
});

test('fmtCost', () => {
  assert.equal(sl.fmtCost(0), '$0.00');
  assert.equal(sl.fmtCost(0.4249), '$0.42');
  assert.equal(sl.fmtCost(12.345), '$12.35');
  assert.equal(sl.fmtCost(-1), '');
  assert.equal(sl.fmtCost(undefined), '');
});

// ── burn rate ─────────────────────────────────────────────────────────────────
test('burnEta: warns when limit will be hit before reset', () => {
  // 5h window, 2h20m in (8400s elapsed), 62% used -> 38% left at 62/8400 per s
  const eta = sl.burnEta(62, NOW + 9600, 18000, NOW);
  assert.equal(eta, Math.round((38 * 8400) / 62));
  assert.ok(eta < 9600);
});

test('burnEta: null when pace is safe, too early, full, or malformed', () => {
  assert.equal(sl.burnEta(10, NOW + 9600, 18000, NOW), null);   // slow burn
  assert.equal(sl.burnEta(30, NOW + 17900, 18000, NOW), null);  // <5% of window elapsed
  assert.equal(sl.burnEta(100, NOW + 9600, 18000, NOW), null);  // already full
  assert.equal(sl.burnEta(0, NOW + 9600, 18000, NOW), null);    // nothing used
  assert.equal(sl.burnEta(50, NOW - 5, 18000, NOW), null);      // reset in the past
  assert.equal(sl.burnEta(50, NOW + 999999, 18000, NOW), null); // reset beyond window
  assert.equal(sl.burnEta(50, undefined, 18000, NOW), null);
});

// ── git ───────────────────────────────────────────────────────────────────────
test('parseGitStatus reads branch, ahead/behind and file counts', () => {
  const out = [
    '# branch.oid 0123456789abcdef',
    '# branch.head feature/x',
    '# branch.upstream origin/feature/x',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb src/a.js',
    '1 M. N... 100644 100644 100644 aaa bbb src/b.js',
    '2 R. N... 100644 100644 100644 aaa bbb R100 new.js\told.js',
    'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.js',
    '? untracked.txt',
    '? other.txt',
  ].join('\n');
  assert.deepEqual(sl.parseGitStatus(out), {
    branch: 'feature/x', dirty: 3, untracked: 2, conflicts: 1, ahead: 2, behind: 1,
  });
});

test('parseGitStatus: detached HEAD shows short oid, no upstream is fine', () => {
  const out = '# branch.oid 0123456789abcdef\n# branch.head (detached)\n';
  const r = sl.parseGitStatus(out);
  assert.equal(r.branch, '@0123456');
  assert.equal(r.ahead, 0);
  assert.equal(sl.parseGitStatus('# branch.oid (initial)\n# branch.head (detached)\n').branch, 'detached');
});

// ── render ────────────────────────────────────────────────────────────────────
test('render: SL_ORDER=all shows every segment with correct values', () => {
  const git = () => ({ branch: 'main', dirty: 3, untracked: 2, conflicts: 0, ahead: 1, behind: 0 });
  const out = strip(sl.render(FULL_INPUT, { ...base, git, env: { SL_ORDER: 'all' } }));
  assert.match(out, /📁 my-project 🌿 main ✎3 \?2 ↑1/);
  assert.match(out, /🤖 Claude Opus 5.5/);
  assert.match(out, /CTX ███░░░░░ 42%/);
  assert.match(out, /⚡ ▄ MEDIUM/);
  assert.match(out, /5h ████░░░░ 62% used 38% rem ↺ 2h 40m/);
  assert.match(out, /7d ███░░░░░ 41% used 59% rem ↺ 3d 7h/);
  assert.match(out, /🔥 5h full in ~/);
  assert.doesNotMatch(out, /🔥 7d/);
  assert.match(out, /💰 \$0\.42/);
  assert.match(out, /⏱ 18m/);
  assert.match(out, /\+124 -37/);
});

test('render: empty input renders only the project fallback, never throws', () => {
  const env = { SL_PROJECT: '0' };
  assert.equal(sl.render({}, { ...base, env }), '');
  assert.equal(sl.render(null, { ...base, env }), '');
  assert.match(strip(sl.render({}, { ...base, env: {} })), /^📁 /); // falls back to cwd name
});

test('render: SL_<SEGMENT>=0 hides that segment only', () => {
  const out = strip(sl.render(FULL_INPUT, { ...base, env: { SL_ORDER: 'all', SL_CTX: '0', SL_COST: '0', SL_BURN: '0' } }));
  assert.doesNotMatch(out, /CTX/);
  assert.doesNotMatch(out, /\$0\.42/);
  assert.doesNotMatch(out, /🔥/);
  assert.match(out, /🤖/);
});

test('render: default is the compact classic line (v1 segments, no git markers, no extras)', () => {
  const git = () => ({ branch: 'main', dirty: 3, untracked: 2, conflicts: 0, ahead: 1, behind: 0 });
  const out = strip(sl.render(FULL_INPUT, { ...base, git, env: {} }));
  assert.equal(
    out,
    '📁 my-project 🌿 main │ 🤖 Claude Opus 5.5 │ CTX ███░░░░░ 42% │ ⚡ ▄ MEDIUM │ ' +
      '5h ████░░░░ 62% used 38% rem ↺ 2h 40m │ 7d ███░░░░░ 41% used 59% rem ↺ 3d 7h'
  );
  assert.deepEqual(sl.DEFAULT_ORDER, ['caveman', 'project', 'model', 'ctx', 'effort', '5h', '7d', 'savings']);
  assert.deepEqual(sl.OPT_IN, ['burn', 'cost', 'time', 'lines']);
});

test('render: classic default calls git without status (cheap branch lookup)', () => {
  const calls = [];
  const git = (dir, withStatus) => { calls.push(withStatus); return { branch: 'main' }; };
  sl.render(FULL_INPUT, { ...base, git, env: {} });
  assert.deepEqual(calls, [false]);
});

test('render: opt-in extras switch on with SL_<SEGMENT>=1 / SL_GIT=1 without SL_ORDER', () => {
  const git = () => ({ branch: 'main', dirty: 3, untracked: 0, conflicts: 0, ahead: 0, behind: 0 });
  const out = strip(sl.render(FULL_INPUT, { ...base, git, env: { SL_COST: '1', SL_LINES: '1', SL_GIT: '1' } }));
  assert.match(out, /🌿 main ✎3/);
  assert.ok(out.endsWith('↺ 3d 7h │ 💰 $0.42 │ +124 -37'), out);
  assert.doesNotMatch(out, /⏱|🔥/);
  // =0 still wins over =1 / all
  assert.doesNotMatch(strip(sl.render(FULL_INPUT, { ...base, env: { SL_ORDER: 'all', SL_COST: '0' } })), /💰/);
  assert.doesNotMatch(strip(sl.render(FULL_INPUT, { ...base, git, env: { SL_ORDER: 'all', SL_GIT: '0' } })), /✎/);
});

test('resolveConfig: all / explicit list / git token / default', () => {
  assert.deepEqual(sl.resolveConfig({ SL_ORDER: 'all' }), { order: sl.ALL_ORDER, git: true });
  assert.deepEqual(sl.resolveConfig({ SL_ORDER: 'ALL' }), { order: sl.ALL_ORDER, git: true });
  assert.deepEqual(sl.resolveConfig({ SL_ORDER: 'model,git' }), { order: ['model'], git: true });
  assert.deepEqual(sl.resolveConfig({ SL_ORDER: 'model' }), { order: ['model'], git: false });
  assert.deepEqual(sl.resolveConfig({ SL_ORDER: 'git' }), { order: sl.DEFAULT_ORDER, git: true });
  assert.deepEqual(sl.resolveConfig({}), { order: sl.DEFAULT_ORDER, git: false });
  assert.equal(sl.ALL_ORDER.length, 12);
});

test('render: SL_ORDER selects and orders segments', () => {
  const out = strip(sl.render(FULL_INPUT, { ...base, env: { SL_ORDER: 'cost,model,7d' } }));
  assert.equal(out, '💰 $0.42 │ 🤖 Claude Opus 5.5 │ 7d ███░░░░░ 41% used 59% rem ↺ 3d 7h');
});

test('render: SL_ORDER ignores unknown names and duplicates; all-invalid falls back to default', () => {
  assert.deepEqual(sl.parseOrder('model, nope ,model,5H'), ['model', '5h']);
  assert.deepEqual(sl.resolveOrder({ SL_ORDER: 'nope,zzz' }), sl.DEFAULT_ORDER);
  assert.deepEqual(sl.resolveOrder({}), sl.DEFAULT_ORDER);
});

test('render: SL_ORDER respects SL_<SEGMENT>=0', () => {
  const out = strip(sl.render(FULL_INPUT, { ...base, env: { SL_ORDER: 'model,cost', SL_COST: '0' } }));
  assert.equal(out, '🤖 Claude Opus 5.5');
});

test('render: SL_GIT=0 keeps branch but drops status markers', () => {
  const calls = [];
  const git = (dir, withStatus) => {
    calls.push(withStatus);
    return { branch: 'main', dirty: 3, untracked: 2, conflicts: 0, ahead: 1, behind: 0 };
  };
  const out = strip(sl.render(FULL_INPUT, { ...base, git, env: { SL_ORDER: 'project,git', SL_GIT: '0' } }));
  assert.equal(out, '📁 my-project 🌿 main');
  assert.deepEqual(calls, [false]);
});

test('render: git conflicts, behind and detached branch', () => {
  const git = () => ({ branch: '@abc1234', dirty: 0, untracked: 0, conflicts: 2, ahead: 0, behind: 4 });
  const out = strip(sl.render(FULL_INPUT, { ...base, git, env: { SL_ORDER: 'project,git' } }));
  assert.equal(out, '📁 my-project 🌿 @abc1234 ✖2 ↓4');
});

test('render: lines segment hidden when nothing changed; cost shows $0.00', () => {
  const input = { cost: { total_cost_usd: 0, total_duration_ms: 0, total_lines_added: 0, total_lines_removed: 0 } };
  const out = strip(sl.render(input, { ...base, env: { SL_ORDER: 'cost,time,lines' } }));
  assert.equal(out, '💰 $0.00 │ ⏱ 0s');
});

test('render: burn segment lists both windows when both will run out', () => {
  const input = {
    rate_limits: {
      five_hour: { used_percentage: 80, resets_at: NOW + 9000 },     // 9000s elapsed
      seven_day: { used_percentage: 90, resets_at: NOW + 302400 },   // half the week gone
    },
  };
  const out = strip(sl.render(input, { ...base, env: { SL_ORDER: 'burn' } }));
  assert.match(out, /🔥 5h full in ~\d+m 🔥 7d full in ~/);
});

test('render: unknown effort level does not crash', () => {
  const out = strip(sl.render({ effort: { level: 'turbo' } }, { ...base, env: { SL_PROJECT: '0' } }));
  assert.equal(out, '⚡ ? TURBO');
});

test('render: caveman badge and savings from override and from files', () => {
  assert.equal(strip(sl.render({}, { ...base, env: { SL_ORDER: 'caveman' }, caveman: 'full' })), '[🪨 CAVEMAN]');
  assert.equal(strip(sl.render({}, { ...base, env: { SL_ORDER: 'caveman' }, caveman: 'ultra' })), '[🪨 CAVEMAN:ULTRA]');
  assert.equal(strip(sl.render({}, { ...base, env: { SL_ORDER: 'caveman' }, caveman: 'bogus' })), '');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-flag-'));
  fs.writeFileSync(path.join(dir, '.caveman-active'), 'lite\n');
  fs.writeFileSync(path.join(dir, '.caveman-statusline-suffix'), '🪨 ~42% saved\u0007');
  const env = { SL_ORDER: 'caveman,savings' };
  assert.equal(strip(sl.render({}, { now: NOW, git: noGit, configDir: dir, env })), '[🪨 CAVEMAN:LITE] │ 🪨 ~42% saved');
  assert.equal(
    strip(sl.render({}, { now: NOW, git: noGit, configDir: dir, env: { ...env, CAVEMAN_STATUSLINE_SAVINGS: '0' } })),
    '[🪨 CAVEMAN:LITE]'
  );
});

// ── themes / color ────────────────────────────────────────────────────────────
test('themes: every theme defines every palette key', () => {
  const keys = Object.keys(sl.THEMES.default).sort();
  for (const [name, theme] of Object.entries(sl.THEMES)) {
    assert.deepEqual(Object.keys(theme).sort(), keys, `theme ${name} keys`);
    assert.deepEqual(Object.keys(theme.effort).sort(), Object.keys(sl.THEMES.default.effort).sort(), `theme ${name} effort`);
  }
});

test('themes: SL_THEME changes colors, unknown theme falls back to default', () => {
  const input = { model: { display_name: 'M' } };
  const def = sl.render(input, { ...base, env: {} });
  const nord = sl.render(input, { ...base, env: { SL_THEME: 'nord' } });
  const bogus = sl.render(input, { ...base, env: { SL_THEME: 'bogus' } });
  assert.notEqual(def, nord);
  assert.equal(def, bogus);
  assert.equal(strip(def), strip(nord));
  assert.ok(def.includes('\x1b[38;5;183m'));
  assert.ok(nord.includes(`\x1b[38;5;${sl.THEMES.nord.model}m`));
});

test('NO_COLOR disables all escape codes; empty NO_COLOR does not', () => {
  assert.equal(sl.render(FULL_INPUT, { ...base, env: { NO_COLOR: '1' } }).includes('\x1b'), false);
  assert.equal(sl.render(FULL_INPUT, { ...base, env: { NO_COLOR: '' } }).includes('\x1b'), true);
});

test('severity colors follow thresholds', () => {
  const r = (pct, env = {}) => sl.render({ context_window: { used_percentage: pct } }, { ...base, env });
  const t = sl.THEMES.default;
  assert.ok(r(10).includes(`38;5;${t.ok}m`));
  assert.ok(r(60).includes(`38;5;${t.warn}m`));
  assert.ok(r(90).includes(`38;5;${t.crit}m`));
});

// ── CLI ───────────────────────────────────────────────────────────────────────
test('CLI: reads JSON from stdin, tolerates BOM and garbage', () => {
  const env = { ...process.env, SL_ORDER: 'model', NO_COLOR: '1' };
  const run = (input) => execFileSync(process.execPath, [RENDERER], { input, env, encoding: 'utf8' });
  assert.equal(run('{"model":{"display_name":"X"}}'), '🤖 X');
  assert.equal(run('﻿{"model":{"display_name":"Y"}}'), '🤖 Y');
  assert.equal(run('not json'), '');
  assert.equal(run(''), '');
});

test('CLI: --demo prints a full sample line', () => {
  const env = { ...process.env, NO_COLOR: '1', SL_ORDER: 'all' };
  const out = execFileSync(process.execPath, [RENDERER, '--demo'], { env, encoding: 'utf8' });
  assert.match(out, /\[🪨 CAVEMAN\]/);
  assert.match(out, /🌿 main ✎3 \?2 ↑1/);
  assert.match(out, /🔥 5h full in/);
  assert.match(out, /💰 \$0\.42/);
  assert.match(out, /\+124 -37/);
});

test('real git: status on a temp repo reports branch and dirty files', (t) => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { return t.skip('git not installed'); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-git-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q', '-b', 'trunk');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(dir, 'a.txt'), '2');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'x');
  assert.deepEqual(
    sl.parseGitStatus(execFileSync('git', ['-C', dir, 'status', '--porcelain=v2', '--branch'], { encoding: 'utf8' })),
    { branch: 'trunk', dirty: 1, untracked: 1, conflicts: 0, ahead: 0, behind: 0 }
  );
  const out = strip(sl.render({ workspace: { project_dir: dir } }, { now: NOW, env: { SL_ORDER: 'project,git' } }));
  assert.match(out, new RegExp(`📁 ${path.basename(dir)} 🌿 trunk ✎1 \\?1$`));
});
