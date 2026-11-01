param([string]$PhpBinary='php',[string]$PhpExtensionDir,[string]$NodeModuleManifest,[string]$BrowserChannel,[int]$Port=8787,[switch]$Apache)
$ErrorActionPreference='Stop'
$officeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$officeTestData=Join-Path $officeRoot ('.runtime\browser-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $officeTestData -Force | Out-Null
$officeArgs=@()
if($PhpExtensionDir){ $officeArgs+=@('-d',('extension_dir="'+[IO.Path]::GetFullPath($PhpExtensionDir)+'"'),'-d','extension=pdo_sqlite','-d','extension=openssl','-d','extension=curl') }
$officeArgs+=@('-S',"127.0.0.1:$Port",'-t',('"'+(Join-Path $officeRoot 'public')+'"'))
$env:OFFICE_DATA_DIR=$officeTestData
$env:OFFICE_TEST_DATA=$officeTestData
$env:OFFICE_TEST_URL="http://127.0.0.1:$Port/"
if($NodeModuleManifest){$env:OFFICE_NODE_MODULES=$NodeModuleManifest}
if($BrowserChannel){$env:OFFICE_BROWSER_CHANNEL=$BrowserChannel}
$officeServer=$null
try {
    if($Apache){& (Join-Path $officeRoot 'scripts/start-apache.ps1') -Port $Port -NoBrowser -DataDirectory $officeTestData}
    else{$officeServer=Start-Process -FilePath $PhpBinary -ArgumentList $officeArgs -WorkingDirectory $officeRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $officeTestData 'out.log') -RedirectStandardError (Join-Path $officeTestData 'server.log')}
    for($officeAttempt=0;$officeAttempt -lt 30;$officeAttempt++){
        if($officeServer -and $officeServer.HasExited){throw 'Test server exited before becoming ready.'}
        try{$officeStatus=Invoke-RestMethod -Uri ($env:OFFICE_TEST_URL+'api.php?r=status') -TimeoutSec 1;if($officeStatus.setup){break}}catch{Start-Sleep -Milliseconds 150}
    }
    & node (Join-Path $PSScriptRoot 'browser.mjs')
    if($LASTEXITCODE -ne 0){throw 'Browser checks failed. Screenshots are in test-results/.'}
} finally {
    if($Apache){if(Test-Path -LiteralPath (Join-Path $officeTestData 'local-server.json')){& (Join-Path $officeRoot 'scripts/stop-windows.ps1') -DataDirectory $officeTestData}}
    elseif($officeServer -and -not $officeServer.HasExited){$officeServer.Kill();$officeServer.WaitForExit()}
    Remove-Item Env:OFFICE_DATA_DIR -ErrorAction SilentlyContinue
}
