# Control Agentville's login task (the command keeps its first name, agent-tracker).
#   agent-tracker install [-DryRun] | uninstall | start | stop | restart | status | open | logs
# install registers a per-user task that runs at logon, at normal rights (no elevation). -DryRun prints what it would register
# and registers nothing.
param(
    [Parameter(Position = 0)][string]$Command = 'status',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$taskName = 'Agentville'
$runScript = Join-Path $root 'bin\run-collector.ps1'

function Get-Port {
    try {
        $cfg = Get-Content -Raw -LiteralPath (Join-Path $root 'config.json') | ConvertFrom-Json
        if ($cfg.port) { return [int]$cfg.port }
    } catch { }
    return 7777
}

function Get-TaskOrNull { Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }

$port = Get-Port

switch ($Command) {
    'install' {
        $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runScript`""
        if ($DryRun) {
            [pscustomobject]@{
                taskName = $taskName; trigger = 'AtLogOn'; user = "$env:USERDOMAIN\$env:USERNAME"; runLevel = 'Limited'
                execute = $psExe; argument = $arg; registered = $false
            } | ConvertTo-Json -Compress
            break
        }
        New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null
        $action = New-ScheduledTaskAction -Execute $psExe -Argument $arg -WorkingDirectory $root
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $taskName
        "installed; starts at login. Dashboard: http://localhost:$port"
    }
    'uninstall' {
        if (Get-TaskOrNull) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
        'removed'
    }
    'start' {
        if (-not (Get-TaskOrNull)) { Write-Error 'service not registered: run agent-tracker install first'; exit 1 }
        Start-ScheduledTask -TaskName $taskName
        'started'
    }
    'stop' {
        if (-not (Get-TaskOrNull)) { Write-Error 'service not registered'; exit 1 }
        Stop-ScheduledTask -TaskName $taskName
        "stopped (starts again at next login; 'agent-tracker start' to start now)"
    }
    'restart' {
        if (-not (Get-TaskOrNull)) { Write-Error 'service not registered: run agent-tracker install first'; exit 1 }
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Start-ScheduledTask -TaskName $taskName
        'restarted'
    }
    'status' {
        $t = Get-TaskOrNull
        if ($t) { "task $($t.TaskName): state = $($t.State)" } else { 'service not registered' }
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/state" -TimeoutSec 5 | Out-Null
            "http ok on :$port"
        } catch {
            "http not answering on :$port"
        }
    }
    'open' { Start-Process "http://localhost:$port" }
    'logs' {
        $log = Join-Path $root 'logs\collector.log'
        if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 50 } else { 'no log yet' }
    }
    default {
        [Console]::Error.WriteLine('usage: agent-tracker install|uninstall|start|stop|restart|status|open|logs')
        exit 2
    }
}
