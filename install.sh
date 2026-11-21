#!/usr/bin/env bash
# claudecode-statusline — Claude Code statusline installer (macOS / Linux)
# Repo: https://github.com/FahimFBA/claudecode-statusline

set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS="$CLAUDE_DIR/settings.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_SRC="$SCRIPT_DIR/hooks"
CONFIGURE="$SCRIPT_DIR/scripts/configure-settings.js"

# Usage: ./install.sh [--update]
#   --update   non-interactive upgrade: keep your current components / theme /
#              order, install the new scripts, hide segments added in v2
UPDATE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --update) UPDATE_ONLY=1 ;;
    -h|--help) sed -n '/^# Usage/,/^#              order/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf "Unknown option: %s\n" "$arg" >&2; exit 2 ;;
  esac
done

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

# ── check Node.js (renderer + settings merge both need it) ────────────────────
if ! command -v node >/dev/null 2>&1; then
  die "Node.js not found. Install from https://nodejs.org (LTS) and re-run."
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  die "Node.js 18 or newer required (found $(node --version)). Update from https://nodejs.org"
fi
info "Node.js $(node --version) found"

# ── what is installed right now? (read before anything is overwritten) ────────
NEW_VERSION=$(node "$HOOKS_SRC/caveman-statusline.js" --version 2>/dev/null || echo "?")
PREV_VERSION=""
if [ -f "$HOOKS_DIR/caveman-statusline.js" ]; then
  PREV_VERSION=$(sed -n "s/^const VERSION = '\([0-9][0-9.]*\)';.*/\1/p" "$HOOKS_DIR/caveman-statusline.js" | head -n1)
  PREV_VERSION="${PREV_VERSION:-1.x}"
elif [ -f "$HOOKS_DIR/caveman-statusline.sh" ]; then
  PREV_VERSION="1.x"
fi
EXISTING_STATUS="none"
if [ -f "$SETTINGS" ]; then
  EXISTING_STATUS=$(node "$CONFIGURE" status --settings "$SETTINGS" 2>/dev/null) \
    || die "Cannot read $SETTINGS (is it valid JSON?). Nothing was changed."
fi
CAN_UPDATE=0
case "$EXISTING_STATUS" in v1|v2) CAN_UPDATE=1 ;; esac
if [ -n "$PREV_VERSION" ]; then
  info "Installed: v$PREV_VERSION  →  this version: v$NEW_VERSION"
fi

# ── create dirs ───────────────────────────────────────────────────────────────
mkdir -p "$HOOKS_DIR"
success "Hooks dir ready: $HOOKS_DIR"

# ── copy hook scripts ─────────────────────────────────────────────────────────
for f in caveman-activate.js caveman-config.js caveman-mode-tracker.js \
         caveman-stats.js caveman-statusline.js package.json; do
  cp "$HOOKS_SRC/$f" "$HOOKS_DIR/"
done
success "Hook scripts installed to $HOOKS_DIR"

# v1.x used a bash + jq renderer. v2 is Node only — drop the stale copy.
if [ -f "$HOOKS_DIR/caveman-statusline.sh" ]; then
  rm -f "$HOOKS_DIR/caveman-statusline.sh"
  info "Removed legacy caveman-statusline.sh (replaced by caveman-statusline.js)"
fi

# ── statusline installation mode ──────────────────────────────────────────────
printf "\n"
printf "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "${CYAN}${BOLD}  Statusline Setup${NC}\n"
printf "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "\n"

EXISTING_SL_CMD=""
if [ -f "$SETTINGS" ]; then
  EXISTING_SL_CMD=$(node "$CONFIGURE" show --settings "$SETTINGS" 2>/dev/null || true)
fi
if [ -n "$EXISTING_SL_CMD" ]; then
  printf "  ${YELLOW}Existing statusline found:${NC}\n"
  printf "  ${DIM}%s${NC}\n" "$EXISTING_SL_CMD"
  printf "\n"
fi

if [ "$CAN_UPDATE" = "1" ]; then
  printf "  ${GREEN}This is an update.${NC} Your current claudecode-statusline keeps working until you\n"
  printf "  choose; ${BOLD}Update${NC} keeps your components, order and theme and just upgrades the scripts.\n"
  printf "  Your settings.json is backed up to settings.json.bak first.\n\n"
