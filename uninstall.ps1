# claudecode-statusline — uninstaller (Windows PowerShell)
# Removes the hook scripts and the settings.json entries this project added.
# Everything else in settings.json is left untouched; a .bak copy is written first.
#
# Run: powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-KeepPlugin] [-Yes]

param(
    [string]$ClaudeDir = "",
    [switch]$KeepPlugin,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

function Write-Info    { param($msg) Write-Host "  -> $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "  v  $msg" -ForegroundColor Green }
function Write-Fail    { param($msg) Write-Host "  X  $msg" -ForegroundColor Red; exit 1 }

if (-not $ClaudeDir) {
    $envDir = [System.Environment]::GetEnvironmentVariable("CLAUDE_CONFIG_DIR")
    if ($envDir) { $ClaudeDir = $envDir }
    else         { $ClaudeDir = Join-Path $env:USERPROFILE ".claude" }
}
$HooksDir     = Join-Path $ClaudeDir "hooks"
$SettingsFile = Join-Path $ClaudeDir "settings.json"
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$Configure    = Join-Path $ScriptDir "scripts\configure-settings.js"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail "Node.js not found (needed to edit settings.json safely)."
}

Write-Host ""
Write-Host "  claudecode-statusline -- uninstaller" -ForegroundColor Cyan
Write-Host ""
Write-Host "  This will remove from ${ClaudeDir}:"
Write-Host "    - hooks\caveman-*.js and hooks\caveman-statusline.sh (+ hooks\package.json if nothing else uses it)"
if ($KeepPlugin) {
    Write-Host "    - the SessionStart / UserPromptSubmit hooks and statusLine in settings.json"
} else {
    Write-Host "    - the SessionStart / UserPromptSubmit hooks, statusLine and caveman plugin entries in settings.json"
}
Write-Host ""

if (-not $Yes) {
    $reply = Read-Host "  Continue? [y/N]"
    if ($reply -notmatch '^(y|yes)$') { Write-Host "  Cancelled."; Write-Host ""; exit 0 }
}

# ── settings.json ─────────────────────────────────────────────────────────────
if (Test-Path $SettingsFile) {
    $cfgArgs = @($Configure, "uninstall", "--settings", $SettingsFile)
    if ($KeepPlugin) { $cfgArgs += "--keep-plugin" }
    & node @cfgArgs
    if ($LASTEXITCODE -ne 0) { Write-Fail "Could not update $SettingsFile" }
} else {
    Write-Info "No settings.json at $SettingsFile -- nothing to edit"
}

# ── hook files ────────────────────────────────────────────────────────────────
$targets = @()
if (Test-Path $HooksDir) {
    $targets += Get-ChildItem -Path $HooksDir -Filter "caveman-*.js" -File -ErrorAction SilentlyContinue
    $targets += Get-ChildItem -Path $HooksDir -Filter "caveman-statusline.sh" -File -ErrorAction SilentlyContinue
}
if ($targets.Count -gt 0) {
    $targets | Remove-Item -Force
    Write-Success "Removed $($targets.Count) hook file(s) from $HooksDir"
} else {
    Write-Info "No hook files found in $HooksDir"
}
# The CommonJS marker is ours only if the hooks dir holds nothing else.
if (Test-Path $HooksDir) {
    $left = @(Get-ChildItem -Path $HooksDir -Force)
    if ($left.Count -eq 1 -and $left[0].Name -eq "package.json") {
        Remove-Item -Path $HooksDir -Recurse -Force
    }
}

if ((-not $KeepPlugin) -and (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Info "To also remove the plugin itself:  claude plugins uninstall caveman"
}

Write-Host ""
Write-Host "  Done. Restart Claude Code. Your previous settings.json is saved as settings.json.bak" -ForegroundColor Green
Write-Host ""
