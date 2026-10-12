# The login task's entry point: find Node, put claude / git / gh on PATH, run the collector.
# Looks Node up at start (not hard-coded), so it keeps working after a Node upgrade.
# -DryRun prints what it would run and starts nothing.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'collector\index.mjs'

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
$node = if ($nodeCmd) { $nodeCmd.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
    Write-Error "Node.js was not found (looked on PATH and in $env:ProgramFiles\nodejs). Install Node 22 or newer, then start again."
    exit 1
}

# claude (native install), git, gh: the places they live on Windows, after whatever PATH the login task was given, so a folder
# of the user's (.local\bin, npm) never stands in front of System32 for a program of the system's.
$extra = @(
    (Split-Path -Parent $node),
    (Join-Path $env:USERPROFILE '.local\bin'),
    (Join-Path $env:APPDATA 'npm'),
    (Join-Path $env:ProgramFiles 'Git\cmd'),
    (Join-Path $env:ProgramFiles 'GitHub CLI')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
$newPath = ((($env:PATH -split ';') + $extra) | Where-Object { $_ } | Select-Object -Unique) -join ';'

if ($DryRun) {
    [pscustomobject]@{ node = $node; script = $script; path = $newPath } | ConvertTo-Json -Compress
    exit 0
}

$env:PATH = $newPath
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$taskLog = Join-Path $logs 'task.log'

# The collector writes its own log, logs\collector.log. What Node prints (the start-up report, a crash) goes to logs\task.log, as
# launchd's goes to launchd.log on a Mac: two writers on one file would shut each other out. Windows PowerShell 5.1 makes each
# line a program writes to stderr an error once it is redirected, and under 'Stop' the first one (the collector's first warning)
# would end this script, the task: 'Continue' here, each line written as text, in UTF-8, the file opened only for that line.
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Add-Content -LiteralPath $taskLog -Encoding UTF8 -Value "$(Get-Date -Format o) starting: $node $script"
& $node $script 2>&1 | ForEach-Object { Add-Content -LiteralPath $taskLog -Encoding UTF8 -Value "$_" }
exit $LASTEXITCODE
