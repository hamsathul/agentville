@echo off
rem agent-tracker for Windows: hands everything to agent-tracker.ps1 (PowerShell 5.1 is part of Windows).
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-tracker.ps1" %*
exit /b %ERRORLEVEL%
