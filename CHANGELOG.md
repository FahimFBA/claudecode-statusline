# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

Publishing a release: add a new `## [x.y.z] - YYYY-MM-DD` section at the top and push to `main`.
The release workflow tags `vx.y.z` and creates a GitHub release from that section.

## [2.0.0] - 2026-11-22

Major release: one Node renderer on every platform, new statusline extras (git status, burn rate, cost, time, lines), themes, custom segment order, an **Install all** option, an uninstaller, a safe update path and a test suite. **The default stays the compact classic line**; everything new is opt-in. **Existing users: run the installer's Update mode** (see "Upgrading from 1.x" below); it keeps your current setup.

### Added
- **Install all**: new installer choice (`3) Install all`, or `SL_ORDER=all`) that turns on every segment plus git status. `1) Default` installs the compact classic line (exactly what v1 showed); in Custom, type `all` for everything or press Enter for the classic set.
- **Update mode** in both installers (`4) Update`, or `./install.sh --update` / `install.ps1 -Update` for no prompts). It detects the installed version and carries your `SL_*` settings over, leaves the v2 extras off unless you opt in, keeps all other `settings.json` content, is idempotent, and writes a one-time `settings.json.pre-v2.bak` next to the usual `settings.json.bak` so rollback is always possible.
- `node hooks/caveman-statusline.js --version`; the installers print `Installed: vX → this version: vY`.
- **Session cost** segment `💰 $0.42` (`SL_COST`), from `cost.total_cost_usd`. Opt-in. For subscription plans this is the API-equivalent estimate Claude Code reports, not a bill.
- **Session time** segment `⏱ 18m` (`SL_TIME`), from `cost.total_duration_ms`. Opt-in.
- **Lines changed** segment `+124 -37` (`SL_LINES`), from `cost.total_lines_added` / `total_lines_removed`. Opt-in.
- **Git status** next to the branch (opt-in, `git` in `SL_ORDER`, `SL_GIT=1` or Install all): `✎3` changed, `?2` untracked, `↑1` ahead, `↓2` behind, `✖1` conflicts, `@abc1234` on detached HEAD. A single `git` call (`status --porcelain=v2 --branch`, run with `--no-optional-locks` so it never fights your editor for the index lock). Without it the renderer only reads the branch name, as in v1. `SL_GIT=0` always turns it off.
- **Burn-rate warning** `🔥 5h full in ~1h 25m` (`SL_BURN`). Opt-in. Extrapolates the current 5h / 7d usage over the elapsed part of the window and appears only when you are on pace to hit the limit before it resets.
- **Color themes** via `SL_THEME`: `default`, `nord`, `gruvbox`, `light`, `mono`. `NO_COLOR` is honoured.
- **Custom segment order** via `SL_ORDER` (for example `SL_ORDER=model,ctx,5h,7d,cost`). Lists exactly which segments to show and in which order; `SL_ORDER=all` means everything and a `git` entry adds git status markers. Without `SL_ORDER`, single extras switch on with `SL_BURN=1`, `SL_COST=1`, `SL_TIME=1`, `SL_LINES=1`, `SL_GIT=1`; `SL_<SEGMENT>=0` always hides.
- **Installer**: custom mode takes numbers in display order, adds the new components (9-13), asks for a theme, and prints a live preview before writing anything.
- **Uninstallers**: `uninstall.sh` and `uninstall.ps1` remove the hook files and only the settings.json entries this project added (other hooks, plugins and keys are kept; `.bak` written first). `--keep-plugin` / `-KeepPlugin` leaves the Caveman plugin entries alone.
- `node hooks/caveman-statusline.js --demo` (or `npm run demo`) previews the statusline with any `SL_*` combination, no Claude Code needed.
- Test suite (`npm test`, Node's built-in runner, no dependencies) covering formatting, burn-rate maths, git parsing, rendering, themes, ordering and settings merge / uninstall; GitHub Actions CI on Linux, macOS and Windows with Node 18, 20 and 22, plus installer round-trip and script syntax checks, and a job that installs the real `v1.0.1` tag and upgrades it with `--update`. A test also keeps the renderer, `package.json` and top changelog version in sync. Releases now run the tests first.
- `scripts/configure-settings.js`: one shared settings.json editor used by all four installer scripts. `scripts/gen-images.js` regenerates the README SVGs from the real theme palette.

### Changed
- **BREAKING:** the bash + `jq` renderer (`hooks/caveman-statusline.sh`) is removed. `hooks/caveman-statusline.js` is the only renderer on macOS, Linux and Windows; bash and `jq` are no longer needed, only Node.js 18 or newer. The installers delete a stale `caveman-statusline.sh` from `~/.claude/hooks/` and rewrite the `statusLine` command to use Node.
- **BREAKING:** custom install now writes `SL_ORDER=...` (the segments you picked, in the order you typed them) instead of a string of `SL_X=0` flags. The `SL_<SEGMENT>=0` switches still work and can be combined with `SL_ORDER`.
- The settings.json merge no longer needs `python3`, `jq` or PowerShell's JSON round trip. It runs through Node, keeps every unrelated key, and replaces only this project's own hook entries instead of overwriting your whole `SessionStart` / `UserPromptSubmit` lists. Re-running the installer is idempotent. An invalid settings.json is reported and left untouched.
- Hook commands now use forward slashes on every platform.
- `settings.template.json` matches the Node renderer and no longer sets `theme`.
- `caveman-activate.js` now points its "statusline not configured" hint at the Node renderer.

### Fixed
- Re-running either installer could replace other hooks you had configured for `SessionStart` / `UserPromptSubmit`.
- Settings written by older Windows PowerShell 5.1 installs could carry a UTF-8 BOM; it is now stripped on read and never written.

### Upgrading from 1.x
1. `git pull` in your clone, then run `./install.sh --update` (macOS / Linux) or `powershell -ExecutionPolicy Bypass -File install.ps1 -Update` (Windows). Or run the installer without the flag and pick **4) Update**, which is the default when an install is found.
2. Restart Claude Code.

