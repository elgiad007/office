@echo off
setlocal
if "%~1"=="" echo Enter the published SHA-256 for .runtime\php.zip when prompted.
set "buildPowerShell=powershell.exe"
where.exe /q pwsh.exe && set "buildPowerShell=pwsh.exe"
rem Let Windows PowerShell locate its own built-in modules.
if /i "%buildPowerShell%"=="powershell.exe" set "PSModulePath="
%buildPowerShell% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1" %*
set "buildExitCode=%errorlevel%"
if "%~1"=="" pause
exit /b %buildExitCode%