fi

printf "  How do you want to install?\n"
printf "\n"
printf "  ${BOLD}1)${NC} Default        — the classic compact line: project, model, context, effort, 5h / 7d limits\n"
printf "  ${BOLD}2)${NC} Custom         — choose components and their order\n"
printf "  ${BOLD}3)${NC} Install all    — everything: adds burn-rate, cost, time, lines changed and git status\n"
[ "$CAN_UPDATE" = "1" ] && \
printf "  ${BOLD}4)${NC} Update         — keep my current settings, upgrade only ${DIM}(recommended)${NC}\n"
printf "\n"
DEFAULT_MODE=1; [ "$CAN_UPDATE" = "1" ] && DEFAULT_MODE=4
INSTALL_MODE=""
if [ "$UPDATE_ONLY" = "1" ]; then
  INSTALL_MODE="$DEFAULT_MODE"
  printf "  --update given: mode %s\n" "$INSTALL_MODE"
else
  read -rp "  Choice [default=$DEFAULT_MODE]: " INSTALL_MODE || true
  INSTALL_MODE="${INSTALL_MODE:-$DEFAULT_MODE}"
fi
# "4" only makes sense when there is something to update
[ "$INSTALL_MODE" = "4" ] && [ "$CAN_UPDATE" != "1" ] && INSTALL_MODE=1

# 3) Install all = every segment + git status markers
if [ "$INSTALL_MODE" = "3" ]; then
  printf "\n  ${GREEN}Installing everything:${NC} all 12 segments plus git status markers.\n"
fi

# ── component selection ───────────────────────────────────────────────────────
ENV_PARTS=""   # space separated KEY=VALUE pairs for the statusLine command
add_env() { ENV_PARTS="${ENV_PARTS:+$ENV_PARTS }$1"; }

comp_key() {
  case "$1" in
    1) printf "caveman" ;;  2) printf "project" ;;  3) printf "model" ;;
    4) printf "ctx" ;;      5) printf "effort" ;;   6) printf "5h" ;;
    7) printf "7d" ;;       8) printf "savings" ;;  9) printf "burn" ;;
    10) printf "cost" ;;    11) printf "time" ;;    12) printf "lines" ;;
  esac
}

