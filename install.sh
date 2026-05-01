#!/usr/bin/env bash
# claudecode-statusline — Claude Code statusline installer (macOS / Linux)
# Repo: https://github.com/FahimFBA/claudecode-statusline

set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS="$CLAUDE_DIR/settings.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_SRC="$SCRIPT_DIR/hooks"

# ── colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
info()    { printf "${CYAN}  →${NC} %s\n" "$*"; }
success() { printf "${GREEN}  ✓${NC} %s\n" "$*"; }
warn()    { printf "${YELLOW}  ⚠${NC} %s\n" "$*"; }
die()     { printf "${RED}  ✗${NC} %s\n" "$*" >&2; exit 1; }

printf "\n"
printf "${CYAN}╔══════════════════════════════════════════════════╗${NC}\n"
printf "${CYAN}║       claudecode-statusline — installer          ║${NC}\n"
printf "${CYAN}║   github.com/FahimFBA/claudecode-statusline      ║${NC}\n"
printf "${CYAN}╚══════════════════════════════════════════════════╝${NC}\n"
printf "\n"

# ── check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  die "Node.js not found. Install from https://nodejs.org (LTS) and re-run."
fi
NODE_VER=$(node --version)
info "Node.js $NODE_VER found"

# ── check jq or python3 ───────────────────────────────────────────────────────
MERGE_TOOL=""
if command -v python3 >/dev/null 2>&1; then
  MERGE_TOOL="python3"
  info "python3 found (used for settings merge)"
elif command -v jq >/dev/null 2>&1; then
  MERGE_TOOL="jq"
  info "jq found (used for settings merge)"
else
  warn "Neither python3 nor jq found — settings written fresh (existing settings backed up)."
  MERGE_TOOL="fresh"
fi

# ── create dirs ───────────────────────────────────────────────────────────────
mkdir -p "$HOOKS_DIR"
success "Hooks dir ready: $HOOKS_DIR"

# ── copy hook scripts ─────────────────────────────────────────────────────────
cp "$HOOKS_SRC/caveman-activate.js"     "$HOOKS_DIR/"
cp "$HOOKS_SRC/caveman-config.js"       "$HOOKS_DIR/"
cp "$HOOKS_SRC/caveman-mode-tracker.js" "$HOOKS_DIR/"
cp "$HOOKS_SRC/caveman-stats.js"        "$HOOKS_DIR/"
cp "$HOOKS_SRC/caveman-statusline.sh"   "$HOOKS_DIR/"
cp "$HOOKS_SRC/package.json"            "$HOOKS_DIR/"
chmod +x "$HOOKS_DIR/caveman-statusline.sh"
success "Hook scripts installed to $HOOKS_DIR"

# ── statusline installation mode ──────────────────────────────────────────────
printf "\n"
printf "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "${CYAN}${BOLD}  Statusline Setup${NC}\n"
printf "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "\n"

