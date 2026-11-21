'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const topVersion = /^## \[(\d+\.\d+\.\d+[^\]]*)\]/m.exec(changelog)[1];

test('version: renderer, package.json and top CHANGELOG entry agree', () => {
  const renderer = require('../hooks/caveman-statusline.js').VERSION;
  assert.equal(renderer, pkg.version);
  assert.equal(topVersion, pkg.version);
});

test('version: --version prints it, and installers can read it from the file', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'hooks', 'caveman-statusline.js'), '--version'], { encoding: 'utf8' });
  assert.equal(out.trim(), pkg.version);
  // install.sh / install.ps1 detect the installed version with this exact pattern
  const src = fs.readFileSync(path.join(root, 'hooks', 'caveman-statusline.js'), 'utf8');
  assert.match(src, /^const VERSION = '[0-9][0-9.]*';/m);
});

test('version: CHANGELOG has a link reference for the current version', () => {
  const link = changelog.split('\n').find((l) => l.startsWith(`[${pkg.version}]: `));
  assert.ok(link && link.includes('https://github.com/'), `no [${pkg.version}]: link reference in CHANGELOG.md`);
});
