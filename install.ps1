# claudecode-statusline — Claude Code statusline installer (Windows PowerShell)
# Repo: https://github.com/FahimFBA/claudecode-statusline
# Run: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [string]$ClaudeDir = "",
    # Non-interactive upgrade: keep current components / theme / order, install the
    # new scripts, hide the segments that are new in v2.
    [switch]$Update
)

$ErrorActionPreference = "Stop"

# ── colours ───────────────────────────────────────────────────────────────────
function Write-Info    { param($msg) Write-Host "  -> $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "  v  $msg" -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "  !  $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "  X  $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  claudecode-statusline -- installer" -ForegroundColor Cyan
Write-Host "  github.com/FahimFBA/claudecode-statusline" -ForegroundColor DarkCyan
Write-Host ""

# ── resolve Claude config dir ─────────────────────────────────────────────────
if (-not $ClaudeDir) {
    $envDir = [System.Environment]::GetEnvironmentVariable("CLAUDE_CONFIG_DIR")
    if ($envDir) { $ClaudeDir = $envDir }
    else         { $ClaudeDir = Join-Path $env:USERPROFILE ".claude" }
}
$HooksDir     = Join-Path $ClaudeDir "hooks"
$SettingsFile = Join-Path $ClaudeDir "settings.json"
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$HooksSrc     = Join-Path $ScriptDir "hooks"
$Configure    = Join-Path $ScriptDir "scripts\configure-settings.js"

# ── check Node.js (renderer + settings merge both need it) ────────────────────
$nodeVer = ""
try { $nodeVer = (& node --version 2>&1 | Out-String).Trim() } catch { }
if (-not $nodeVer -or $nodeVer -notmatch '^v\d+') {
    Write-Fail "Node.js not found. Install from https://nodejs.org (LTS) and re-run."
}
$nodeMajor = [int]($nodeVer.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) {
    Write-Fail "Node.js 18 or newer required (found $nodeVer). Update from https://nodejs.org"
}
Write-Info "Node.js $nodeVer found"

# ── what is installed right now? (read before anything is overwritten) ────────
$newVersion = ""
try { $newVersion = (& node (Join-Path $HooksSrc "caveman-statusline.js") --version 2>$null | Out-String).Trim() } catch { }
if (-not $newVersion) { $newVersion = "?" }
$prevVersion = ""
$installedJs = Join-Path $HooksDir "caveman-statusline.js"
if (Test-Path $installedJs) {
    $hit = Select-String -Path $installedJs -Pattern "^const VERSION = '([0-9][0-9.]*)';" | Select-Object -First 1
    if ($hit) { $prevVersion = $hit.Matches[0].Groups[1].Value } else { $prevVersion = "1.x" }
} elseif (Test-Path (Join-Path $HooksDir "caveman-statusline.sh")) {
    $prevVersion = "1.x"
}
$existingStatus = "none"
if (Test-Path $SettingsFile) {
    $existingStatus = (& node $Configure status --settings $SettingsFile 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $existingStatus) {
        Write-Fail "Cannot read $SettingsFile (is it valid JSON?). Nothing was changed."
    }
}
$canUpdate = ($existingStatus -eq "v1" -or $existingStatus -eq "v2")
if ($prevVersion) { Write-Info "Installed: v$prevVersion  ->  this version: v$newVersion" }

# ── create hooks dir ──────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $HooksDir | Out-Null
Write-Success "Hooks dir ready: $HooksDir"

# ── copy hook scripts ─────────────────────────────────────────────────────────
$hookFiles = @(
    "caveman-activate.js",
    "caveman-config.js",
    "caveman-mode-tracker.js",
    "caveman-stats.js",
    "caveman-statusline.js",
    "package.json"
)
foreach ($file in $hookFiles) {
    Copy-Item -Path (Join-Path $HooksSrc $file) -Destination (Join-Path $HooksDir $file) -Force
}
Write-Success "Hook scripts installed to $HooksDir"

# v1.x shipped a bash + jq renderer. v2 is Node only -- drop the stale copy.
$legacySh = Join-Path $HooksDir "caveman-statusline.sh"
if (Test-Path $legacySh) {
    Remove-Item $legacySh -Force
    Write-Info "Removed legacy caveman-statusline.sh (replaced by caveman-statusline.js)"
}

# ── statusline setup ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Statusline Setup" -ForegroundColor Cyan
Write-Host "  ------------------------------------------------" -ForegroundColor DarkCyan
Write-Host ""

$existingSlCmd = ""
if (Test-Path $SettingsFile) {
    try { $existingSlCmd = (& node $Configure show --settings $SettingsFile 2>$null | Out-String).Trim() } catch { }
}
if ($existingSlCmd) {
    Write-Host "  Existing statusline found:" -ForegroundColor Yellow
    Write-Host "  $existingSlCmd" -ForegroundColor DarkGray
    Write-Host ""
}

if ($canUpdate) {
    Write-Host "  This is an update. Your current claudecode-statusline keeps working until you" -ForegroundColor Green
    Write-Host "  choose; Update keeps your components, order and theme and just upgrades the scripts."
    Write-Host "  Your settings.json is backed up to settings.json.bak first."
    Write-Host ""
}

Write-Host "  How do you want to install?"
Write-Host ""
Write-Host "  1) Default       -- the classic compact line: project, model, context, effort, 5h / 7d limits"
Write-Host "  2) Custom        -- choose components and their order"
Write-Host "  3) Install all   -- everything: adds burn-rate, cost, time, lines changed and git status"
if ($canUpdate) {
    Write-Host "  4) Update        -- keep my current settings, upgrade only (recommended)"
}
Write-Host ""
$defaultMode = "1"
if ($canUpdate) { $defaultMode = "4" }
if ($Update) {
    $installMode = $defaultMode
    Write-Host "  -Update given: mode $installMode"
} else {
    $installMode = Read-Host "  Choice [default=$defaultMode]"
    if (-not $installMode) { $installMode = $defaultMode }
}
if ($installMode -eq "4" -and -not $canUpdate) { $installMode = "1" }

# ── component selection ───────────────────────────────────────────────────────
$envParts = New-Object System.Collections.ArrayList

# 3) Install all = every segment + git status markers
if ($installMode -eq "3") {
    [void]$envParts.Add("SL_ORDER=all")
    Write-Host ""
    Write-Host "  Installing everything: all 12 segments plus git status markers." -ForegroundColor Green
}

if ($installMode -eq "2") {
    $compKeys = @{
        1 = "caveman"; 2 = "project"; 3 = "model";   4 = "ctx";
        5 = "effort";  6 = "5h";      7 = "7d";      8 = "savings";
        9 = "burn";    10 = "cost";   11 = "time";   12 = "lines"
    }
    Write-Host ""
    Write-Host "  Available components:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   1) Caveman badge      -- [CAVEMAN:FULL]"
    Write-Host "   2) Project + branch   -- my-project  main"
    Write-Host "   3) Model name         -- Claude Opus 5.5"
    Write-Host "   4) Context window     -- CTX ###-----  42%"
    Write-Host "   5) Effort level       -- MEDIUM"
    Write-Host "   6) Hourly limit (5h)  -- 5h ####---- 62% used 38% rem reset 2h 40m"
    Write-Host "   7) Weekly limit (7d)  -- 7d ###----- 41% used 59% rem reset 3d 7h"
    Write-Host "   8) Token savings      -- ~42% tokens saved"
    Write-Host "   9) Burn-rate warning  -- 5h full in ~1h 25m (only when you will hit the limit)"
    Write-Host "  10) Session cost       -- `$0.42"
    Write-Host "  11) Session time       -- 18m"
    Write-Host "  12) Lines changed      -- +124 -37"
    Write-Host "  13) Git status         -- dirty, untracked, ahead/behind (extends 2)"
    Write-Host ""
    Write-Host "  Type the numbers in the order to show them (e.g. 2 3 4 6 7 10 13),"
    Write-Host "  'all' for everything, or just press Enter for the classic set."
    $compInput = Read-Host "  Components [default=classic]"
    if (-not $compInput) { $compInput = "classic" }
    $compInput = ($compInput -replace ',', ' ').Trim().ToLower()

    if ($compInput -eq "all") {
        [void]$envParts.Add("SL_ORDER=all")
        Write-Host ""
        Write-Host "  All components enabled (including git status)." -ForegroundColor Green
    } elseif ($compInput -eq "classic" -or $compInput -eq "default") {
        Write-Host ""
        Write-Host "  Classic set." -ForegroundColor Green
    } else {
        $order = New-Object System.Collections.ArrayList
        $gitOn = $false
        foreach ($tok in ($compInput -split '\s+')) {
            if ($tok -notmatch '^\d+$') { Write-Warn "Ignoring unknown component '$tok'"; continue }
            $n = [int]$tok
            if ($n -eq 13) { $gitOn = $true }
            elseif ($compKeys.ContainsKey($n)) {
                if (-not $order.Contains($compKeys[$n])) { [void]$order.Add($compKeys[$n]) }
            }
            else { Write-Warn "Ignoring unknown component '$tok'" }
        }
        # `git` in SL_ORDER switches the git status markers on (they extend "project").
        if ($gitOn) { [void]$order.Add("git") }
        if ($order.Count -eq 0) {
            Write-Warn "No valid components chosen -- using the classic set."
        } else {
            [void]$envParts.Add("SL_ORDER=" + ($order -join ","))
            Write-Host ""
            Write-Host ("  Enabled (in order): " + ($order -join " ")) -ForegroundColor Green
        }
    }
}

# ── update: carry the current configuration over ──────────────────────────────
if ($installMode -eq "4") {
    # Our own validated SL_* variables from the existing statusLine command.
    $keep = (& node $Configure env --settings $SettingsFile 2>$null | Out-String).Trim()
    if ($keep) {
        foreach ($kv in ($keep -split '\s+')) { [void]$envParts.Add($kv) }
        Write-Host ""
        Write-Host "  Keeping your settings: $keep" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "  Keeping your settings: (defaults)" -ForegroundColor Green
    }

    # v1.0.1 on Windows already used a Node command, so judge by the installed renderer too.
    if ($existingStatus -eq "v1" -or $prevVersion -eq "1.x") {
        # v1 had no burn / cost / time / lines / git-status extras. They are off by default
        # in v2, so the line stays exactly as it was unless the user opts in here.
        Write-Host ""
        Write-Host "  New in v2 (off by default, your line stays the same):"
        Write-Host "  burn-rate warning, session cost, session time, +/- lines changed, git status"
        $showNew = "n"
        if (-not $Update) { $showNew = Read-Host "  Turn them on? [y/N]" }
        if ($showNew -match '^(y|yes)$') {
            foreach ($flag in @("SL_BURN", "SL_COST", "SL_TIME", "SL_LINES", "SL_GIT")) {
                $already = $false
                foreach ($kv in $envParts) { if ($kv -like "$flag=*") { $already = $true } }
                if (-not $already) { [void]$envParts.Add("$flag=1") }
            }
            Write-Host "  Turned on. Switch one off again with e.g. SL_COST=0." -ForegroundColor Green
        } else {
            Write-Host "  Left off. Turn on later with install.ps1 (Install all) or SL_BURN=1 SL_COST=1 SL_TIME=1 SL_LINES=1 SL_GIT=1." -ForegroundColor DarkGray
        }
    }
} else {
    # ── theme ───────────────────────────────────────────────────────────────────
    Write-Host ""
    Write-Host "  Color theme:  1) default  2) nord  3) gruvbox  4) light  5) mono"
    $themeInput = ""
    if (-not $Update) { $themeInput = Read-Host "  Theme [1-5, default=1]" }
    switch ($themeInput) {
        "2" { [void]$envParts.Add("SL_THEME=nord") }
        "3" { [void]$envParts.Add("SL_THEME=gruvbox") }
        "4" { [void]$envParts.Add("SL_THEME=light") }
        "5" { [void]$envParts.Add("SL_THEME=mono") }
    }
}

$envPrefix = ($envParts -join " ")

# ── preview ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Preview:"
$rendererPath = Join-Path $HooksDir "caveman-statusline.js"
try {
    foreach ($kv in $envParts) {
        $name, $value = $kv -split '=', 2
        Set-Item -Path "Env:$name" -Value $value
    }
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Host ("  " + ((& node $rendererPath --demo) | Out-String).TrimEnd())
} catch {
    Write-Warn "Preview failed"
} finally {
    foreach ($kv in $envParts) {
        $name = ($kv -split '=', 2)[0]
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }
}

# ── merge settings.json ───────────────────────────────────────────────────────
# Windows: Claude Code runs statusLine via Git Bash, so the command uses forward
# slashes and inline env vars. The merge itself is done by Node (no PowerShell
# JSON round-trip quirks); other keys in settings.json are preserved.
Write-Host ""
if (Test-Path $SettingsFile) {
    Write-Info "Existing settings.json found -- merging (your other config is kept)..."
} else {
    Write-Info "No existing settings.json -- creating fresh..."
}
$cfgArgs = @($Configure, "install", "--settings", $SettingsFile, "--hooks-dir", $HooksDir)
if ($envPrefix) { $cfgArgs += @("--env", $envPrefix) }
# Upgrading from 1.x: also keep a one-time copy that later runs never overwrite.
if ($prevVersion -eq "1.x") { $cfgArgs += @("--archive", "pre-v2") }
& node @cfgArgs
if ($LASTEXITCODE -ne 0) { Write-Fail "Could not update $SettingsFile" }
Write-Success "settings.json updated: $SettingsFile"

# ── install caveman plugin ────────────────────────────────────────────────────
$claudeExe = Get-Command "claude" -ErrorAction SilentlyContinue
if ($claudeExe) {
    Write-Info "Installing caveman plugin via claude CLI..."
    $ErrorActionPreference = "Continue"
    & claude plugins install caveman --marketplace caveman 2>&1 | Out-Null
    $pluginOk = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = "Stop"
    if ($pluginOk) {
        Write-Success "Caveman plugin installed"
    } else {
        Write-Warn "Plugin install skipped (may already be installed or needs manual step)"
        Write-Warn "Manual: claude plugins install caveman --marketplace caveman"
    }
} else {
    Write-Warn "'claude' CLI not found in PATH. After installing Claude Code, run:"
    Write-Warn "  claude plugins install caveman --marketplace caveman"
}

# ── done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Restart Claude Code to activate the new statusline."
Write-Host ""
Write-Host "  Statusline segments:"
Write-Host "    [CAVEMAN]              -- active caveman mode"
Write-Host "    folder + branch        -- project folder + git branch"
Write-Host "    model name             -- current Claude model"
Write-Host "    CTX bar                -- context window usage"
Write-Host "    effort                 -- effort level"
Write-Host "    5h / 7d bars           -- usage, remaining, reset countdown"
Write-Host "  Extras (Install all, or pick them in Custom):"
Write-Host "    git status             -- dirty / untracked / ahead / behind next to the branch"
Write-Host "    burn-rate              -- warns when you will hit a limit before reset"
Write-Host "    cost / time / lines    -- session cost, duration, lines changed"
Write-Host ""
Write-Host "  Caveman commands:"
Write-Host "    /caveman          -- activate (full mode)"
Write-Host "    /caveman lite     -- lite mode"
Write-Host "    /caveman ultra    -- ultra mode"
Write-Host "    stop caveman      -- deactivate"
Write-Host "    /caveman-stats    -- token usage + savings"
Write-Host ""
Write-Host "  Customize later: re-run this installer, or edit the env vars in the statusLine"
Write-Host "  command in $SettingsFile (SL_ORDER, SL_THEME, SL_<SEGMENT>=0)."
Write-Host "  Uninstall: powershell -ExecutionPolicy Bypass -File uninstall.ps1"
if ($prevVersion) {
    Write-Host ""
    Write-Host "  Roll back: Copy-Item `"$SettingsFile.bak`" `"$SettingsFile`" -Force   (restores the previous settings)"
    Write-Host "    To go back to an older release, in your clone: git checkout v1.0.1; then re-run install.ps1"
    Write-Host "    (any tag from https://github.com/FahimFBA/claudecode-statusline/tags works)"
}
Write-Host ""
