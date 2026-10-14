# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

Publishing a release: add a new `## [x.y.z] - YYYY-MM-DD` section at the top and push to `main`.
The release workflow tags `vx.y.z` and creates a GitHub release from that section.

## [1.0.0] - 2026-10-14

### Added
- Decorated Claude Code statusline: project + git branch, model name, context window bar, effort level, 5h and 7d rate limit bars with remaining % and reset countdown.
- Color-coded severity for context and rate limit usage (green, yellow, red).
- Caveman mode integration: statusline badge, SessionStart and UserPromptSubmit hooks, `/caveman-stats` token usage and savings.
- Interactive installers for macOS / Linux (`install.sh`) and Windows (`install.ps1`) with full or custom component selection.
- Per-segment toggles via `SL_*` environment variables.
- Installer merges into existing `~/.claude/settings.json` and backs it up first.
- Static project website.

[1.0.0]: https://github.com/FahimFBA/claudecode-statusline/releases/tag/v1.0.0
