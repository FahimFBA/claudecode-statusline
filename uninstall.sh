#!/usr/bin/env bash
# claudecode-statusline — uninstaller (macOS / Linux)
# Removes the hook scripts and the settings.json entries this project added.
# Everything else in settings.json is left untouched; a .bak copy is written first.
#
# Usage: ./uninstall.sh [--keep-plugin] [--yes]
#   --keep-plugin   leave the caveman plugin / marketplace entries in settings.json
#   --yes           do not ask for confirmation

set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS="$CLAUDE_DIR/settings.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIGURE="$SCRIPT_DIR/scripts/configure-settings.js"

KEEP_PLUGIN=""; ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --keep-plugin) KEEP_PLUGIN="--keep-plugin" ;;
    --yes|-y)      ASSUME_YES=1 ;;
    -h|--help)     sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf "Unknown option: %s\n" "$arg" >&2; exit 2 ;;
  esac
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
info()    { printf "${CYAN}  →${NC} %s\n" "$*"; }
success() { printf "${GREEN}  ✓${NC} %s\n" "$*"; }
warn()    { printf "${YELLOW}  ⚠${NC} %s\n" "$*"; }
die()     { printf "${RED}  ✗${NC} %s\n" "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js not found (needed to edit settings.json safely)."

printf "\n  claudecode-statusline — uninstaller\n\n"
printf "  This will remove from %s:\n" "$CLAUDE_DIR"
printf "    • hooks/caveman-*.js and hooks/caveman-statusline.sh (+ hooks/package.json if nothing else uses it)\n"
printf "    • the SessionStart / UserPromptSubmit hooks, statusLine%s in settings.json\n" \
  "$([ -z "$KEEP_PLUGIN" ] && printf ', caveman plugin entries')"
printf "\n"

if [ "$ASSUME_YES" != "1" ]; then
  REPLY=""
  read -rp "  Continue? [y/N]: " REPLY || true
  case "$REPLY" in y|Y|yes|YES) ;; *) printf "  Cancelled.\n\n"; exit 0 ;; esac
fi

# ── settings.json ─────────────────────────────────────────────────────────────
if [ -f "$SETTINGS" ]; then
  # shellcheck disable=SC2086
  node "$CONFIGURE" uninstall --settings "$SETTINGS" $KEEP_PLUGIN || die "Could not update $SETTINGS"
else
  info "No settings.json at $SETTINGS — nothing to edit"
fi

# ── hook files ────────────────────────────────────────────────────────────────
REMOVED=0
for f in "$HOOKS_DIR"/caveman-*.js "$HOOKS_DIR"/caveman-statusline.sh; do
  [ -e "$f" ] || continue
  rm -f "$f"; REMOVED=$((REMOVED + 1))
done
if [ "$REMOVED" -gt 0 ]; then
  success "Removed $REMOVED hook file(s) from $HOOKS_DIR"
else
  info "No hook files found in $HOOKS_DIR"
fi
# The CommonJS marker is ours only if the hooks dir holds nothing else.
if [ -f "$HOOKS_DIR/package.json" ] && [ "$(ls -A "$HOOKS_DIR" | wc -l | tr -d ' ')" = "1" ]; then
  rm -f "$HOOKS_DIR/package.json"
  rmdir "$HOOKS_DIR" 2>/dev/null || true
fi

if [ -z "$KEEP_PLUGIN" ] && command -v claude >/dev/null 2>&1; then
  info "To also remove the plugin itself:  claude plugins uninstall caveman"
fi

printf "\n  ${GREEN}Done.${NC} Restart Claude Code. Your previous settings.json is saved as settings.json.bak\n\n"