if [ "$INSTALL_MODE" = "2" ]; then
  printf "\n"
  printf "${CYAN}${BOLD}  Available components:${NC}\n"
  printf "\n"
  printf "   ${BOLD}1)${NC} Caveman badge      ${DIM}🪨 CAVEMAN:FULL${NC}\n"
  printf "   ${BOLD}2)${NC} Project + branch   ${DIM}📁 my-project 🌿 main${NC}\n"
  printf "   ${BOLD}3)${NC} Model name         ${DIM}🤖 Claude Opus 5.5${NC}\n"
  printf "   ${BOLD}4)${NC} Context window     ${DIM}CTX ███░░░░░ 42%%${NC}\n"
  printf "   ${BOLD}5)${NC} Effort level       ${DIM}⚡ ▄ MEDIUM${NC}\n"
  printf "   ${BOLD}6)${NC} Hourly limit (5h)  ${DIM}5h ████░░░░ 62%% used 38%% rem ↺ 2h 40m${NC}\n"
  printf "   ${BOLD}7)${NC} Weekly limit (7d)  ${DIM}7d ███░░░░░ 41%% used 59%% rem ↺ 3d 7h${NC}\n"
  printf "   ${BOLD}8)${NC} Token savings      ${DIM}🪨 ~42%% tokens saved${NC}\n"
  printf "   ${BOLD}9)${NC} Burn-rate warning  ${DIM}🔥 5h full in ~1h 25m  (only when you will hit the limit)${NC}\n"
  printf "  ${BOLD}10)${NC} Session cost       ${DIM}💰 \$0.42${NC}\n"
  printf "  ${BOLD}11)${NC} Session time       ${DIM}⏱ 18m${NC}\n"
  printf "  ${BOLD}12)${NC} Lines changed      ${DIM}+124 -37${NC}\n"
  printf "  ${BOLD}13)${NC} Git status         ${DIM}✎3 ?2 ↑1  (dirty, untracked, ahead/behind — extends 2)${NC}\n"
  printf "\n"
  COMP_INPUT=""
  printf "  Type the numbers in the order to show them (e.g. 2 3 4 6 7 10 13),\n"
  printf "  'all' for everything, or just press Enter for the classic set.\n"
  read -rp "  Components [default=classic]: " COMP_INPUT || true
  COMP_INPUT="${COMP_INPUT:-classic}"
  # normalize: strip commas, collapse spaces so "6, 7, 8" == "6 7 8"
  COMP_INPUT=$(printf '%s' "$COMP_INPUT" | tr ',' ' ' | tr -s ' ' | sed 's/^ //;s/ $//' | tr '[:upper:]' '[:lower:]')

  if [ "$COMP_INPUT" = "all" ]; then
    add_env "SL_ORDER=all"
    printf "\n  ${GREEN}All components enabled${NC} (including git status).\n"
  elif [ "$COMP_INPUT" = "classic" ] || [ "$COMP_INPUT" = "default" ]; then
    printf "\n  ${GREEN}Classic set.${NC}\n"
  else
    ORDER_KEYS=""; GIT_ON=0
    for num in $COMP_INPUT; do
      case "$num" in
        [1-9]|1[0-2])
          key=$(comp_key "$num")
          case ",$ORDER_KEYS," in
            *",$key,"*) ;;
            *) ORDER_KEYS="${ORDER_KEYS:+$ORDER_KEYS,}$key" ;;
          esac ;;
        13) GIT_ON=1 ;;
        *)  warn "Ignoring unknown component '$num'" ;;
      esac
    done

    # `git` in SL_ORDER switches the git status markers on (they extend "project").
    [ "$GIT_ON" = "1" ] && ORDER_KEYS="${ORDER_KEYS:+$ORDER_KEYS,}git"
    if [ -z "$ORDER_KEYS" ]; then
      warn "No valid components chosen — using the classic set."
    else
      add_env "SL_ORDER=$ORDER_KEYS"
      printf "\n  ${GREEN}Enabled (in order):${NC} %s\n" "$(printf '%s' "$ORDER_KEYS" | tr ',' ' ')"
    fi
  fi
fi

[ "$INSTALL_MODE" = "3" ] && add_env "SL_ORDER=all"

# ── update: carry the current configuration over ──────────────────────────────
if [ "$INSTALL_MODE" = "4" ]; then
  # Our own validated SL_* variables from the existing statusLine command.
  ENV_PARTS=$(node "$CONFIGURE" env --settings "$SETTINGS" 2>/dev/null || true)
  if [ -n "$ENV_PARTS" ]; then
    printf "\n  ${GREEN}Keeping your settings:${NC} %s\n" "$ENV_PARTS"
  else
    printf "\n  ${GREEN}Keeping your settings:${NC} ${DIM}(defaults)${NC}\n"
  fi

  # v1.0.1 on Windows already used a Node command, so judge by the installed renderer too.
  if [ "$EXISTING_STATUS" = "v1" ] || [ "$PREV_VERSION" = "1.x" ]; then
    # v1 had no burn / cost / time / lines / git-status extras. They are off by default
    # in v2, so your line stays exactly as it was unless you opt in here.
    printf "\n  ${BOLD}New in v2${NC} (off by default, your line stays the same):\n"
    printf "  🔥 burn-rate warning · 💰 session cost · ⏱ session time · +/- lines changed · ✎ git status\n"
    SHOW_NEW="n"
    if [ "$UPDATE_ONLY" != "1" ]; then
      read -rp "  Turn them on? [y/N]: " SHOW_NEW || true
    fi
    case "${SHOW_NEW:-n}" in
      y|Y|yes|YES)
        for flag in SL_BURN SL_COST SL_TIME SL_LINES SL_GIT; do
          case " $ENV_PARTS " in *" $flag="*) ;; *) add_env "$flag=1" ;; esac
        done
        printf "  ${GREEN}Turned on.${NC} ${DIM}Switch one off again with e.g. SL_COST=0.${NC}\n" ;;
      *) printf "  ${DIM}Left off. Turn on later with ./install.sh (Install all) or SL_BURN=1 SL_COST=1 SL_TIME=1 SL_LINES=1 SL_GIT=1.${NC}\n" ;;
    esac
  fi
