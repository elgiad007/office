param([string]$DataDirectory)
$ErrorActionPreference = 'Stop'
try {
    $officeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if (!$DataDirectory) {$DataDirectory=Join-Path $officeRoot 'data'}
    $officeState = Join-Path ([IO.Path]::GetFullPath($DataDirectory)) 'local-server.json'
    if (-not (Test-Path -LiteralPath $officeState)) { Write-Host 'Office is not running from this folder.'; exit 0 }
    $officeSaved = Get-Content -Raw -LiteralPath $officeState | ConvertFrom-Json
    if ($officeSaved.type -eq 'apache') {
        $officeHttpd=Join-Path $officeRoot 'runtime\apache\Apache24\bin\httpd.exe'
        $officePhpCgi=Join-Path $officeRoot 'runtime\windows\php-cgi.exe'
        # Validate every saved identity before stopping anything, including PID reuse.
        $officeOwned=@()
        foreach($officeIdentity in $officeSaved.processes){
            $officeDetails=Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$officeIdentity.pid)" -ErrorAction SilentlyContinue
            if(!$officeDetails){continue}
            if($officeDetails.ExecutablePath -notin @($officeHttpd,$officePhpCgi) -or $officeDetails.ExecutablePath -ne $officeIdentity.executable -or $officeDetails.CommandLine -ne $officeIdentity.command -or ([datetime]$officeDetails.CreationDate).ToUniversalTime().Ticks -ne ([datetime]$officeIdentity.created).ToUniversalTime().Ticks){throw 'A recorded process belongs to another application. No process was stopped.'}
            $officeOwned+=,$officeDetails
        }
        if($officeOwned.ProcessId -contains [int]$officeSaved.pid){
            # The Windows -k switch targets installed services. Console-mode
            # Apache exposes its own per-parent shutdown event instead.
            # See httpd/server/mpm/winnt/mpm_winnt.c (setup_signal_names).
            $officeShutdown=[Threading.EventWaitHandle]::OpenExisting('ap'+$officeSaved.pid+'_shutdown')
            try{if(!$officeShutdown.Set()){throw 'Apache shutdown could not be signaled.'}}finally{$officeShutdown.Dispose()}
            # Apache owns its child; wait for it to finish before stopping PHP workers.
            Wait-Process -Id ([int]$officeSaved.pid) -Timeout 55 -ErrorAction SilentlyContinue
            if(Get-Process -Id ([int]$officeSaved.pid) -ErrorAction SilentlyContinue){throw 'Apache is still stopping. Retry shortly.'}
        }
        foreach($officeDetails in $officeOwned){if($officeDetails.ExecutablePath -eq $officePhpCgi){Stop-Process -Id $officeDetails.ProcessId -ErrorAction SilentlyContinue}}
        Remove-Item -LiteralPath $officeState
        Write-Host 'Office Apache and PHP workers stopped.'
        exit
    }
    $officeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$officeSaved.pid)" -ErrorAction SilentlyContinue
    $officePhp = Join-Path $officeRoot 'runtime\windows\php.exe'
    if ($officeProcess) {
        if ($officeProcess.ExecutablePath -ne $officePhp -or -not $officeProcess.CommandLine.Contains((Join-Path $officeRoot 'public'))) { throw 'The recorded process belongs to another application. No process was stopped.' }
        Stop-Process -Id ([int]$officeSaved.pid)
    }
    Remove-Item -LiteralPath $officeState
    Write-Host 'Office stopped. The folder can now be moved.'
} catch { Write-Error $_; exit 1 }
