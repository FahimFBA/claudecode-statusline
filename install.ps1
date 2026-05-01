# claudecode-statusline — Claude Code statusline installer (Windows PowerShell)
# Repo: https://github.com/FahimFBA/claudecode-statusline
# Run: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [string]$ClaudeDir = ""
)

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

# ── check Node.js ─────────────────────────────────────────────────────────────
try {
    $nodeVer = (node --version 2>&1)
    Write-Info "Node.js $nodeVer found"
} catch {
    Write-Fail "Node.js not found. Install from https://nodejs.org (LTS) and re-run."
}

# ── create hooks dir ──────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $HooksDir | Out-Null
Write-Success "Hooks dir ready: $HooksDir"

# ── copy hook scripts ─────────────────────────────────────────────────────────
$hookFiles = @(
    "caveman-activate.js",
    "caveman-config.js",
    "caveman-mode-tracker.js",
    "caveman-stats.js",
    "caveman-statusline.sh",
    "package.json"
)
foreach ($file in $hookFiles) {
    Copy-Item -Path (Join-Path $HooksSrc $file) -Destination (Join-Path $HooksDir $file) -Force
}
Write-Success "Hook scripts installed to $HooksDir"

# ── statusline setup ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Statusline Setup" -ForegroundColor Cyan
Write-Host "  ------------------------------------------------" -ForegroundColor DarkCyan
Write-Host ""

# Show existing statusLine if present
$existingSlCmd = ""
if (Test-Path $SettingsFile) {
    try {
        $cfgExisting = Get-Content $SettingsFile -Raw | ConvertFrom-Json
        $existingSlCmd = $cfgExisting.statusLine.command
    } catch { }
}
if ($existingSlCmd) {
    Write-Host "  Existing statusline found:" -ForegroundColor Yellow
    Write-Host "  $existingSlCmd" -ForegroundColor DarkGray
    Write-Host ""
}

Write-Host "  How do you want to install?"
Write-Host ""
Write-Host "  1) Full install  -- all components, replaces existing statusline"
Write-Host "  2) Custom        -- choose which components to include"
Write-Host ""
$installMode = Read-Host "  Choice [1/2, default=1]"
if (-not $installMode) { $installMode = "1" }

# ── component selection ───────────────────────────────────────────────────────
$slEnvPrefix = ""

if ($installMode -eq "2") {
    Write-Host ""
    Write-Host "  Available components:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1) Caveman badge      -- [caveman CAVEMAN:FULL]"
    Write-Host "  2) Project + branch   -- folder my-project branch main"
    Write-Host "  3) Model name         -- Claude Sonnet 4.6"
    Write-Host "  4) Context window     -- CTX ########   42%"
    Write-Host "  5) Effort level       -- effort MEDIUM"
    Write-Host "  6) Hourly limit (5h)  -- 5h ######## 42% used 58% rem reset 1h 22m"
    Write-Host "  7) Weekly limit (7d)  -- 7d ##------ 85% used 15% rem reset 3d 7h"
    Write-Host "  8) Token savings      -- ~42% tokens saved"
    Write-Host ""
    $compInput = Read-Host "  Numbers to include (e.g. 2 3 4 6 7), or 'all' [default=all]"
    if (-not $compInput) { $compInput = "all" }

    if ($compInput -ne "all") {
        $compMap = @{
            1 = "SL_CAVEMAN"
            2 = "SL_PROJECT"
            3 = "SL_MODEL"
            4 = "SL_CTX"
            5 = "SL_EFFORT"
            6 = "SL_5H"
            7 = "SL_7D"
            8 = "SL_SAVINGS"
        }
        $selectedNums = ($compInput -split '\s+') | Where-Object { $_ -match '^\d+$' }

        foreach ($num in 1..8) {
            if ($selectedNums -notcontains "$num") {
                $varName = $compMap[$num]
                $slEnvPrefix = "$varName=0 $slEnvPrefix"
            }
        }

        Write-Host ""
        Write-Host "  Enabled: $compInput" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "  All components enabled." -ForegroundColor Green
    }
}

