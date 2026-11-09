param([ValidateRange(1024,65535)][int]$Port=8765,[switch]$NoBrowser,
    [string]$DataDirectory,[string]$PublicDirectory)
$ErrorActionPreference='Stop'
$officeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$officeMaintenance=Join-Path $officeRoot '.office-update/maintenance'
if ((Test-Path -LiteralPath $officeMaintenance) -and $env:OFFICE_UPDATE_HEALTH -cne [IO.File]::ReadAllText($officeMaintenance)) {
    throw 'An Office update is in progress. See the Windows update recovery instructions in README.md.'
}
$officeApacheRoot=Join-Path $officeRoot 'runtime\apache\Apache24'
$officeHttpd=Join-Path $officeApacheRoot 'bin\httpd.exe'
$officePhp=Join-Path $officeRoot 'runtime\windows\php-cgi.exe'
if(!$DataDirectory){$DataDirectory=Join-Path $officeRoot 'data'}
if(!$PublicDirectory){$PublicDirectory=Join-Path $officeRoot 'public'}
$officeData=[IO.Path]::GetFullPath($DataDirectory)
$officePublic=[IO.Path]::GetFullPath($PublicDirectory)
$officeState=Join-Path $officeData 'local-server.json'
$officeUrl="http://127.0.0.1:$Port/"
if(!(Test-Path -LiteralPath $officeHttpd) -or !(Test-Path -LiteralPath $officePhp)){throw 'Portable Apache/PHP is missing. See docs/development-server.md.'}
New-Item -ItemType Directory -Path $officeData -Force | Out-Null
if(Test-Path -LiteralPath $officeState){
    $officeSaved=Get-Content -Raw -LiteralPath $officeState|ConvertFrom-Json
    $officeHealthy=$officeSaved.type -eq 'apache' -and [int]$officeSaved.port -eq $Port -and @($officeSaved.processes).Count -eq 5
    foreach($officeIdentity in $officeSaved.processes){
        $officeDetails=Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$officeIdentity.pid)" -ErrorAction SilentlyContinue
        if(!$officeDetails -or $officeDetails.ExecutablePath -ne $officeIdentity.executable -or $officeDetails.CommandLine -ne $officeIdentity.command -or ([datetime]$officeDetails.CreationDate).ToUniversalTime().Ticks -ne ([datetime]$officeIdentity.created).ToUniversalTime().Ticks){$officeHealthy=$false}
    }
    if(!$officeHealthy){throw 'A different or incomplete server is recorded for this folder. Run Stop Office.bat before starting Apache.'}
    Write-Host "Office is already running on portable Apache: $officeUrl"
    if(!$NoBrowser){Start-Process $officeUrl}
    exit
}
# Check the HTTP port before launching any processes.
$officeListener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$Port)
try{$officeListener.Start()}finally{$officeListener.Stop()}
$officeConfig=Join-Path $officeData 'apache-local.conf'
$officeWorkers=@();$officeReservations=@();$officeProcesses=@();$officeStarted=$null
$officeOldData=$env:OFFICE_DATA_DIR;$officeOldRequests=$env:PHP_FCGI_MAX_REQUESTS
$officeOldPortable=$env:OFFICE_PORTABLE_WINDOWS
function ApachePath([string]$Value){return $Value.Replace('\','/')}
try {
    # Separate CGI processes provide concurrency with the existing NTS PHP build.
    # Reserve ephemeral loopback ports together to avoid selecting duplicates.
    foreach($officeIndex in 1..4){
        $officeReservation=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
        $officeReservation.Start();$officeReservations+=,$officeReservation
        $officeWorkers+=([Net.IPEndPoint]$officeReservation.LocalEndpoint).Port
    }
    $officeModules=@('authz_core','authz_host','dir','mime','log_config','proxy','proxy_fcgi','proxy_balancer','slotmem_shm','lbmethod_bybusyness')
    $officeModuleConfig=($officeModules|ForEach-Object {'LoadModule '+$_+'_module "modules/mod_'+$_.ToString()+'.so"'}) -join "`n"
    $officeMembers=($officeWorkers|ForEach-Object {'BalancerMember "fcgi://127.0.0.1:'+$_+'" max=1 acquire=60000 retry=1 disablereuse=on'}) -join "`n"
    $officeText=@"
ServerRoot "$(ApachePath $officeApacheRoot)"
Listen 127.0.0.1:$Port
ServerName 127.0.0.1
DefaultRuntimeDir "$(ApachePath $officeData)"
PidFile "$(ApachePath (Join-Path $officeData 'apache.pid'))"
$officeModuleConfig
ThreadsPerChild 32
MaxConnectionsPerChild 0
ServerTokens Prod
ServerSignature Off
Timeout 65
ProxyTimeout 65
ProxyRequests Off
ProxyFCGIBackendType GENERIC
ProxyFCGISetEnvIf "true" SCRIPT_FILENAME "$(ApachePath $officePublic)%{reqenv:SCRIPT_NAME}"
ErrorLog "$(ApachePath (Join-Path $officeData 'apache-error.log'))"
LogLevel warn
TypesConfig "conf/mime.types"
AddType application/javascript .js .mjs
DocumentRoot "$(ApachePath $officePublic)"
DirectoryIndex index.php
<Directory />
    AllowOverride None
    Require all denied
</Directory>
<Directory "$(ApachePath $officePublic)">
    Options -Indexes -ExecCGI
    AllowOverride None
    Require local
    <FilesMatch "\.php$">
        SetHandler "proxy:balancer://office-php/"
    </FilesMatch>
</Directory>
<Proxy "balancer://office-php/">
$officeMembers
    ProxySet lbmethod=bybusyness
</Proxy>
<FilesMatch "^\.">
    Require all denied
</FilesMatch>
"@
    [IO.File]::WriteAllText($officeConfig,$officeText,(New-Object Text.UTF8Encoding($false)))
    & $officeHttpd -d $officeApacheRoot -f $officeConfig -t
    if($LASTEXITCODE -ne 0){throw 'Apache configuration check failed.'}
    $env:OFFICE_DATA_DIR=$officeData;$env:PHP_FCGI_MAX_REQUESTS='0'
    $env:OFFICE_PORTABLE_WINDOWS=if ($officeData -eq (Join-Path $officeRoot 'data') -and $officePublic -eq (Join-Path $officeRoot 'public')) {'1'} else {''}
    foreach($officeIndex in 0..3){
        $officeReservations[$officeIndex].Stop()
        $officeArgs=@('-c',('"'+(Join-Path $officeRoot 'runtime\windows\php.ini')+'"'),
            '-d',('extension_dir="'+(Join-Path $officeRoot 'runtime\windows\ext')+'"'),
            '-d',('openssl.cafile="'+(Join-Path $officeRoot 'runtime\windows\cacert.pem')+'"'),
            '-d',('curl.cainfo="'+(Join-Path $officeRoot 'runtime\windows\cacert.pem')+'"'),
            '-d',('error_log="'+(Join-Path $officeData 'php-error.log')+'"'),
            '-d','cgi.force_redirect=0','-d','cgi.fix_pathinfo=0','-b',('127.0.0.1:'+$officeWorkers[$officeIndex]))
        $officeWorker=Start-Process -FilePath $officePhp -ArgumentList $officeArgs -WorkingDirectory $officeRoot -WindowStyle Hidden -PassThru
        $officeProcesses+=,$officeWorker
    }
    $officeStarted=Start-Process -FilePath $officeHttpd -ArgumentList @('-d',('"'+$officeApacheRoot+'"'),'-f',('"'+$officeConfig+'"')) -WorkingDirectory $officeRoot -WindowStyle Hidden -PassThru
    $officeProcesses+=,$officeStarted
    $officeReady=$false
    foreach($officeAttempt in 1..40){
        foreach($officeProcess in $officeProcesses){if($officeProcess.HasExited){throw 'A server process exited. Check data/apache-error.log and data/php-error.log.'}}
        try{$officeStatus=Invoke-RestMethod -Uri ($officeUrl+'api.php?r=status') -Headers @{'X-Office-Update-Health'=[string]$env:OFFICE_UPDATE_HEALTH} -TimeoutSec 2;if($officeStatus.csrf){$officeReady=$true;break}}catch{$officeLastError=$_.Exception.Message;Start-Sleep -Milliseconds 150}
    }
    if(!$officeReady){throw "Apache did not become ready: $officeLastError. Check the private server logs."}
    $officeIdentities=@($officeProcesses|ForEach-Object {
        $officeDetails=Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)"
        @{pid=$_.Id;executable=$officeDetails.ExecutablePath;command=$officeDetails.CommandLine;created=$officeDetails.CreationDate.ToString('o')}
    })
    @{type='apache';pid=$officeStarted.Id;port=$Port;config=$officeConfig;processes=$officeIdentities} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $officeState -Encoding UTF8
} catch {
    if($officeStarted -and !$officeStarted.HasExited){
        try{$officeShutdown=[Threading.EventWaitHandle]::OpenExisting('ap'+$officeStarted.Id+'_shutdown');try{$officeShutdown.Set()|Out-Null}finally{$officeShutdown.Dispose()};$officeStarted.WaitForExit(3000)|Out-Null}catch{}
    }
    foreach($officeProcess in $officeProcesses){if(!$officeProcess.HasExited){Stop-Process -Id $officeProcess.Id -ErrorAction SilentlyContinue}}
    throw
} finally {
    foreach($officeReservation in $officeReservations){$officeReservation.Stop()}
    $env:OFFICE_DATA_DIR=$officeOldData;$env:PHP_FCGI_MAX_REQUESTS=$officeOldRequests
    $env:OFFICE_PORTABLE_WINDOWS=$officeOldPortable
}
Write-Host "Office is running on portable Apache with four PHP workers: $officeUrl"
if(Test-Path -LiteralPath (Join-Path $officeData 'setup-token.txt')){Write-Host ('Setup token: '+(Get-Content -Raw -LiteralPath (Join-Path $officeData 'setup-token.txt')).Trim())}
if(!$NoBrowser){Start-Process $officeUrl}