Update mode keeps your current `SL_*` choices (hidden segments, `SL_ORDER`, `SL_THEME`) and all other settings, so the line looks the same as before. The v2 extras (burn rate, cost, time, lines, git status) are off by default, so nothing visible changes unless you answer `y` when asked. Your original settings are saved once to `settings.json.pre-v2.bak`, and every run also writes `settings.json.bak`. Full details and rollback steps are in the README under "Updating".

Things to know:
- A fresh **Default** install is the compact classic line; **Install all** (or `SL_ORDER=all`) is the long one. If that wraps in your terminal, use Custom or trim `SL_ORDER`.
- Anything of yours that called `caveman-statusline.sh` directly must switch to `node caveman-statusline.js`.
- The 1.x installers overwrote your own `SessionStart` / `UserPromptSubmit` hooks; v2 no longer does, but cannot restore ones 1.x already removed.

## [1.0.1] - 2026-11-10

### Fixed
- Windows: statusline icons, model, context bar and 5h/7d quota (used/remaining/reset) were missing. Cause: renderer needed `bash` + `jq`, which Windows lacks by default.
- Windows: uninstall docs now give a PowerShell command (`rm a b` bash-style call fails in PowerShell with "A positional parameter cannot be found").
- Added Node renderer `hooks/caveman-statusline.js` (no bash/jq dependency); `install.ps1` now uses it and no longer requires bash.

## [1.0.0] - 2026-10-14

### Added
- Decorated Claude Code statusline: project + git branch, model name, context window bar, effort level, 5h and 7d rate limit bars with remaining % and reset countdown.
- Color-coded severity for context and rate limit usage (green, yellow, red).
- Caveman mode integration: statusline badge, SessionStart and UserPromptSubmit hooks, `/caveman-stats` token usage and savings.
- Interactive installers for macOS / Linux (`install.sh`) and Windows (`install.ps1`) with full or custom component selection.
- Per-segment toggles via `SL_*` environment variables.
- Installer merges into existing `~/.claude/settings.json` and backs it up first.
- Static project website.

[2.0.0]: https://github.com/FahimFBA/claudecode-statusline/releases/tag/v2.0.0
[1.0.1]: https://github.com/FahimFBA/claudecode-statusline/releases/tag/v1.0.1
[1.0.0]: https://github.com/FahimFBA/claudecode-statusline/releases/tag/v1.0.0
