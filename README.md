# claudecode-statusline

<p align="center">
  <img src="img/preview.png" alt="claudecode-statusline preview" width="720"/>
</p>

A one-command setup for a richly decorated Claude Code statusline with [Caveman mode](https://github.com/JuliusBrussee/caveman) baked in. Interactive installer lets you pick all components or only the ones you want.

## What you get

<p align="center">
  <img src="img/statusline.svg" alt="Example statusline with caveman badge, project, model, context, 5h and 7d limits" width="100%"/>
</p>

| Segment | Description |
|---|---|
| `🪨 CAVEMAN` | Active caveman mode (hidden when off) |
| `📁 project 🌿 branch` | Project folder name + git branch |
| `🤖 Claude Sonnet 4.6` | Current model name |
| <img src="img/seg-ctx.svg" alt="CTX ███░░░░░ 42%"/> | Context window usage bar (green → yellow → red) |
| `⚡ ▄ MEDIUM` | Effort level with fill icon (only when model supports it) |
| <img src="img/seg-5h.svg" alt="5h ███░░░░░ 42% used 58% rem ↺ 1h 22m"/> | Hourly rate limit: spent + remaining % + time until reset |
| <img src="img/seg-7d.svg" alt="7d ██████░░ 85% used 15% rem ↺ 3d 7h"/> | Weekly rate limit: spent + remaining % + time until reset |

Rate limit bars use color-coded severity for both values:
- **Used %** — green (low) → yellow (mid) → red (high usage)
- **Rem %** — green (plenty left) → yellow → red (almost none left)

## Prerequisites

| Requirement | Install |
|---|---|
| [Claude Code](https://claude.ai/code) | Download from claude.ai/code |
| [Node.js](https://nodejs.org) LTS | `brew install node` / [nodejs.org](https://nodejs.org) |
| `git` (optional) | Shows branch in statusline. Windows: [Git for Windows](https://git-scm.com) |

## Quick start

### macOS / Linux

```bash
git clone https://github.com/FahimFBA/claudecode-statusline.git
cd claudecode-statusline
chmod +x install.sh
./install.sh
```

Then restart Claude Code.

### Windows (PowerShell)

```powershell
git clone https://github.com/FahimFBA/claudecode-statusline.git
cd claudecode-statusline
powershell -ExecutionPolicy Bypass -File install.ps1
```

Then restart Claude Code.

## Interactive installer

When you run the installer it will ask:

```
How do you want to install?

  1) Full install  -- all components, replaces existing statusline
  2) Custom        -- choose which components to include

Choice [1/2, default=1]:
```

If you choose **2**, you'll see a numbered menu:

<img src="img/installer-menu.svg" alt="Installer menu listing 8 components: caveman badge, project and branch, model name, context window, effort level, 5-hour limit, weekly limit, token savings" width="700"/>

Enter the numbers you want separated by spaces. Your existing `statusLine` in `settings.json` is shown before you choose, so you can decide whether to replace it or build a custom one.

## What the installer does

1. Copies hook scripts to `~/.claude/hooks/`
2. Merges settings into `~/.claude/settings.json` (backs up existing file first)
3. Installs the Caveman plugin via `claude plugins install caveman --marketplace caveman`

Existing settings are **merged**, not overwritten — your other config survives.

## Caveman mode commands

| Command | Effect |
|---|---|
| `/caveman` | Activate full mode |
| `/caveman lite` | Lite mode (fewer drops) |
| `/caveman ultra` | Ultra compressed |
| `/caveman off` | Deactivate |
| `stop caveman` | Natural language deactivate |
| `/caveman-stats` | Token usage + savings this session |
| `/caveman-stats --all` | Lifetime stats across all sessions |

### Intensity levels

| Level | Behaviour |
|---|---|
| `lite` | Drop articles and filler, keep sentence structure |
| `full` | Fragments OK, short synonyms, caveman pattern |
| `ultra` | Maximum compression, minimal connectives |

## Files

```
claudecode-statusline/
├── hooks/
│   ├── caveman-activate.js      # SessionStart hook — activates caveman mode
│   ├── caveman-config.js        # Shared config resolver + safe flag I/O
│   ├── caveman-mode-tracker.js  # UserPromptSubmit hook — tracks mode changes
│   ├── caveman-stats.js         # Token usage stats engine
│   ├── caveman-statusline.js    # Statusline renderer (Node, used on Windows)
│   ├── caveman-statusline.sh    # Statusline renderer (bash, macOS / Linux)
│   └── package.json             # CommonJS marker
├── settings.template.json       # Reference settings (paths replaced by installer)
├── install.sh                   # macOS / Linux installer
├── install.ps1                  # Windows PowerShell installer
└── README.md
```

## Customising the statusline

Re-run the installer and choose option 2 to pick which components to show.

Or edit `~/.claude/hooks/caveman-statusline.sh` directly after install. The `append` function controls segment order — comment out any segment you don't want.

Each component can also be toggled via environment variables in the statusLine command (the installer writes these automatically when you use option 2):

| Env var | Default | Hides |
|---|---|---|
| `SL_CAVEMAN=0` | on | Caveman badge |
| `SL_PROJECT=0` | on | Project + branch |
| `SL_MODEL=0` | on | Model name |
| `SL_CTX=0` | on | Context window bar |
| `SL_EFFORT=0` | on | Effort level |
| `SL_5H=0` | on | Hourly rate limit |
| `SL_7D=0` | on | Weekly rate limit |
| `SL_SAVINGS=0` | on | Token savings |

To change caveman default mode, set the environment variable before starting Claude Code:

```bash
export CAVEMAN_DEFAULT_MODE=lite   # lite | full | ultra | off
```

Or create `~/.config/caveman/config.json`:

```json
{ "defaultMode": "lite" }
```

## Uninstall

Remove the hook scripts.

macOS / Linux:

```bash
rm ~/.claude/hooks/caveman-*.js ~/.claude/hooks/caveman-statusline.sh
```

Windows (PowerShell):

```powershell
Remove-Item "$env:USERPROFILE\.claude\hooks\caveman-*"
```

Remove the `hooks`, `statusLine`, `enabledPlugins`, and `extraKnownMarketplaces` keys from `~/.claude/settings.json`.

## Credits

- [Caveman plugin](https://github.com/JuliusBrussee/caveman) by JuliusBrussee — the underlying caveman mode engine
- Statusline and installer by [FahimFBA](https://github.com/FahimFBA)