# ── build settings ────────────────────────────────────────────────────────────
# On Windows, bash is typically invoked via Git for Windows or WSL
# Env vars prefix is passed inline in the bash command
$baseCmd = "bash `"$HooksDir\caveman-statusline.sh`""
if ($slEnvPrefix) {
    # Prepend env vars for bash: "VAR=0 bash script"
    $statuslineCmd = "$slEnvPrefix$baseCmd"
} else {
    $statuslineCmd = $baseCmd
}

$newStatusLine = [ordered]@{
    type    = "command"
    command = $statuslineCmd
}

$newHooks = [ordered]@{
    SessionStart = @(
        @{
            hooks = @(
                @{
                    type          = "command"
                    command       = "node `"$HooksDir\caveman-activate.js`""
                    timeout       = 5
                    statusMessage = "Loading caveman mode..."
                }
            )
        }
    )
    UserPromptSubmit = @(
        @{
            hooks = @(
                @{
                    type          = "command"
                    command       = "node `"$HooksDir\caveman-mode-tracker.js`""
                    timeout       = 5
                    statusMessage = "Tracking caveman mode..."
                }
            )
        }
    )
}

# ── merge or write settings.json ──────────────────────────────────────────────
Write-Host ""
if (Test-Path $SettingsFile) {
    Write-Info "Existing settings.json found -- merging..."
    Copy-Item -Path $SettingsFile -Destination "$SettingsFile.bak" -Force
    Write-Info "Backup saved to $SettingsFile.bak"
    $cfg    = Get-Content $SettingsFile -Raw | ConvertFrom-Json
    $cfgHash = @{}
    $cfg.PSObject.Properties | ForEach-Object { $cfgHash[$_.Name] = $_.Value }
} else {
    Write-Info "No existing settings.json -- creating fresh..."
    $cfgHash = @{}
}

# Merge hooks
if (-not $cfgHash.ContainsKey("hooks")) { $cfgHash["hooks"] = @{} }
$existingHooks = $cfgHash["hooks"]
if ($existingHooks -is [System.Management.Automation.PSObject]) {
    $hHash = @{}
    $existingHooks.PSObject.Properties | ForEach-Object { $hHash[$_.Name] = $_.Value }
    $existingHooks = $hHash
}
$existingHooks["SessionStart"]     = $newHooks["SessionStart"]
$existingHooks["UserPromptSubmit"] = $newHooks["UserPromptSubmit"]
$cfgHash["hooks"]      = $existingHooks
$cfgHash["statusLine"] = $newStatusLine

# Enable caveman plugin
if (-not $cfgHash.ContainsKey("enabledPlugins")) { $cfgHash["enabledPlugins"] = @{} }
$ep = $cfgHash["enabledPlugins"]
if ($ep -is [System.Management.Automation.PSObject]) {
    $epHash = @{}
    $ep.PSObject.Properties | ForEach-Object { $epHash[$_.Name] = $_.Value }
    $ep = $epHash
}
$ep["caveman@caveman"] = $true
$cfgHash["enabledPlugins"] = $ep

# Register caveman marketplace
if (-not $cfgHash.ContainsKey("extraKnownMarketplaces")) { $cfgHash["extraKnownMarketplaces"] = @{} }
$mkt = $cfgHash["extraKnownMarketplaces"]
if ($mkt -is [System.Management.Automation.PSObject]) {
    $mktHash = @{}
    $mkt.PSObject.Properties | ForEach-Object { $mktHash[$_.Name] = $_.Value }
    $mkt = $mktHash
}
if (-not $mkt.ContainsKey("caveman")) {
    $mkt["caveman"] = @{ source = @{ source = "github"; repo = "JuliusBrussee/caveman" } }
}
$cfgHash["extraKnownMarketplaces"] = $mkt

$cfgHash | ConvertTo-Json -Depth 10 | Set-Content -Path $SettingsFile -Encoding UTF8
Write-Success "settings.json updated: $SettingsFile"

# ── install caveman plugin ────────────────────────────────────────────────────
$claudeExe = Get-Command "claude" -ErrorAction SilentlyContinue
if ($claudeExe) {
    Write-Info "Installing caveman plugin via claude CLI..."
    try {
        & claude plugins install caveman --marketplace caveman 2>&1 | Out-Null
        Write-Success "Caveman plugin installed"
    } catch {
        Write-Warn "Plugin install skipped (may already be installed or needs manual step)"
        Write-Warn "Manual: claude plugins install caveman --marketplace caveman"
    }
} else {
    Write-Warn "'claude' CLI not found in PATH. After installing Claude Code, run:"
    Write-Warn "  claude plugins install caveman --marketplace caveman"
}

# ── note about bash on Windows ────────────────────────────────────────────────
$bashExe = Get-Command "bash" -ErrorAction SilentlyContinue
if (-not $bashExe) {
    Write-Warn "bash not found. Statusline script requires bash."
    Write-Warn "Install Git for Windows (includes bash): https://git-scm.com"
    Write-Warn "Or enable WSL: wsl --install"
}

# ── done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Restart Claude Code to activate the new statusline."
Write-Host ""
Write-Host "  Statusline segments:"
Write-Host "    [caveman]           -- active caveman mode"
Write-Host "    folder + branch     -- project folder + git branch"
Write-Host "    model name          -- current Claude model"
Write-Host "    CTX bar             -- context window usage"
Write-Host "    effort              -- effort level"
Write-Host "    5h ## 42% used 58% rem -- hourly limit + reset time"
Write-Host "    7d ## 85% used 15% rem -- weekly limit + reset time"
Write-Host ""
Write-Host "  Caveman commands:"
Write-Host "    /caveman          -- activate (full mode)"
Write-Host "    /caveman lite     -- lite mode"
Write-Host "    /caveman ultra    -- ultra mode"
Write-Host "    stop caveman      -- deactivate"
Write-Host "    /caveman-stats    -- token usage + savings"
Write-Host ""
Write-Host "  Re-run installer and choose option 2 to customize components."
Write-Host ""
