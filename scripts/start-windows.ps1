param([ValidateRange(1024,65535)][int]$Port = 8765, [switch]$NoBrowser, [switch]$DevelopmentServer)
$ErrorActionPreference = 'Stop'
try {
    $officeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $officeMaintenance=Join-Path $officeRoot '.office-update/maintenance'
    if ((Test-Path -LiteralPath $officeMaintenance) -and $env:OFFICE_UPDATE_HEALTH -cne [IO.File]::ReadAllText($officeMaintenance)) {
        throw 'An Office update is in progress. See the Windows update recovery instructions in README.md.'
    }
    if (!$DevelopmentServer -and (Test-Path -LiteralPath (Join-Path $officeRoot 'runtime\apache\Apache24\bin\httpd.exe'))) {
        & (Join-Path $PSScriptRoot 'start-apache.ps1') -Port $Port -NoBrowser:$NoBrowser
        exit
    }
    $officePhp = Join-Path $officeRoot 'runtime\windows\php.exe'
    $officeData = Join-Path $officeRoot 'data'
    $officeState = Join-Path $officeData 'local-server.json'
    if (-not (Test-Path -LiteralPath $officePhp)) { throw 'Portable PHP is missing. Use the Windows release ZIP, which includes runtime\windows\php.exe, or see runtime\windows\README.md.' }
    New-Item -ItemType Directory -Path $officeData -Force | Out-Null
    $officeUrl = "http://127.0.0.1:$Port/"
    $officeRunning = $false
    if (Test-Path -LiteralPath $officeState) {
        $officeSaved = Get-Content -Raw -LiteralPath $officeState | ConvertFrom-Json
        $officeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$officeSaved.pid)" -ErrorAction SilentlyContinue
        if ($officeProcess -and $officeProcess.ExecutablePath -eq $officePhp -and $officeProcess.CommandLine.Contains((Join-Path $officeRoot 'public'))) {
            if ([int]$officeSaved.port -ne $Port) { throw "Office is already running on port $($officeSaved.port). Run Stop Office.bat first." }
            $officeRunning = $true
        }
    }
    if (-not $officeRunning) {
        $officeListener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$Port)
        try { $officeListener.Start() } catch { throw "Port $Port is already in use. Run Start Office.bat -Port 8766 to use another port." } finally { $officeListener.Stop() }
        # Web requests run from public/, so certificate paths must be absolute.
        # Resolve them on every launch to keep copied/moved installations portable.
        $officeCaFile = Join-Path $officeRoot 'runtime\windows\cacert.pem'
        $officeArgs = @('-c', ('"' + (Join-Path $officeRoot 'runtime\windows\php.ini') + '"'), '-d', ('extension_dir="' + (Join-Path $officeRoot 'runtime\windows\ext') + '"'), '-d', ('openssl.cafile="' + $officeCaFile + '"'), '-d', ('curl.cainfo="' + $officeCaFile + '"'), '-d', ('error_log="' + (Join-Path $officeData 'php-error.log') + '"'), '-S', "127.0.0.1:$Port", '-t', ('"' + (Join-Path $officeRoot 'public') + '"'))
        # Do not inherit a development/test database path into a user's portable installation.
        $officePreviousData = $env:OFFICE_DATA_DIR
        $officePreviousPortable = $env:OFFICE_PORTABLE_WINDOWS
        $env:OFFICE_DATA_DIR = $officeData
        $env:OFFICE_PORTABLE_WINDOWS = '1'
        # A separate hidden console avoids inherited/redirection handles keeping the batch launcher open.
        try { $officeStarted = Start-Process -FilePath $officePhp -ArgumentList $officeArgs -WorkingDirectory $officeRoot -WindowStyle Hidden -PassThru }
        finally { $env:OFFICE_DATA_DIR = $officePreviousData; $env:OFFICE_PORTABLE_WINDOWS = $officePreviousPortable }
        @{pid=$officeStarted.Id;port=$Port} | ConvertTo-Json | Set-Content -LiteralPath $officeState -Encoding UTF8
        $officeReady = $false
        for ($officeAttempt=0; $officeAttempt -lt 30; $officeAttempt++) {
            if ($officeStarted.HasExited) { break }
            try {
                $officeStatus = Invoke-RestMethod -Uri ($officeUrl+'api.php?r=status') -Headers @{'X-Office-Update-Health'=[string]$env:OFFICE_UPDATE_HEALTH} -TimeoutSec 1
                if ($officeStatus.csrf) { $officeReady=$true; break }
            } catch { Start-Sleep -Milliseconds 150 }
        }
        if (-not $officeReady) {
            if (-not $officeStarted.HasExited) { $officeStarted.Kill(); $officeStarted.WaitForExit() }
            throw 'Office could not start. Check data\php-error.log. A missing Visual C++ runtime or SQLite extension can prevent PHP from starting.'
        }
    }
    Write-Host "Office is running at $officeUrl"
    $officeToken = Join-Path $officeData 'setup-token.txt'
    if (Test-Path -LiteralPath $officeToken) { Write-Host ('First-run setup token: ' + (Get-Content -Raw -LiteralPath $officeToken)) }
    Write-Host 'Use Stop Office.bat before moving the folder or removing the drive.'
    if (-not $NoBrowser) { Start-Process $officeUrl }
} catch { Write-Error $_; exit 1 }
