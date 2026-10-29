$ErrorActionPreference = 'Stop'
try {
    $officeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $officeState = Join-Path $officeRoot 'data\local-server.json'
    if (-not (Test-Path -LiteralPath $officeState)) { Write-Host 'Office is not running from this folder.'; exit 0 }
    $officeSaved = Get-Content -Raw -LiteralPath $officeState | ConvertFrom-Json
    $officeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$officeSaved.pid)" -ErrorAction SilentlyContinue
    $officePhp = Join-Path $officeRoot 'runtime\windows\php.exe'
    if ($officeProcess) {
        if ($officeProcess.ExecutablePath -ne $officePhp -or -not $officeProcess.CommandLine.Contains((Join-Path $officeRoot 'public'))) { throw 'The recorded process belongs to another application. No process was stopped.' }
        Stop-Process -Id ([int]$officeSaved.pid)
    }
    Remove-Item -LiteralPath $officeState
    Write-Host 'Office stopped. The folder can now be moved.'
} catch { Write-Error $_; exit 1 }