# Show existing statusline if present
EXISTING_SL_CMD=""
if [ -f "$SETTINGS" ] && command -v python3 >/dev/null 2>&1; then
  EXISTING_SL_CMD=$(python3 -c "
import json, sys
try:
    d = json.load(open('$SETTINGS'))
    sl = d.get('statusLine', {})
    print(sl.get('command', '') if isinstance(sl, dict) else '')
except Exception:
    print('')
" 2>/dev/null || echo "")
fi

if [ -n "$EXISTING_SL_CMD" ]; then
  printf "  ${YELLOW}Existing statusline found:${NC}\n"
  printf "  ${DIM}%s${NC}\n" "$EXISTING_SL_CMD"
  printf "\n"
fi

printf "  How do you want to install?\n"
printf "\n"
printf "  ${BOLD}1)${NC} Full install   — all components, replaces existing statusline\n"
printf "  ${BOLD}2)${NC} Custom         — choose which components to include\n"
printf "\n"
read -rp "  Choice [1/2, default=1]: " INSTALL_MODE
INSTALL_MODE="${INSTALL_MODE:-1}"

# ── component selection ───────────────────────────────────────────────────────
SL_ENV_PREFIX=""

if [ "$INSTALL_MODE" = "2" ]; then
  printf "\n"
  printf "${CYAN}${BOLD}  Available components:${NC}\n"
  printf "\n"
  printf "  ${BOLD}1)${NC} Caveman badge      ${DIM}🪨 CAVEMAN:FULL${NC}\n"
  printf "  ${BOLD}2)${NC} Project + branch   ${DIM}📁 my-project 🌿 main${NC}\n"
  printf "  ${BOLD}3)${NC} Model name         ${DIM}🤖 Claude Sonnet 4.6${NC}\n"
  printf "  ${BOLD}4)${NC} Context window     ${DIM}CTX ████░░░░ 42%%${NC}\n"
  printf "  ${BOLD}5)${NC} Effort level       ${DIM}⚡ ▄ MEDIUM${NC}\n"
  printf "  ${BOLD}6)${NC} Hourly limit (5h)  ${DIM}5h ████░░░░ 42%% used · 58%% rem ↺ 1h 22m${NC}\n"
  printf "  ${BOLD}7)${NC} Weekly limit (7d)  ${DIM}7d ██░░░░░░ 85%% used · 15%% rem ↺ 3d 7h${NC}\n"
  printf "  ${BOLD}8)${NC} Token savings      ${DIM}🪨 ~42%% tokens saved${NC}\n"
  printf "\n"
  read -rp "  Numbers to include (e.g. 2 3 4 6 7  or  2,3,4,6,7), or 'all' [default=all]: " COMP_INPUT
  COMP_INPUT="${COMP_INPUT:-all}"
  # normalize: strip commas, collapse spaces so "6, 7, 8" == "6 7 8"
  COMP_INPUT=$(printf '%s' "$COMP_INPUT" | tr ',' ' ' | tr -s ' ' | sed 's/^ //;s/ $//')

  if [ "$COMP_INPUT" != "all" ]; then
    comp_name_for() {
      case "$1" in
        1) printf "SL_CAVEMAN"  ;;
        2) printf "SL_PROJECT"  ;;
        3) printf "SL_MODEL"    ;;
        4) printf "SL_CTX"      ;;
        5) printf "SL_EFFORT"   ;;
        6) printf "SL_5H"       ;;
        7) printf "SL_7D"       ;;
        8) printf "SL_SAVINGS"  ;;
      esac
    }

    for num in 1 2 3 4 5 6 7 8; do
      if ! printf ' %s ' "$COMP_INPUT" | grep -q " $num "; then
        SL_ENV_PREFIX="$(comp_name_for "$num")=0 ${SL_ENV_PREFIX}"
      fi
    done

    printf "\n"
    # Print what's enabled
    printf "  ${GREEN}Enabled components:${NC} "
    for num in 1 2 3 4 5 6 7 8; do
      if printf ' %s ' "$COMP_INPUT" | grep -q " $num "; then
        printf "%s " "$num"
      fi
    done
    printf "\n"
  else
    printf "\n"
    printf "  ${GREEN}All components enabled.${NC}\n"
  fi
fi

# ── build settings blocks ─────────────────────────────────────────────────────
STATUSLINE_CMD="${SL_ENV_PREFIX}bash '$HOOKS_DIR/caveman-statusline.sh'"

NEW_HOOKS_JSON=$(cat <<EOF
{
  "SessionStart": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node \"$HOOKS_DIR/caveman-activate.js\"",
          "timeout": 5,
          "statusMessage": "Loading caveman mode..."
        }
      ]
    }
  ],
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node \"$HOOKS_DIR/caveman-mode-tracker.js\"",
          "timeout": 5,
          "statusMessage": "Tracking caveman mode..."
        }
      ]
    }
  ]
}
EOF
)

NEW_STATUSLINE=$(cat <<EOF
{
  "type": "command",
  "command": "$STATUSLINE_CMD"
}
EOF
)

# ── merge or write settings.json ──────────────────────────────────────────────
printf "\n"
if [ -f "$SETTINGS" ]; then
  info "Existing settings.json found — merging..."
  cp "$SETTINGS" "${SETTINGS}.bak"
  info "Backup saved to ${SETTINGS}.bak"
else
  info "No existing settings.json — creating fresh..."
fi

if [ "$MERGE_TOOL" = "python3" ]; then
  python3 - "$SETTINGS" "$NEW_HOOKS_JSON" "$NEW_STATUSLINE" <<'PYEOF'
import sys, json, os

settings_path = sys.argv[1]
new_hooks_raw = sys.argv[2]
new_statusline_raw = sys.argv[3]

if os.path.exists(settings_path):
    with open(settings_path) as f:
        cfg = json.load(f)
else:
    cfg = {}

new_hooks = json.loads(new_hooks_raw)
new_statusline = json.loads(new_statusline_raw)

existing_hooks = cfg.get("hooks", {})
existing_hooks.update(new_hooks)
cfg["hooks"] = existing_hooks
cfg["statusLine"] = new_statusline

