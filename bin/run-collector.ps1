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
& $node $script *>> (Join-Path $logs 'collector.log')
exit $LASTEXITCODE
