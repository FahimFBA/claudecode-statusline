#!/usr/bin/env node
// Regenerates the README / website SVGs from the real theme palette in
// hooks/caveman-statusline.js, so docs never drift from the renderer.
//
//   node scripts/gen-images.js
//
// Writes: img/statusline.svg (classic default), img/statusline-all.svg (Install all),
//         img/themes.svg, img/installer-menu.svg,
//         img/seg-git.svg, img/seg-burn.svg, img/seg-session.svg

'use strict';
const fs = require('fs');
const path = require('path');
const { THEMES } = require('../hooks/caveman-statusline.js');

const OUT = path.join(__dirname, '..', 'img');
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace";
const BG = '#07090b', FG = '#dfe4ea', DIM = '#2a313a', SEP = '#4a5360', MUTE = '#8b95a3';
const CHAR_W = 7.9;

// xterm-256 color number -> #rrggbb (only the 6x6x6 cube and gray ramp are used)
function hex(n) {
  if (typeof n === 'string') return n;
  if (n >= 232) { const v = 8 + (n - 232) * 10; return '#' + [v, v, v].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  const lv = [0, 95, 135, 175, 215, 255];
  const i = n - 16;
  return '#' + [lv[Math.floor(i / 36)], lv[Math.floor(i / 6) % 6], lv[i % 6]].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const tspan = (text, fill) => (fill ? `<tspan fill="${fill}">${esc(text)}</tspan>` : esc(text));
const bar = (pct, fill) => {
  const f = Math.floor((pct * 8) / 100);
  return tspan('█'.repeat(f), fill) + tspan('█'.repeat(8 - f), DIM);
};

// Segment builders for a theme -> { svg: string, len: visible char count }
function seg(parts) {
  return { svg: parts.map(([t, f]) => tspan(t, f)).join(''), len: parts.reduce((n, [t]) => n + [...t].length, 0) };
}
function segments(th) {
  const H = hex;
  const ok = H(th.ok), warn = H(th.warn);
  const bars = (pct, f) => ({ svg: bar(pct, f), len: 8 });
  const join = (...xs) => ({ svg: xs.map((x) => x.svg).join(''), len: xs.reduce((n, x) => n + x.len, 0) });
  const txt = (t, f) => seg([[t, f]]);
  return {
    caveman: txt('[🪨 CAVEMAN]', H(th.caveman)),
    projectPlain: seg([['📁 my-project', H(th.project)], [' 🌿 main', H(th.branch)]]),
    project: seg([['📁 my-project', H(th.project)], [' 🌿 main', H(th.branch)], [' ', null], ['✎3', H(th.dirty)], [' ', null], ['?2', H(th.untracked)], [' ', null], ['↑1', H(th.ahead)]]),
    model: txt('🤖 Claude Opus 5.5', H(th.model)),
    ctx: ctxSeg(th),
    effort: txt('⚡ ▄ MEDIUM', H(th.effort.medium)),
    h5: join(txt('5h ', warn), bars(62, warn), txt(' 62% used', warn), txt(' ', null), txt('38% rem', warn), txt(' ↺ 2h 40m', null)),
    d7: join(txt('7d ', ok), bars(41, ok), txt(' 41% used', ok), txt(' ', null), txt('59% rem', ok), txt(' ↺ 3d 7h', null)),
    burn: txt('🔥 5h full in ~1h 25m', warn),
    cost: txt('💰 $0.42', H(th.cost)),
    time: txt('⏱ 18m', H(th.time)),
    lines: seg([['+124', H(th.add)], [' ', null], ['-37', H(th.del)]]),
    savings: txt('🪨 ~42% tokens saved', H(th.savings)),
  };
}
// CTX label shares its bar's color (matches the renderer)
function ctxSeg(th) {
  const ok = hex(th.ok);
  return { svg: tspan('CTX ', ok) + bar(42, ok) + tspan(' 42%', ok), len: 4 + 8 + 4 };
}

function row(th, keys, x, y) {
  const s = segments(th);
  const sep = tspan(' │ ', hex(th.sep));
  const parts = keys.map((k) => s[k]);
  const svg = parts.map((p) => p.svg).join(sep);
  const len = parts.reduce((n, p) => n + p.len, 0) + 3 * (parts.length - 1);
  return { text: `<text x="${x}" y="${y}" font-family="${FONT}" font-size="13" fill="${FG}" xml:space="preserve">${svg}</text>`, len };
}

function write(name, content) {
  fs.writeFileSync(path.join(OUT, name), content);
  console.log('wrote img/' + name);
}

// ── statusline.svg: the classic default, one row ─────────────────────────────
{
  const r = row(THEMES.default, ['caveman', 'projectPlain', 'model', 'ctx', 'effort', 'h5', 'd7'], 16, 27);
  const w = Math.ceil(r.len * CHAR_W + 40);
  write('statusline.svg',
`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="44" viewBox="0 0 ${w} 44" role="img" aria-label="Default statusline: caveman badge, project and branch, model, context bar, effort, 5-hour and weekly limits">
  <rect width="${w}" height="44" rx="8" fill="${BG}"/>
  ${r.text}
</svg>
`);
}

// ── statusline-all.svg: Install all (two rows; the real line is a single row) ─
{
  const r1 = row(THEMES.default, ['caveman', 'project', 'model', 'ctx', 'effort'], 16, 27);
  const r2 = row(THEMES.default, ['h5', 'd7', 'burn', 'cost', 'time', 'lines', 'savings'], 16, 53);
  const w = Math.ceil(Math.max(r1.len, r2.len) * CHAR_W + 40);
  write('statusline-all.svg',
`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="68" viewBox="0 0 ${w} 68" role="img" aria-label="Install-all statusline: everything in the default plus git status, burn-rate warning, cost, time, lines changed and token savings">
  <rect width="${w}" height="68" rx="8" fill="${BG}"/>
  ${r1.text}
  ${r2.text}
</svg>
`);
}

// ── themes.svg ───────────────────────────────────────────────────────────────
{
  const names = ['default', 'nord', 'gruvbox', 'light', 'mono'];
  const keys = ['project', 'model', 'ctx', 'h5'];
  const rows = names.map((n, i) => {
    const bg = n === 'light' ? '#f4f1ea' : BG;
    const y = 30 + i * 36;
    const r = row(THEMES[n], keys, 110, y);
    const labelFill = n === 'light' ? '#6b655c' : MUTE;
    return { n, bg, y, r, labelFill };
  });
  const w = Math.ceil(Math.max(...rows.map((x) => x.r.len)) * CHAR_W + 130);
  const h = 20 + names.length * 36;
  const body = rows.map((x) =>
    `<rect x="0" y="${x.y - 22}" width="${w}" height="36" fill="${x.bg}"/>\n  <text x="16" y="${x.y}" font-family="${FONT}" font-size="13" font-weight="bold" fill="${x.labelFill}">${x.n}</text>\n  ${x.r.text.replace(`fill="${FG}"`, `fill="${x.n === 'light' ? '#1d1b18' : FG}"`)}`
  ).join('\n  ');
  write('themes.svg',
`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="The five color themes: default, nord, gruvbox, light and mono">
  <rect width="${w}" height="${h}" rx="8" fill="${BG}"/>
  ${body}
</svg>
`);
}

// ── small single-segment images ──────────────────────────────────────────────
function small(name, label, svg, len) {
  const w = Math.ceil(len * CHAR_W + 24);
  write(name,
`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28" viewBox="0 0 ${w} 28" role="img" aria-label="${esc(label)}">
  <rect width="${w}" height="28" rx="6" fill="${BG}"/>
  <text x="10" y="18" font-family="${FONT}" font-size="13" fill="${FG}" xml:space="preserve">${svg}</text>
</svg>
`);
}
{
  const t = THEMES.default;
  const s = segments(t);
  small('seg-git.svg', 'Project, git branch, 3 changed files, 2 untracked, 1 commit ahead', s.project.svg, s.project.len);
  small('seg-burn.svg', 'Burn-rate warning: 5-hour limit full in about 1 hour 25 minutes', s.burn.svg, s.burn.len);
  const sep = tspan(' │ ', hex(t.sep));
  small('seg-session.svg', 'Session cost $0.42, time 18 minutes, 124 lines added and 37 removed',
    [s.cost, s.time, s.lines].map((x) => x.svg).join(sep), s.cost.len + s.time.len + s.lines.len + 6);
}

// ── installer-menu.svg ───────────────────────────────────────────────────────
{
  const t = THEMES.default;
  const s = segments(t);
  const items = [
    ['1)', 'Caveman badge    ', tspan('🪨 CAVEMAN:FULL', hex(t.caveman))],
    ['2)', 'Project + branch ', tspan('📁 my-project 🌿 main', null)],
    ['3)', 'Model name       ', '🤖 Claude Opus 5.5'],
    ['4)', 'Context window   ', s.ctx.svg],
    ['5)', 'Effort level     ', '⚡ ▄ MEDIUM'],
    ['6)', 'Hourly limit (5h)', s.h5.svg],
    ['7)', 'Weekly limit (7d)', s.d7.svg],
    ['8)', 'Token savings    ', tspan('🪨 ~42% tokens saved', hex(t.savings))],
    ['9)', 'Burn-rate warning', s.burn.svg],
    ['10)', 'Session cost     ', s.cost.svg],
    ['11)', 'Session time     ', s.time.svg],
    ['12)', 'Lines changed    ', s.lines.svg],
    ['13)', 'Git status       ', [tspan('✎3', hex(t.dirty)), tspan('?2', hex(t.untracked)), tspan('↑1', hex(t.ahead))].join(' ') + tspan('  (extends 2)', MUTE)],
  ];
  const lines = items.map(([n, label, ex], i) =>
    `<text x="16" y="${68 + i * 22}" xml:space="preserve">${n.length === 2 ? ' ' : ''} <tspan font-weight="bold">${n}</tspan> ${label}  ${ex}</text>`
  ).join('\n    ');
  const promptY = 68 + items.length * 22 + 18;
  const h = promptY + 24;
  write('installer-menu.svg',
`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${h}" viewBox="0 0 760 ${h}" role="img" aria-label="Installer component menu with 13 components">
  <rect width="760" height="${h}" rx="8" fill="${BG}"/>
  <g font-family="${FONT}" font-size="13" fill="${FG}">
    <text x="16" y="28" font-weight="bold">Available components:</text>
    ${lines}
    <text x="16" y="${promptY}" xml:space="preserve">Numbers in the order to show them (e.g. 2 3 4 6 7 10 13), 'all', or Enter for classic:</text>
  </g>
</svg>
`);
}