else
  # ── theme ───────────────────────────────────────────────────────────────────
  printf "\n"
  printf "  ${BOLD}Color theme:${NC}  ${BOLD}1)${NC} default  ${BOLD}2)${NC} nord  ${BOLD}3)${NC} gruvbox  ${BOLD}4)${NC} light  ${BOLD}5)${NC} mono\n"
  THEME_INPUT=""
  if [ "$UPDATE_ONLY" != "1" ]; then
    read -rp "  Theme [1-5, default=1]: " THEME_INPUT || true
  fi
  case "${THEME_INPUT:-1}" in
    2) add_env "SL_THEME=nord" ;;
    3) add_env "SL_THEME=gruvbox" ;;
    4) add_env "SL_THEME=light" ;;
    5) add_env "SL_THEME=mono" ;;
  esac
fi

# ── preview ───────────────────────────────────────────────────────────────────
printf "\n  ${BOLD}Preview:${NC}\n  "
# shellcheck disable=SC2086
env $ENV_PARTS node "$HOOKS_DIR/caveman-statusline.js" --demo || warn "Preview failed"

# ── merge settings.json ───────────────────────────────────────────────────────
printf "\n"
if [ -f "$SETTINGS" ]; then
  info "Existing settings.json found — merging (your other config is kept)..."
else
  info "No existing settings.json — creating fresh..."
fi
# Upgrading from 1.x: also keep a one-time copy that later runs never overwrite.
ARCHIVE_ARGS=()
[ "$PREV_VERSION" = "1.x" ] && ARCHIVE_ARGS=(--archive pre-v2)
node "$CONFIGURE" install --settings "$SETTINGS" --hooks-dir "$HOOKS_DIR" --env "$ENV_PARTS" \
  ${ARCHIVE_ARGS[@]+"${ARCHIVE_ARGS[@]}"} || die "Could not update $SETTINGS"
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
printf "    ${DIM}📁 project 🌿 branch${NC}        — folder + git branch\n"
printf "    ${DIM}🤖 Claude Opus 5.5${NC}         — current model\n"
printf "    ${DIM}CTX ███░░░░░ 42%%${NC}            — context window usage\n"
printf "    ${DIM}⚡ ▄ MEDIUM${NC}                 — effort level\n"
printf "    ${DIM}5h / 7d bars${NC}                — usage, remaining, reset countdown\n"
printf "    ${DIM}Extras (Install all, or pick them in Custom):${NC}\n"
printf "    ${DIM}✎3 ?2 ↑1${NC}                    — git status next to the branch\n"
printf "    ${DIM}🔥 5h full in ~1h 25m${NC}        — burn-rate warning\n"
printf "    ${DIM}💰 \$0.42  ⏱ 18m  +124 -37${NC}   — session cost, time, lines changed\n"
printf "\n"
printf "  ${BOLD}Caveman commands:${NC}\n"
printf "    /caveman          — activate (full mode)\n"
printf "    /caveman lite     — lite mode\n"
printf "    /caveman ultra    — ultra mode\n"
printf "    stop caveman      — deactivate\n"
printf "    /caveman-stats    — token usage + savings\n"
printf "\n"
printf "  ${BOLD}Customize later:${NC}\n"
printf "    Re-run this installer, or edit the env vars in the statusLine command\n"
printf "    in %s (SL_ORDER, SL_THEME, SL_<SEGMENT>=0).\n" "$SETTINGS"
printf "    Preview any combo:  SL_THEME=nord node \"%s/caveman-statusline.js\" --demo\n" "$HOOKS_DIR"
printf "    Uninstall:          ./uninstall.sh\n"
if [ -n "$PREV_VERSION" ]; then
  printf "\n  ${BOLD}Roll back:${NC} cp \"%s.bak\" \"%s\"  (restores the previous settings)\n" "$SETTINGS" "$SETTINGS"
  printf "    To go back to an older release, in your clone: git checkout v1.0.1 && ./install.sh\n"
  printf "    (any tag from https://github.com/FahimFBA/claudecode-statusline/tags works)\n"
fi
printf "\n"