plugins = cfg.get("enabledPlugins", {})
plugins["caveman@caveman"] = True
cfg["enabledPlugins"] = plugins

marketplaces = cfg.get("extraKnownMarketplaces", {})
if "caveman" not in marketplaces:
    marketplaces["caveman"] = {
        "source": {"source": "github", "repo": "JuliusBrussee/caveman"}
    }
cfg["extraKnownMarketplaces"] = marketplaces

with open(settings_path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")

print("Settings merged successfully.")
PYEOF

elif [ "$MERGE_TOOL" = "jq" ]; then
  HOOKS_ARG=$(printf '%s' "$NEW_HOOKS_JSON" | jq -c '.')
  STATUSLINE_ARG=$(printf '%s' "$NEW_STATUSLINE" | jq -c '.')
  EXISTING="{}"
  [ -f "$SETTINGS" ] && EXISTING=$(cat "$SETTINGS")
  printf '%s' "$EXISTING" | jq \
    --argjson h "$HOOKS_ARG" \
    --argjson s "$STATUSLINE_ARG" \
    '.hooks = (.hooks // {} | . + $h) | .statusLine = $s | .enabledPlugins["caveman@caveman"] = true | .extraKnownMarketplaces.caveman = {"source":{"source":"github","repo":"JuliusBrussee/caveman"}}' \
    > "$SETTINGS"

else
  ACTIVATE_CMD="node '$HOOKS_DIR/caveman-activate.js'"
  TRACKER_CMD="node '$HOOKS_DIR/caveman-mode-tracker.js'"
  cat > "$SETTINGS" <<JSONEOF
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$ACTIVATE_CMD",
            "timeout": 5,
            "statusMessage": "Loading caveman mode..."
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$TRACKER_CMD",
            "timeout": 5,
            "statusMessage": "Tracking caveman mode..."
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "$STATUSLINE_CMD"
  },
  "enabledPlugins": {
    "caveman@caveman": true
  },
  "extraKnownMarketplaces": {
    "caveman": {
      "source": {
        "source": "github",
        "repo": "JuliusBrussee/caveman"
      }
    }
  },
  "theme": "dark"
}
JSONEOF
fi

success "settings.json updated: $SETTINGS"

# ── install caveman plugin ────────────────────────────────────────────────────
if command -v claude >/dev/null 2>&1; then
  info "Installing caveman plugin via claude CLI..."
  if claude plugins install caveman --marketplace caveman 2>/dev/null; then
    success "Caveman plugin installed"
  else
    warn "Plugin install skipped (may already be installed or requires manual step)"
    warn "Manual: claude plugins install caveman --marketplace caveman"
  fi
else
  warn "'claude' CLI not found in PATH. After installing Claude Code, run:"
  warn "  claude plugins install caveman --marketplace caveman"
fi

# ── done ──────────────────────────────────────────────────────────────────────
printf "\n"
printf "${GREEN}╔══════════════════════════════════════════════════╗${NC}\n"
printf "${GREEN}║             Installation complete!               ║${NC}\n"
printf "${GREEN}╚══════════════════════════════════════════════════╝${NC}\n"
printf "\n"
printf "  Restart Claude Code to activate the new statusline.\n"
printf "\n"
printf "  ${BOLD}Statusline segments:${NC}\n"
printf "    ${DIM}🪨 CAVEMAN${NC}                  — active caveman mode\n"
printf "    ${DIM}📁 project 🌿 branch${NC}         — folder + git branch\n"
printf "    ${DIM}🤖 Claude Sonnet 4.6${NC}         — current model\n"
printf "    ${DIM}CTX ████░░░░ 42%%${NC}            — context window usage\n"
printf "    ${DIM}⚡ ▄ MEDIUM${NC}                 — effort level\n"
printf "    ${DIM}5h ████░░░░ 42%% used 58%% rem ↺${NC} — hourly limit + reset\n"
printf "    ${DIM}7d ██░░░░░░ 85%% used 15%% rem ↺${NC} — weekly limit + reset\n"
printf "\n"
printf "  ${BOLD}Caveman commands:${NC}\n"
printf "    /caveman          — activate (full mode)\n"
printf "    /caveman lite     — lite mode\n"
printf "    /caveman ultra    — ultra mode\n"
printf "    stop caveman      — deactivate\n"
printf "    /caveman-stats    — token usage + savings\n"
printf "\n"
printf "  ${BOLD}Customize statusline:${NC}\n"
printf "    Re-run installer and choose option 2 to pick components.\n"
printf "    Or edit ~/.claude/hooks/caveman-statusline.sh directly.\n"
printf "\n"
